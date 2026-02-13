import { Db, Collection, ObjectId } from 'mongodb';

export interface IUser {
  _id?: ObjectId;
  id: string;
  email: string;
  handle: string;
  name?: string;
  avatar?: string;
  avatarKey?: string;
  coverImage?: string;
  coverKey?: string;
  bio?: string;
  location?: string;
  website?: string;
  joinDate?: string;
  acquaintances?: string[];
  sentAcquaintanceRequests?: string[];
  notifications?: any[];
  auraCredits?: number;
  isPrivate?: boolean;
  userMode?: 'creator' | 'corporate' | 'hybrid';
  googleId?: string;
  githubId?: string;
  linkedinId?: string;
  discordId?: string;
  magicLinkToken?: string;
  magicLinkExpires?: Date;
  updatedAt?: string;
  createdAt?: string;
}

// This will be initialized when the database connection is established
let usersCollection: Collection<IUser>;

export const initializeUserCollection = async (db: Db) => {
  usersCollection = db.collection<IUser>('users');
  
  // Create unique index on email (case-insensitive)
  // This ensures that "JF2795584@gmail.com" and "jf2795584@gmail.com" are treated as the same
  // and prevents duplicate accounts with the same email.
  try {
    await usersCollection.createIndex(
      { email: 1 },
      { 
        unique: true, 
        collation: { locale: 'en', strength: 2 },
        background: true,
        name: 'email_unique_case_insensitive'
      }
    );
    console.log("✅ User collection initialized with unique email index");
  } catch (error) {
    console.warn("⚠️  Warning: Could not create unique email index:", error);
  }

  // Create unique index on handle (case-insensitive)
  try {
    await usersCollection.createIndex(
      { handle: 1 },
      { 
        unique: true, 
        collation: { locale: 'en', strength: 2 },
        background: true,
        name: 'handle_unique_case_insensitive'
      }
    );
  } catch (error) {
    console.warn("⚠️  Warning: Could not create unique handle index:", error);
  }

  // Create index on id for fast lookups
  try {
    await usersCollection.createIndex({ id: 1 }, { unique: true, background: true });
  } catch (error) {
    console.warn("⚠️  Warning: Could not create id index:", error);
  }
};

export const getUsersCollection = (): Collection<IUser> => {
  if (!usersCollection) {
    throw new Error('Users collection not initialized. Call initializeUserCollection first.');
  }
  return usersCollection;
};
