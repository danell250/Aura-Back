"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isConnected = void 0;
exports.isDBConnected = isDBConnected;
exports.connectDB = connectDB;
exports.getDB = getDB;
exports.getDBOptional = getDBOptional;
exports.checkDBHealth = checkDBHealth;
exports.closeDB = closeDB;
const mongodb_1 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
const Message_1 = require("./models/Message");
const MessageThread_1 = require("./models/MessageThread");
const User_1 = require("./models/User");
const AdAnalyticsDaily_1 = require("./models/AdAnalyticsDaily");
const AdEventDedupe_1 = require("./models/AdEventDedupe");
const CallLog_1 = require("./models/CallLog");
dotenv_1.default.config();
const DEFAULT_MONGO_URI = "mongodb://localhost:27017/aura";
const DEFAULT_DB_NAME = "aura";
const getMongoUri = () => process.env.MONGO_URI || DEFAULT_MONGO_URI;
const getDbName = () => process.env.MONGO_DB_NAME || DEFAULT_DB_NAME;
const buildConnectionOptions = (uri) => {
    const options = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        heartbeatFrequencyMS: 10000,
        maxIdleTimeMS: 30000,
        retryWrites: true,
        retryReads: true,
        minPoolSize: 2,
        maxConnecting: 2,
    };
    if (uri.includes('mongodb+srv') || uri.includes('mongodb.net')) {
        Object.assign(options, {
            tls: true,
            tlsAllowInvalidCertificates: false,
            tlsAllowInvalidHostnames: false,
        });
    }
    return options;
};
let client = null;
let clientUri = null;
let db;
let isConnected = false;
exports.isConnected = isConnected;
let connectionAttempts = 0;
const maxRetries = 5;
let reconnectInterval = null;
let monitoringClient = null;
// Connection state management
function isDBConnected() {
    return isConnected;
}
// Enhanced connection function with retry logic
function connectDB() {
    return __awaiter(this, void 0, void 0, function* () {
        connectionAttempts++;
        try {
            console.log(`🔄 Attempting to connect to MongoDB (attempt ${connectionAttempts}/${maxRetries})...`);
            const mongoUri = getMongoUri();
            if (!client || clientUri !== mongoUri) {
                if (client) {
                    try {
                        yield client.close();
                    }
                    catch (_a) {
                        // Ignore close failures when rotating clients.
                    }
                }
                client = new mongodb_1.MongoClient(mongoUri, buildConnectionOptions(mongoUri));
                clientUri = mongoUri;
                setupConnectionMonitoring();
            }
            yield client.connect();
            // Test the connection
            db = client.db(getDbName());
            yield db.command({ ping: 1 });
            exports.isConnected = isConnected = true;
            connectionAttempts = 0; // Reset on successful connection
            // Initialize collections
            try {
                (0, Message_1.initializeMessageCollection)(db);
                console.log("✅ Message collection initialized");
                yield (0, MessageThread_1.initializeMessageThreadCollection)(db);
                console.log("✅ Message thread collection initialized");
                yield (0, CallLog_1.initializeCallLogsCollection)(db);
                console.log("✅ Call logs collection initialized");
                yield (0, User_1.initializeUserCollection)(db);
                yield (0, AdAnalyticsDaily_1.initializeAdAnalyticsDailyCollection)(db);
                console.log("✅ AdAnalyticsDaily collection initialized");
                yield (0, AdEventDedupe_1.initializeAdEventDedupesCollection)(db);
                console.log("✅ AdEventDedupes collection initialized");
                // Initialize Company and Invite indexes
                try {
                    yield db.collection('companies').createIndex({ id: 1 }, { unique: true });
                    yield db.collection('companies').createIndex({ ownerId: 1 });
                    yield db.collection('companies').createIndex({ handle: 1 }, {
                        unique: true,
                        collation: { locale: 'en', strength: 2 },
                        background: true,
                        sparse: true,
                        name: 'company_handle_unique_case_insensitive'
                    });
                    yield db.collection('company_members').createIndex({ companyId: 1, userId: 1 }, { unique: true });
                    yield db.collection('company_members').createIndex({ userId: 1 });
                    yield db.collection('company_invites').createIndex({ token: 1 }, { unique: true });
                    yield db.collection('company_invites').createIndex({ email: 1 });
                    yield db.collection('company_invites').createIndex({ companyId: 1 });
                    console.log("✅ Company and Invite indexes initialized");
                }
                catch (companyIndexError) {
                    console.warn("⚠️  Warning: Could not initialize company indexes:", companyIndexError);
                }
                // Initialize Post collection indexes
                try {
                    yield db.collection('posts').createIndex({ 'author.id': 1 });
                    yield db.collection('posts').createIndex({ id: 1 }, { unique: true });
                    yield db.collection('posts').createIndex({ timestamp: -1 });
                    yield db.collection('posts').createIndex({ visibility: 1 });
                    yield db.collection('posts').createIndex({ isTimeCapsule: 1, unlockDate: 1 });
                    yield db.collection('posts').createIndex({ hashtags: 1 });
                    yield db.collection('posts').createIndex({ energy: 1 });
                    console.log("✅ Post collection indexes initialized");
                }
                catch (postIndexError) {
                    console.warn("⚠️  Warning: Could not initialize post indexes:", postIndexError);
                }
                // Initialize payment/idempotency indexes
                try {
                    yield db.collection('transactions').createIndex({ type: 1, paymentReferenceKey: 1 }, {
                        unique: true,
                        partialFilterExpression: { paymentReferenceKey: { $type: 'string' } },
                        name: 'tx_type_payment_reference_unique'
                    });
                    yield db.collection('transactions').createIndex({ type: 1, transactionId: 1 }, { name: 'tx_type_transaction_id_idx' });
                    yield db.collection('transactions').createIndex({ orderId: 1 }, { sparse: true, name: 'tx_order_id_idx' });
                    yield db.collection('adSubscriptions').createIndex({ paypalSubscriptionId: 1 }, {
                        unique: true,
                        partialFilterExpression: { paypalSubscriptionId: { $type: 'string' } },
                        name: 'ad_sub_paypal_subscription_unique'
                    });
                    yield db.collection('adSubscriptions').createIndex({ paypalOrderId: 1 }, {
                        unique: true,
                        partialFilterExpression: { paypalOrderId: { $type: 'string' } },
                        name: 'ad_sub_paypal_order_unique'
                    });
                    console.log("✅ Payment idempotency indexes initialized");
                }
                catch (paymentIndexError) {
                    console.warn("⚠️  Warning: Could not initialize payment indexes:", paymentIndexError);
                }
            }
            catch (error) {
                console.warn("⚠️  Warning: Could not initialize collections:", error);
            }
            console.log("✅ Connected to MongoDB successfully");
            console.log(`📊 MongoDB connected to database: aura`);
            // Set up connection monitoring
            return db;
        }
        catch (err) {
            console.error(`❌ MongoDB connection error (attempt ${connectionAttempts}):`, err);
            if (err instanceof Error) {
                // Handle specific error types
                if (err.message.includes('SSL') || err.message.includes('TLS') || err.message.includes('ECONNRESET')) {
                    console.error("🔒 SSL/TLS Connection Error:");
                    console.error("   This usually indicates one of the following issues:");
                    console.error("   1. MongoDB Atlas cluster is not running or accessible");
                    console.error("   2. Network connectivity issues");
                    console.error("   3. Incorrect connection string or credentials");
                    console.error("   4. Firewall or proxy blocking the connection");
                    console.error("");
                    console.error("   Recommended solutions:");
                    console.error("   - Check MongoDB Atlas cluster status");
                    console.error("   - Verify MONGO_URI in environment variables");
                    console.error("   - Ensure your IP is whitelisted in MongoDB Atlas");
                    console.error("   - Check network connectivity");
                }
                else if (err.message.includes('authentication')) {
                    console.error("🔐 Authentication Error:");
                    console.error("   - Check your MongoDB username and password");
                    console.error("   - Verify database user permissions");
                    console.error("   - Ensure the user has access to the 'aura' database");
                }
                else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
                    console.error("🌐 Network Error:");
                    console.error("   - Check your internet connection");
                    console.error("   - Verify the MongoDB server address");
                    console.error("   - Check if MongoDB service is running (for local connections)");
                }
            }
            exports.isConnected = isConnected = false;
            // Retry logic
            if (connectionAttempts < maxRetries) {
                const retryDelay = Math.min(1000 * Math.pow(2, connectionAttempts - 1), 30000); // Exponential backoff, max 30s
                console.log(`🔄 Retrying connection in ${retryDelay / 1000} seconds...`);
                yield new Promise(resolve => setTimeout(resolve, retryDelay));
                return connectDB();
            }
            else {
                console.warn("⚠️  Warning: Max connection attempts reached. Running without database connection.");
                console.warn("⚠️  Some features may not work properly. The server will continue with mock data.");
                // Start periodic reconnection attempts
                startPeriodicReconnection();
                return null;
            }
        }
    });
}
// Set up connection monitoring
function setupConnectionMonitoring() {
    if (!client || monitoringClient === client) {
        return;
    }
    monitoringClient = client;
    // Monitor connection events
    monitoringClient.on('serverHeartbeatFailed', (event) => {
        console.warn('⚠️  MongoDB heartbeat failed:', event);
    });
    monitoringClient.on('serverClosed', (event) => {
        console.warn('⚠️  MongoDB server connection closed:', event);
        exports.isConnected = isConnected = false;
        startPeriodicReconnection();
    });
    monitoringClient.on('topologyClosed', () => {
        console.warn('⚠️  MongoDB topology closed');
        exports.isConnected = isConnected = false;
        startPeriodicReconnection();
    });
    monitoringClient.on('serverOpening', () => {
        console.log('✅ MongoDB server connection opening');
    });
    monitoringClient.on('topologyOpening', () => {
        console.log('✅ MongoDB topology opening');
    });
}
// Start periodic reconnection attempts
function startPeriodicReconnection() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
    }
    reconnectInterval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
        if (!isConnected) {
            console.log('🔄 Attempting to reconnect to MongoDB...');
            connectionAttempts = 0; // Reset attempts for reconnection
            try {
                yield connectDB();
                if (isConnected && reconnectInterval) {
                    clearInterval(reconnectInterval);
                    reconnectInterval = null;
                    console.log('✅ Successfully reconnected to MongoDB');
                }
            }
            catch (error) {
                console.log('❌ Reconnection attempt failed, will retry...');
            }
        }
    }), 30000); // Try to reconnect every 30 seconds
}
function getDB() {
    if (!isConnected || !db) {
        throw new Error("Database not connected");
    }
    return db;
}
function getDBOptional() {
    if (!isConnected || !db) {
        return null;
    }
    return db;
}
// Health check function
function checkDBHealth() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!isConnected || !db) {
                return false;
            }
            yield db.command({ ping: 1 });
            return true;
        }
        catch (error) {
            console.warn('⚠️  Database health check failed:', error);
            exports.isConnected = isConnected = false;
            startPeriodicReconnection();
            return false;
        }
    });
}
// Graceful shutdown
function closeDB() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
            if (client) {
                yield client.close();
                exports.isConnected = isConnected = false;
                client = null;
                clientUri = null;
                monitoringClient = null;
            }
            console.log("✅ MongoDB connection closed gracefully");
        }
        catch (err) {
            console.error("❌ Error closing MongoDB connection:", err);
        }
    });
}
// Graceful shutdown handlers
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('\n🔄 Shutting down gracefully...');
    yield closeDB();
    process.exit(0);
}));
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('\n🔄 Shutting down gracefully...');
    yield closeDB();
    process.exit(0);
}));
// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});
