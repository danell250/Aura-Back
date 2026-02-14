import dotenv from 'dotenv';
import { connectDB, getDB } from '../src/db';

dotenv.config({ path: '.env.test' });

beforeAll(async () => {
  // Connect to the database before running any tests
  // We use a separate test database
  process.env.MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/aura_test';
  await connectDB();
});

afterAll(async () => {
  // Disconnect or clean up if necessary
  const db = getDB();
  if (db) {
    // Optional: Drop the test database after all tests are done
    // await db.dropDatabase();
  }
});

// Helper to clear collections
export const clearDatabase = async () => {
  const db = getDB();
  if (db) {
    const collections = await db.listCollections().toArray();
    for (const collection of collections) {
      await db.collection(collection.name).deleteMany({});
    }
  }
};
