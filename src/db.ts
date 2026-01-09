import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017/aura");
let db: Db;

export async function connectDB() {
  try {
    await client.connect();
    db = client.db("aura"); // your database name
    console.log("✅ Connected to MongoDB successfully");
    return db;
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
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
    await client.close();
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
