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
const client = new mongodb_1.MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017/aura");
let db;
function connectDB() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield client.connect();
            db = client.db("aura"); // your database name
            console.log("✅ Connected to MongoDB successfully");
            return db;
        }
        catch (err) {
            console.error("❌ MongoDB connection error:", err);
            process.exit(1);
        }
    });
}
function getDB() {
    if (!db) {
        throw new Error("Database not connected. Call connectDB() first.");
    }
    return db;
}
function closeDB() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield client.close();
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
