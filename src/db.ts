import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017/aura", {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  // Use TLS options that work with MongoDB Atlas
  tls: true,
  tlsAllowInvalidCertificates: false,
  tlsAllowInvalidHostnames: false,
});
let db: Db;

let isConnected = false;

export async function connectDB() {
  try {
    await client.connect();
    db = client.db("aura"); // your database name
    isConnected = true;
    console.log("✅ Connected to MongoDB successfully");
    return db;
  } catch (err) {
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
      return null as any;
    }
    
    // For other errors, still exit
    process.exit(1);
  }
}

export function getDB() {
  if (!isConnected) {
    console.warn("⚠️  Warning: Database not connected. This may cause some features to not work properly.");
    // Return a mock database object for basic functionality
    return {
      collection: (name: string) => {
        console.warn(`⚠️  Warning: Using mock collection '${name}'. Data will not be persisted.`);
        return {
          find: () => ({ toArray: () => [] }),
          findOne: () => ({}),
          insertOne: () => ({ acknowledged: true, insertedId: 'mock-id' }),
          updateOne: () => ({ matchedCount: 0, modifiedCount: 0 }),
          deleteOne: () => ({ deletedCount: 0 }),
        };
      }
    } as any;
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
