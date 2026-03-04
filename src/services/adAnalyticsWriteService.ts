import type { Db } from 'mongodb';

type RecordImpressionAnalyticsInput = {
  adId: string;
  ownerId: string;
  ownerType: string;
  dateKey: string;
  now: number;
  cpi: number;
  incrementUniqueReach: boolean;
};

export const recordImpressionAnalytics = async (
  db: Db,
  input: RecordImpressionAnalyticsInput
): Promise<void> => {
  const { adId, ownerId, ownerType, dateKey, now, cpi, incrementUniqueReach } = input;
  const dailyInc: Record<string, number> = {
    impressions: 1,
    spend: cpi
  };
  if (incrementUniqueReach) {
    dailyInc.uniqueReach = 1;
  }

  await Promise.all([
    db.collection('adAnalyticsDaily').updateOne(
      { adId, ownerId, ownerType, dateKey },
      {
        $inc: dailyInc,
        $set: { updatedAt: now },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    ),
    db.collection('adAnalytics').updateOne(
      { adId },
      [
        {
          $set: {
            impressions: { $add: [{ $ifNull: ['$impressions', 0] }, 1] },
            spend: { $add: [{ $ifNull: ['$spend', 0] }, cpi] },
            ownerId,
            ownerType,
            lastUpdated: now
          }
        },
        {
          $set: {
            ctr: {
              $cond: [
                { $gt: ['$impressions', 0] },
                { $multiply: [{ $divide: [{ $ifNull: ['$clicks', 0] }, '$impressions'] }, 100] },
                0
              ]
            }
          }
        }
      ],
      { upsert: true }
    ),
    db.collection('adDailyRollups').updateOne(
      { adId, ownerId, ownerType, dateKey },
      {
        $inc: { impressions: 1 },
        $set: { lastUpdated: now }
      },
      { upsert: true }
    )
  ]);
};
