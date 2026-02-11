import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";
import { initializeMessageCollection } from "./models/Message";
import { initializeUserCollection } from "./models/User";
import { initializeAdAnalyticsDailyCollection } from "./models/AdAnalyticsDaily";
import { initializeAdEventDedupesCollection } from "./models/AdEventDedupe";

dotenv.config();

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

const client = new MongoClient(mongoUri || "mongodb://localhost:27017/aura", connectionOptions);
let db: Db;
let isConnected = false;
let connectionAttempts = 0;
const maxRetries = 5;
let reconnectInterval: NodeJS.Timeout | null = null;

// Connection state management
export function isDBConnected(): boolean {
  return isConnected;
}

// Enhanced connection function with retry logic
export async function connectDB(): Promise<Db | null> {
  connectionAttempts++;
  
  try {
    console.log(`🔄 Attempting to connect to MongoDB (attempt ${connectionAttempts}/${maxRetries})...`);
    
    await client.connect();
    
    // Test the connection
    db = client.db("aura");
    await db.command({ ping: 1 });
    isConnected = true;
    connectionAttempts = 0; // Reset on successful connection
    
    // Initialize collections
    try {
      initializeMessageCollection(db);
      console.log("✅ Message collection initialized");
      
      await initializeUserCollection(db);
      
      await initializeAdAnalyticsDailyCollection(db);
      console.log("✅ AdAnalyticsDaily collection initialized");
      
      await initializeAdEventDedupesCollection(db);
      console.log("✅ AdEventDedupes collection initialized");
    } catch (error) {
      console.warn("⚠️  Warning: Could not initialize collections:", error);
    }
    
    console.log("✅ Connected to MongoDB successfully");
    console.log(`📊 MongoDB connected to database: aura`);
    
    // Set up connection monitoring
    setupConnectionMonitoring();
    
    return db;
  } catch (err) {
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
      } else if (err.message.includes('authentication')) {
        console.error("🔐 Authentication Error:");
        console.error("   - Check your MongoDB username and password");
        console.error("   - Verify database user permissions");
        console.error("   - Ensure the user has access to the 'aura' database");
      } else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
        console.error("🌐 Network Error:");
        console.error("   - Check your internet connection");
        console.error("   - Verify the MongoDB server address");
        console.error("   - Check if MongoDB service is running (for local connections)");
      }
    }
    
    isConnected = false;
    
    // Retry logic
    if (connectionAttempts < maxRetries) {
      const retryDelay = Math.min(1000 * Math.pow(2, connectionAttempts - 1), 30000); // Exponential backoff, max 30s
      console.log(`🔄 Retrying connection in ${retryDelay / 1000} seconds...`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return connectDB();
    } else {
      console.warn("⚠️  Warning: Max connection attempts reached. Running without database connection.");
      console.warn("⚠️  Some features may not work properly. The server will continue with mock data.");
      
      // Start periodic reconnection attempts
      startPeriodicReconnection();
      
      return null;
    }
  }
}

// Set up connection monitoring
function setupConnectionMonitoring() {
  // Monitor connection events
  client.on('serverHeartbeatFailed', (event) => {
    console.warn('⚠️  MongoDB heartbeat failed:', event);
  });
  
  client.on('serverClosed', (event) => {
    console.warn('⚠️  MongoDB server connection closed:', event);
    isConnected = false;
    startPeriodicReconnection();
  });
  
  client.on('topologyClosed', () => {
    console.warn('⚠️  MongoDB topology closed');
    isConnected = false;
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
  
  reconnectInterval = setInterval(async () => {
    if (!isConnected) {
      console.log('🔄 Attempting to reconnect to MongoDB...');
      connectionAttempts = 0; // Reset attempts for reconnection
      try {
        await connectDB();
        if (isConnected && reconnectInterval) {
          clearInterval(reconnectInterval);
          reconnectInterval = null;
          console.log('✅ Successfully reconnected to MongoDB');
        }
      } catch (error) {
        console.log('❌ Reconnection attempt failed, will retry...');
      }
    }
  }, 30000); // Try to reconnect every 30 seconds
}

export function getDB(): Db {
  if (!isConnected || !db) {
    throw new Error("Database not connected");
  }
  return db;
}

// Health check function
export async function checkDBHealth(): Promise<boolean> {
  try {
    if (!isConnected || !db) {
      return false;
    }
    
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    console.warn('⚠️  Database health check failed:', error);
    isConnected = false;
    startPeriodicReconnection();
    return false;
  }
}

// Graceful shutdown
export async function closeDB(): Promise<void> {
  try {
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
    
    if (client) {
      await client.close();
      isConnected = false;
    }
    console.log("✅ MongoDB connection closed gracefully");
  } catch (err) {
    console.error("❌ Error closing MongoDB connection:", err);
  }
}

// Graceful shutdown handlers
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

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

// Export connection status for health checks
export { isConnected };
