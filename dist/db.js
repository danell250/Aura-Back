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
exports.connectDB = connectDB;
exports.getDB = getDB;
exports.closeDB = closeDB;
const mongodb_1 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const mongoUri = process.env.MONGO_URI;
// Validate that MONGO_URI is set and not the placeholder
if (!mongoUri || mongoUri.includes('your_') || mongoUri.includes('placeholder')) {
    console.warn("⚠️  Warning: MONGO_URI is not properly configured. Using fallback local connection.");
    console.warn("🔧 Please set MONGO_URI in your environment variables with your actual MongoDB Atlas connection string.");
}
const client = new mongodb_1.MongoClient(mongoUri || "mongodb://localhost:27017/aura", {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    // Use TLS options that work with MongoDB Atlas
    tls: true,
    tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false,
});
let db;
let isConnected = false;
function connectDB() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield client.connect();
            db = client.db("aura"); // your database name
            isConnected = true;
            console.log("✅ Connected to MongoDB successfully");
            return db;
        }
        catch (err) {
            console.error("❌ MongoDB connection error:", err);
            // If it's an SSL/TLS error, provide helpful error message
            if (err instanceof Error && (err.message.includes('SSL') || err.message.includes('TLS') || err.message.includes('alert internal error'))) {
                console.error("🔒 SSL/TLS Connection Error:");
                console.error("   This usually indicates one of the following issues:");
                console.error("   1. MongoDB Atlas cluster is not running or accessible");
                console.error("   2. Network connectivity issues");
                console.error("   3. Outdated MongoDB driver or Node.js version");
                console.error("   4. Firewall or proxy blocking the connection");
                console.error("");
                console.error("   Recommended solutions:");
                console.error("   - Check MongoDB Atlas cluster status");
                console.error("   - Update MONGO_URI in environment variables");
                console.error("   - Ensure your IP is whitelisted in MongoDB Atlas");
                console.error("   - Try updating MongoDB driver: npm update mongodb");
                // For deployment, we'll continue with a warning but not exit
                console.warn("⚠️  Warning: Running without database connection. Some features may not work.");
                isConnected = false;
                return null;
            }
            // For other errors, still exit
            process.exit(1);
        }
    });
}
function getDB() {
    if (!isConnected) {
        console.warn("⚠️  Warning: Database not connected. This may cause some features to not work properly.");
        // Return a mock database object for basic functionality
        return {
            collection: (name) => {
                console.warn(`⚠️  Warning: Using mock collection '${name}'. Data will not be persisted.`);
                return {
                    find: () => ({ toArray: () => [] }),
                    findOne: () => ({}),
                    insertOne: () => ({ acknowledged: true, insertedId: 'mock-id' }),
                    updateOne: () => ({ matchedCount: 0, modifiedCount: 0 }),
                    deleteOne: () => ({ deletedCount: 0 }),
                };
            }
        };
    }
    return db;
}
function closeDB() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (client) {
                yield client.close();
            }
            console.log("✅ MongoDB connection closed");
        }
        catch (err) {
            console.error("❌ Error closing MongoDB connection:", err);
        }
    });
}
// Graceful shutdown
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
