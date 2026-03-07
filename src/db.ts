import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";
import { initializeMessageCollection } from "./models/Message";
import { initializeMessageThreadCollection } from "./models/MessageThread";
import { initializeMessageGroupCollection } from "./models/MessageGroup";
import { initializeUserCollection } from "./models/User";
import { initializeAdAnalyticsDailyCollection } from "./models/AdAnalyticsDaily";
import { initializeAdEventDedupesCollection } from "./models/AdEventDedupe";
import { initializeCallLogsCollection } from "./models/CallLog";
import { runIndexMigration } from "./db/addMissingIndexes";

dotenv.config();

const DEFAULT_MONGO_URI = "mongodb://localhost:27017/aura";
const DEFAULT_DB_NAME = "aura";

const getMongoUri = () => process.env.MONGO_URI || DEFAULT_MONGO_URI;
const getDbName = () => process.env.MONGO_DB_NAME || DEFAULT_DB_NAME;

const buildConnectionOptions = (uri: string) => {
  const options: ConstructorParameters<typeof MongoClient>[1] = {
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

let client: MongoClient | null = null;
let clientUri: string | null = null;
let db: Db | undefined;
let isConnected = false;
let connectionAttempts = 0;
const maxRetries = 5;
let reconnectInterval: NodeJS.Timeout | null = null;
let monitoringClient: MongoClient | null = null;
let indexMigrationCompleted = false;

const initializeCoreCollections = async (db: Db): Promise<void> => {
  await initializeMessageCollection(db);
  console.log("✅ Message collection initialized");

  await initializeMessageThreadCollection(db);
  console.log("✅ Message thread collection initialized");

  await initializeMessageGroupCollection(db);
  console.log("✅ Message group collection initialized");

  await initializeCallLogsCollection(db);
  console.log("✅ Call logs collection initialized");

  await initializeUserCollection(db);

  await initializeAdAnalyticsDailyCollection(db);
  console.log("✅ AdAnalyticsDaily collection initialized");

  await initializeAdEventDedupesCollection(db);
  console.log("✅ AdEventDedupes collection initialized");
};

// Connection state management
export function isDBConnected(): boolean {
  return isConnected;
}

// Enhanced connection function with retry logic
export async function connectDB(): Promise<Db | null> {
  connectionAttempts++;
  
  try {
    console.log(`🔄 Attempting to connect to MongoDB (attempt ${connectionAttempts}/${maxRetries})...`);

    const mongoUri = getMongoUri();
    if (!client || clientUri !== mongoUri) {
      if (client) {
        try {
          await client.close();
        } catch {
          // Ignore close failures when rotating clients.
        }
      }

      client = new MongoClient(mongoUri, buildConnectionOptions(mongoUri));
      clientUri = mongoUri;
      setupConnectionMonitoring();
    }

    await client.connect();
    
    // Test the connection
    db = client.db(getDbName());
    await db.command({ ping: 1 });
    isConnected = true;
    connectionAttempts = 0; // Reset on successful connection
    
    // Initialize collections
    try {
      await initializeCoreCollections(db);

      // Initialize Company and Invite indexes
      try {
        await db.collection('companies').createIndex({ id: 1 }, { unique: true });
        await db.collection('companies').createIndex({ ownerId: 1 });
        await db.collection('companies').createIndex(
          { handle: 1 },
          { 
            unique: true, 
            collation: { locale: 'en', strength: 2 },
            background: true,
            sparse: true,
            name: 'company_handle_unique_case_insensitive'
          }
        );
        await db.collection('company_members').createIndex(
          { companyId: 1, userId: 1 },
          { unique: true, name: 'companyId_1_userId_1' },
        );
        await db.collection('company_members').createIndex({ userId: 1 });
        await db.collection('company_invites').createIndex({ token: 1 }, { unique: true });
        await db.collection('company_invites').createIndex({ email: 1 });
        await db.collection('company_invites').createIndex({ companyId: 1 });
        await db.collection('company_invites').createIndex({ invitedByUserId: 1, createdAt: -1 });
        await db.collection('company_media').createIndex({ companyId: 1, createdAt: -1 });
        await db.collection('company_media').createIndex({ companyId: 1, createdAt: -1, _id: -1 });
        console.log("✅ Company and Invite indexes initialized");
      } catch (companyIndexError) {
        console.warn("⚠️  Warning: Could not initialize company indexes:", companyIndexError);
      }

      // Initialize Post collection indexes
      try {
        await db.collection('posts').createIndex({ 'author.id': 1 });
        await db.collection('posts').createIndex({ id: 1 }, { unique: true });
        await db.collection('posts').createIndex({ timestamp: -1 });
        await db.collection('posts').createIndex({ visibility: 1 });
        await db.collection('posts').createIndex({ ownerId: 1, visibility: 1, timestamp: -1 });
        await db.collection('posts').createIndex({ isTimeCapsule: 1, unlockDate: 1 });
        await db.collection('posts').createIndex({ hashtags: 1 });
        await db.collection('posts').createIndex({ energy: 1 });
        console.log("✅ Post collection indexes initialized");
      } catch (postIndexError) {
        console.warn("⚠️  Warning: Could not initialize post indexes:", postIndexError);
      }

      // Initialize jobs and applications indexes
      try {
        await db.collection('jobs').createIndex({ id: 1 }, { unique: true });
        await db.collection('jobs').createIndex({ companyId: 1, status: 1, createdAt: -1 });
        await db.collection('jobs').createIndex({ status: 1, publishedAt: -1 });
        await db.collection('jobs').createIndex({ applicationDeadline: 1 });
        await db.collection('jobs').createIndex({ tags: 1 });
        await db.collection('jobs').createIndex(
          { source: 1, originalId: 1 },
          {
            name: 'idx_jobs_source_original_id',
            unique: true,
            partialFilterExpression: {
              source: { $type: 'string' },
              originalId: { $type: 'string' },
            },
          }
        );
        await db.collection('jobs').createIndex(
          { source: 1, originalUrl: 1 },
          {
            name: 'idx_jobs_source_original_url',
            unique: true,
            partialFilterExpression: {
              source: { $type: 'string' },
              originalUrl: { $type: 'string' },
            },
          }
        );

        await db.collection('job_applications').createIndex({ id: 1 }, { unique: true });
        await db.collection('job_applications').createIndex(
          { jobId: 1, applicantUserId: 1 },
          { unique: true, name: 'job_application_unique_per_user' }
        );
        await db.collection('job_applications').createIndex({ companyId: 1, status: 1, createdAt: -1 });
        await db.collection('job_applications').createIndex({ applicantUserId: 1, createdAt: -1 });
        await db.collection('job_applications').createIndex({ jobId: 1, status: 1, createdAt: -1 });
        await db.collection('saved_jobs').createIndex(
          { userId: 1, jobId: 1 },
          { unique: true, name: 'saved_jobs_user_job_unique_idx' }
        );
        await db.collection('saved_jobs').createIndex(
          { userId: 1, createdAt: -1 },
          { name: 'saved_jobs_user_created_idx' }
        );
        await db.collection('job_applications').createIndex(
          { jobId: 1, applicantNameNormalized: 1, createdAt: -1 },
          { name: 'job_application_job_name_search_idx' }
        );
        await db.collection('job_applications').createIndex(
          { jobId: 1, applicantEmailNormalized: 1, createdAt: -1 },
          { name: 'job_application_job_email_search_idx' }
        );
        await db.collection('application_notes').createIndex({ id: 1 }, { unique: true });
        await db.collection('application_notes').createIndex({ applicationId: 1, createdAt: 1 });
        await db.collection('application_notes').createIndex({ jobId: 1, createdAt: 1 });
        await db.collection('application_notes').createIndex({ companyId: 1, createdAt: -1 });
        await db.collection('application_notes').createIndex({ authorId: 1, createdAt: -1 });
        await db.collection('learning_resources_cache').createIndex({ cacheKey: 1 }, { unique: true });
        await db.collection('learning_resources_cache').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        console.log("✅ Jobs collection indexes initialized");
      } catch (jobsIndexError) {
        console.warn("⚠️  Warning: Could not initialize jobs indexes:", jobsIndexError);
      }

      // Initialize scheduled report indexes
      try {
        await db.collection('reportSchedules').createIndex({ id: 1 }, { unique: true });
        await db.collection('reportSchedules').createIndex({ ownerId: 1, ownerType: 1, status: 1 });
        await db.collection('reportSchedules').createIndex({ status: 1, nextRunAt: 1, processing: 1 });
        console.log("✅ Report schedule indexes initialized");
      } catch (reportIndexError) {
        console.warn("⚠️  Warning: Could not initialize report schedule indexes:", reportIndexError);
      }

      // Initialize payment/idempotency indexes
      try {
        await db.collection('transactions').createIndex(
          { type: 1, paymentReferenceKey: 1 },
          {
            unique: true,
            partialFilterExpression: { paymentReferenceKey: { $type: 'string' } },
            name: 'tx_type_payment_reference_unique'
          }
        );
        await db.collection('transactions').createIndex(
          { type: 1, transactionId: 1 },
          { name: 'tx_type_transaction_id_idx' }
        );
        await db.collection('transactions').createIndex(
          { orderId: 1 },
          { sparse: true, name: 'tx_order_id_idx' }
        );
        console.log("✅ Payment idempotency indexes initialized");
      } catch (paymentIndexError) {
        console.warn("⚠️  Warning: Could not initialize payment indexes:", paymentIndexError);
      }

    } catch (error) {
      console.warn("⚠️  Warning: Could not initialize collections:", error);
    }

    if (!indexMigrationCompleted) {
      try {
        await runIndexMigration(db);
        indexMigrationCompleted = true;
      } catch (migrationError) {
        console.warn("⚠️  Warning: Could not run index migration:", migrationError);
      }
    }
    
    console.log("✅ Connected to MongoDB successfully");
    console.log(`📊 MongoDB connected to database: aura`);
    
    // Set up connection monitoring
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
  if (!client || monitoringClient === client) {
    return;
  }

  monitoringClient = client;
  const isTestEnv = process.env.NODE_ENV === 'test';

  // Monitor connection events
  monitoringClient.on('serverHeartbeatFailed', (event) => {
    if (!isTestEnv) {
      console.warn('⚠️  MongoDB heartbeat failed:', event);
    }
  });
  
  monitoringClient.on('serverClosed', (event) => {
    if (!isTestEnv) {
      console.warn('⚠️  MongoDB server connection closed:', event);
    }
    isConnected = false;
    startPeriodicReconnection();
  });
  
  monitoringClient.on('topologyClosed', () => {
    if (!isTestEnv) {
      console.warn('⚠️  MongoDB topology closed');
    }
    isConnected = false;
    startPeriodicReconnection();
  });
  
  monitoringClient.on('serverOpening', () => {
    if (!isTestEnv) {
      console.log('✅ MongoDB server connection opening');
    }
  });
  
  monitoringClient.on('topologyOpening', () => {
    if (!isTestEnv) {
      console.log('✅ MongoDB topology opening');
    }
  });
}

// Start periodic reconnection attempts
function startPeriodicReconnection() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

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

export function getDBOptional(): Db | null {
  if (!isConnected || !db) {
    return null;
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
      client = null;
      clientUri = null;
      monitoringClient = null;
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
