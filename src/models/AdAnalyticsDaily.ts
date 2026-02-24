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
  uniqueReach: number;
  spend: number;
  updatedAt: number;
  createdAt?: number;
}

let adAnalyticsDailyCollection: Collection<IAdAnalyticsDaily>;

export const initializeAdAnalyticsDailyCollection = async (db: Db) => {
  adAnalyticsDailyCollection = db.collection<IAdAnalyticsDaily>('adAnalyticsDaily');
};

export const getAdAnalyticsDailyCollection = (): Collection<IAdAnalyticsDaily> => {
  if (!adAnalyticsDailyCollection) {
    throw new Error('AdAnalyticsDaily collection not initialized.');
  }
  return adAnalyticsDailyCollection;
};
