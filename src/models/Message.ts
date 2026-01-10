import { MongoClient, Db, Collection, ObjectId } from 'mongodb';

export interface IMessage {
  _id?: ObjectId;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: Date;
  isRead: boolean;
  messageType: 'text' | 'image' | 'file';
  mediaUrl?: string;
  replyTo?: string;
  isEdited: boolean;
  editedAt?: Date;
}

// This will be initialized when the database connection is established
let messagesCollection: Collection<IMessage>;

export const initializeMessageCollection = (db: Db) => {
  messagesCollection = db.collection<IMessage>('messages');
  
  // Create indexes for better performance
  messagesCollection.createIndex({ senderId: 1, receiverId: 1, timestamp: -1 });
  messagesCollection.createIndex({ receiverId: 1, isRead: 1 });
  messagesCollection.createIndex({ timestamp: -1 });
};

export const getMessagesCollection = (): Collection<IMessage> => {
  if (!messagesCollection) {
    throw new Error('Messages collection not initialized. Call initializeMessageCollection first.');
  }
  return messagesCollection;
};