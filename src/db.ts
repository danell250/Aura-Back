import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017/aura", {
  tls: true,
  tlsAllowInvalidCertificates: false,
  tlsAllowInvalidHostnames: false,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});
let db: Db;

export async function connectDB() {
  try {
    await client.connect();
    db = client.db("aura"); // your database name
    console.log("✅ Connected to MongoDB successfully");
    return db;
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    
    // If it's an SSL/TLS error, provide helpful error message and exit
    if (err instanceof Error && (err.message.includes('SSL') || err.message.includes('TLS'))) {
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
    }
    
    process.exit(1);
  }
}

export function getDB() {
  if (!db) {
    throw new Error("Database not connected. Call connectDB() first.");
  }
  return db;
}

export async function closeDB() {
  try {
    if (client) {
      await client.close();
    }
    console.log("✅ MongoDB connection closed");
  } catch (err) {
    console.error("❌ Error closing MongoDB connection:", err);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  await closeDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  await closeDB();
  process.exit(0);
});
