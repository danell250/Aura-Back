import { Collection, Db } from 'mongodb';

export interface IMessageGroupParticipant {
  type: 'user' | 'company';
  id: string;
  joinedAt: Date;
}

export interface IMessageGroup {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
  createdByType: 'user' | 'company';
  createdById: string;
  participants: IMessageGroupParticipant[];
  participantKeys: string[];
  createdAt: Date;
  updatedAt: Date;
}

let messageGroupsCollection: Collection<IMessageGroup>;

export const initializeMessageGroupCollection = async (db: Db) => {
  messageGroupsCollection = db.collection<IMessageGroup>('message_groups');

  await Promise.all([
    messageGroupsCollection.createIndex({ id: 1 }, { unique: true, background: true }),
    messageGroupsCollection.createIndex({ participantKeys: 1 }, { background: true }),
    messageGroupsCollection.createIndex({ createdAt: -1 }, { background: true }),
  ]);
};

export const getMessageGroupsCollection = (): Collection<IMessageGroup> => {
  if (!messageGroupsCollection) {
    throw new Error('Message groups collection not initialized. Call initializeMessageGroupCollection first.');
  }
  return messageGroupsCollection;
};
