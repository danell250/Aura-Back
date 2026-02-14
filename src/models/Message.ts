import { MongoClient, Db, Collection, ObjectId } from 'mongodb';

export interface IMessage {
  _id?: ObjectId;
  senderId: string;
  senderOwnerType?: 'user' | 'company';
  senderOwnerId?: string;
  receiverId: string;
  receiverOwnerType?: 'user' | 'company';
  receiverOwnerId?: string;
  text: string;
  timestamp: Date;
  isRead: boolean;
  messageType: 'text' | 'image' | 'file';
  mediaUrl?: string;
  mediaKey?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  replyTo?: string;
  isEdited: boolean;
  editedAt?: Date;
  deletedFor?: string[];
}

// This will be initialized when the database connection is established
let messagesCollection: Collection<IMessage>;

export const initializeMessageCollection = (db: Db) => {
  messagesCollection = db.collection<IMessage>('messages');
  
  // Create indexes for better performance
  messagesCollection.createIndex({ senderId: 1, receiverId: 1, timestamp: -1 });
  messagesCollection.createIndex({ senderOwnerType: 1, senderOwnerId: 1, receiverOwnerType: 1, receiverOwnerId: 1, timestamp: -1 });
  messagesCollection.createIndex({ receiverId: 1, isRead: 1 });
  messagesCollection.createIndex({ receiverOwnerType: 1, receiverOwnerId: 1, isRead: 1 });
  messagesCollection.createIndex({ timestamp: -1 });
};

export const getMessagesCollection = (): Collection<IMessage> => {
  if (!messagesCollection) {
    throw new Error('Messages collection not initialized. Call initializeMessageCollection first.');
  }
  return messagesCollection;
};
