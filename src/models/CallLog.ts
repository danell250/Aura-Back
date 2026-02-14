import { Collection, Db, ObjectId } from 'mongodb';

export type CallType = 'audio' | 'video';
export type CallStatus =
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'missed'
  | 'ended'
  | 'cancelled'
  | 'failed';

export interface ICallLog {
  _id?: ObjectId;
  callId: string;
  callType: CallType;
  fromType: 'user' | 'company';
  fromId: string;
  toType: 'user' | 'company';
  toId: string;
  initiatedByUserId?: string;
  status: CallStatus;
  startedAt: Date;
  acceptedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  endReason?: string;
  seenBy?: string[];
  createdAt: Date;
  updatedAt: Date;
}

let callLogsCollection: Collection<ICallLog>;

export const initializeCallLogsCollection = async (db: Db) => {
  callLogsCollection = db.collection<ICallLog>('call_logs');

  await Promise.all([
    callLogsCollection.createIndex({ callId: 1 }, { unique: true }),
    callLogsCollection.createIndex({ toType: 1, toId: 1, status: 1, startedAt: -1 }),
    callLogsCollection.createIndex({ fromType: 1, fromId: 1, startedAt: -1 }),
    callLogsCollection.createIndex({ fromType: 1, fromId: 1, toType: 1, toId: 1, startedAt: -1 }),
  ]);
};

export const getCallLogsCollection = (): Collection<ICallLog> => {
  if (!callLogsCollection) {
    throw new Error('Call logs collection not initialized. Call initializeCallLogsCollection first.');
  }
  return callLogsCollection;
};
