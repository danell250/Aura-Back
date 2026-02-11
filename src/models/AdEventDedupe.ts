import { Db, Collection } from 'mongodb';

export interface IAdEventDedupe {
  adId: string;
  eventType: string; // 'impression' | 'click' | 'engagement' | 'conversion'
  fingerprint: string; // User IP, ID, or browser fingerprint
  dateKey: string; // YYYY-MM-DD
  createdAt: number;
}

let adEventDedupesCollection: Collection<IAdEventDedupe>;

export const initializeAdEventDedupesCollection = async (db: Db) => {
  adEventDedupesCollection = db.collection<IAdEventDedupe>('adEventDedupes');
  
  // Create unique index to prevent bot/refresh inflation
  await adEventDedupesCollection.createIndex(
    { adId: 1, eventType: 1, fingerprint: 1, dateKey: 1 },
    { unique: true }
  );
};

export const getAdEventDedupesCollection = (): Collection<IAdEventDedupe> => {
  if (!adEventDedupesCollection) {
    throw new Error('AdEventDedupes collection not initialized.');
  }
  return adEventDedupesCollection;
};
