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
exports.checkDBHealth = checkDBHealth;
exports.closeDB = closeDB;
const mongodb_1 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
const Message_1 = require("./models/Message");
const User_1 = require("./models/User");
const AdAnalyticsDaily_1 = require("./models/AdAnalyticsDaily");
const AdEventDedupe_1 = require("./models/AdEventDedupe");
dotenv_1.default.config();
const mongoUri = process.env.MONGO_URI;
// Enhanced MongoDB connection configuration
const connectionOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000, // Increased timeout
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000,
    maxIdleTimeMS: 30000,
    // Retry configuration
    retryWrites: true,
    retryReads: true,
    // Connection pool settings
    minPoolSize: 2,
    maxConnecting: 2,
};
// Add TLS options only if connecting to Atlas (contains mongodb+srv or mongodb.net)
if (mongoUri && (mongoUri.includes('mongodb+srv') || mongoUri.includes('mongodb.net'))) {
    Object.assign(connectionOptions, {
        tls: true,
        tlsAllowInvalidCertificates: false,
        tlsAllowInvalidHostnames: false,
    });
}
const client = new mongodb_1.MongoClient(mongoUri || "mongodb://localhost:27017/aura", connectionOptions);
let db;
let isConnected = false;
exports.isConnected = isConnected;
let connectionAttempts = 0;
const maxRetries = 5;
let reconnectInterval = null;
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
            yield client.connect();
            // Test the connection
            db = client.db("aura");
            yield db.command({ ping: 1 });
            exports.isConnected = isConnected = true;
            connectionAttempts = 0; // Reset on successful connection
            // Initialize collections
            try {
                (0, Message_1.initializeMessageCollection)(db);
                console.log("✅ Message collection initialized");
                yield (0, User_1.initializeUserCollection)(db);
                yield (0, AdAnalyticsDaily_1.initializeAdAnalyticsDailyCollection)(db);
                console.log("✅ AdAnalyticsDaily collection initialized");
                yield (0, AdEventDedupe_1.initializeAdEventDedupesCollection)(db);
                console.log("✅ AdEventDedupes collection initialized");
            }
            catch (error) {
                console.warn("⚠️  Warning: Could not initialize collections:", error);
            }
            console.log("✅ Connected to MongoDB successfully");
            console.log(`📊 MongoDB connected to database: aura`);
            // Set up connection monitoring
            setupConnectionMonitoring();
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
    // Monitor connection events
    client.on('serverHeartbeatFailed', (event) => {
        console.warn('⚠️  MongoDB heartbeat failed:', event);
    });
    client.on('serverClosed', (event) => {
        console.warn('⚠️  MongoDB server connection closed:', event);
        exports.isConnected = isConnected = false;
        startPeriodicReconnection();
    });
    client.on('topologyClosed', () => {
        console.warn('⚠️  MongoDB topology closed');
        exports.isConnected = isConnected = false;
        startPeriodicReconnection();
    });
    client.on('serverOpening', () => {
        console.log('✅ MongoDB server connection opening');
    });
    client.on('topologyOpening', () => {
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
