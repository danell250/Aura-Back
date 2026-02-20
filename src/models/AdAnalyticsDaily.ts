import { Db, Collection } from 'mongodb';

export interface IAdAnalyticsDaily {
  adId: string;
  ownerId: string;
  ownerType?: 'user' | 'company';
  dateKey: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  engagement: number;
  conversions: number;
  spend: number;
  updatedAt: number;
}



export const initializeAdAnalyticsDailyCollection = async (db: Db) => {
  adAnalyticsDailyCollection = db.collection<IAdAnalyticsDaily>('adAnalyticsDaily');
  
  // Create indexes for performance and uniqueness
  await adAnalyticsDailyCollection.createIndex(
    { adId: 1, dateKey: 1 },
    { unique: true }
  );
  
  await adAnalyticsDailyCollection.createIndex(
    { ownerId: 1, dateKey: 1 }
  );
};

export const getAdAnalyticsDailyCollection = (): Collection<IAdAnalyticsDaily> => {
  if (!adAnalyticsDailyCollection) {
    throw new Error('AdAnalyticsDaily collection not initialized.');
  }
  return adAnalyticsDailyCollection;
};
