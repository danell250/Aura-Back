import { Collection, Db, ObjectId } from 'mongodb';

export type MessageThreadState = 'active' | 'archived' | 'requests' | 'muted' | 'blocked';

export interface IMessageThread {
  _id?: ObjectId;
  key: string;
  ownerType: 'user' | 'company';
  ownerId: string;
  peerType: 'user' | 'company';
  peerId: string;
  state: MessageThreadState;
  archived?: boolean;
  muted?: boolean;
  blocked?: boolean;
  assignmentUserId?: string;
  assignedByUserId?: string;
  assignedAt?: Date;
  internalNotes?: string;
  cannedReplies?: string[];
  campaignTags?: string[];
  slaMinutes?: number;
  createdAt: Date;
  updatedAt: Date;
}

let messageThreadsCollection: Collection<IMessageThread>;

export const buildMessageThreadKey = (
  ownerType: 'user' | 'company',
  ownerId: string,
  peerType: 'user' | 'company',
  peerId: string
): string => `${ownerType}:${ownerId}::${peerType}:${peerId}`;

export const initializeMessageThreadCollection = async (db: Db) => {
  messageThreadsCollection = db.collection<IMessageThread>('message_threads');

  await Promise.all([
    messageThreadsCollection.createIndex({ key: 1 }, { unique: true }),
    messageThreadsCollection.createIndex({ ownerType: 1, ownerId: 1, state: 1, updatedAt: -1 }),
    messageThreadsCollection.createIndex({ ownerType: 1, ownerId: 1, peerId: 1 }),
  ]);
};

export const getMessageThreadsCollection = (): Collection<IMessageThread> => {
  if (!messageThreadsCollection) {
    throw new Error('Message threads collection not initialized. Call initializeMessageThreadCollection first.');
  }
  return messageThreadsCollection;
};
