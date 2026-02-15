import dotenv from 'dotenv';
import { closeDB, connectDB, getDBOptional } from '../src/db';

dotenv.config({ path: '.env.test' });

jest.setTimeout(90000);

beforeAll(async () => {
  // Connect to the database before running any tests
  // We use a separate test database
  process.env.MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/aura_test';
  process.env.MONGO_DB_NAME = process.env.MONGO_DB_NAME_TEST || 'aura_test';
  const connectedDb = await connectDB();
  if (!connectedDb) {
    throw new Error('Test database connection could not be established.');
  }
});

afterAll(async () => {
  await closeDB();
});

// Helper to clear collections
export const clearDatabase = async () => {
  const db = getDBOptional();
  if (db) {
    const collections = await db.listCollections().toArray();
    for (const collection of collections) {
      await db.collection(collection.name).deleteMany({});
    }
  }
};
