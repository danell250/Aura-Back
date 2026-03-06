import { Db } from 'mongodb';
import { readString } from '../utils/inputSanitizers';

const OPEN_TO_WORK_DAILY_METRICS_COLLECTION = 'user_open_to_work_daily_metrics';
const OPEN_TO_WORK_METRICS_WINDOW_DAYS = 7;
const OPEN_TO_WORK_METRICS_CACHE_TTL_MS = 5 * 60 * 1000;

const metricsCache = new Map<string, {
  expiresAt: number;
  metrics: {
    profileViews7d: number;
    companyViews7d: number;
    invitesToApply7d: number;
  };
}>();
let metricsIndexesPromise: Promise<void> | null = null;

const buildUtcDayKey = (date: Date): string => date.toISOString().slice(0, 10);

const buildUtcDayDate = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
};

const pruneMetricsCache = (now: number): void => {
  for (const [key, entry] of metricsCache.entries()) {
    if (entry.expiresAt <= now) {
      metricsCache.delete(key);
    }
  }
  while (metricsCache.size > 500) {
    const oldest = metricsCache.keys().next();
    if (oldest.done) break;
    metricsCache.delete(oldest.value);
  }
};

const invalidateMetricsCache = (userId: string): void => {
  const normalizedUserId = readString(userId, 120);
  if (!normalizedUserId) return;
  metricsCache.delete(normalizedUserId);
};

export const ensureOpenToWorkMetricsIndexes = async (db: Db): Promise<void> => {
  if (!metricsIndexesPromise) {
    metricsIndexesPromise = Promise.all([
      db.collection(OPEN_TO_WORK_DAILY_METRICS_COLLECTION).createIndex(
        { userId: 1, dateKey: 1 },
        { name: 'open_to_work_metrics_user_date_unique', unique: true },
      ),
      db.collection(OPEN_TO_WORK_DAILY_METRICS_COLLECTION).createIndex(
        { bucketDate: 1 },
        { name: 'open_to_work_metrics_bucket_ttl', expireAfterSeconds: 90 * 24 * 60 * 60 },
      ),
    ]).then(() => undefined).catch((error) => {
      metricsIndexesPromise = null;
      throw error;
    });
  }
  return metricsIndexesPromise;
};

const updateDailyMetrics = async (params: {
  db: Db;
  userId: string;
  profileViewsIncrement?: number;
  companyViewsIncrement?: number;
  invitesToApplyIncrement?: number;
}): Promise<void> => {
  const userId = readString(params.userId, 120);
  if (!userId) return;
  await ensureOpenToWorkMetricsIndexes(params.db);

  const now = new Date();
  const dateKey = buildUtcDayKey(now);
  const bucketDate = buildUtcDayDate(now);
  await params.db.collection(OPEN_TO_WORK_DAILY_METRICS_COLLECTION).updateOne(
    { userId, dateKey },
    {
      $setOnInsert: {
        userId,
        dateKey,
        bucketDate,
        createdAt: now.toISOString(),
      },
      $set: {
        updatedAt: now.toISOString(),
      },
      $inc: {
        profileViewsCount: params.profileViewsIncrement || 0,
        companyViewsCount: params.companyViewsIncrement || 0,
        invitesToApplyCount: params.invitesToApplyIncrement || 0,
      },
    },
    { upsert: true },
  );
  invalidateMetricsCache(userId);
};

export const recordOpenToWorkProfileViewMetric = async (params: {
  db: Db;
  userId: string;
  viewerIdentityType: 'user' | 'company';
}): Promise<void> => {
  await updateDailyMetrics({
    db: params.db,
    userId: params.userId,
    profileViewsIncrement: 1,
    companyViewsIncrement: params.viewerIdentityType === 'company' ? 1 : 0,
  });
};

export const recordOpenToWorkInviteMetric = async (params: {
  db: Db;
  userId: string;
}): Promise<void> => {
  await updateDailyMetrics({
    db: params.db,
    userId: params.userId,
    invitesToApplyIncrement: 1,
  });
};

export const getOpenToWorkMetrics7d = async (params: {
  db: Db;
  userId: string;
}): Promise<{
  profileViews7d: number;
  companyViews7d: number;
  invitesToApply7d: number;
}> => {
  const userId = readString(params.userId, 120);
  if (!userId) {
    return {
      profileViews7d: 0,
      companyViews7d: 0,
      invitesToApply7d: 0,
    };
  }

  const now = Date.now();
  pruneMetricsCache(now);
  const cached = metricsCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.metrics;
  }

  await ensureOpenToWorkMetricsIndexes(params.db);
  const startDate = buildUtcDayDate(new Date(now - ((OPEN_TO_WORK_METRICS_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000)));
  const rows = await params.db.collection(OPEN_TO_WORK_DAILY_METRICS_COLLECTION)
    .find(
      {
        userId,
        bucketDate: { $gte: startDate },
      },
      {
        projection: {
          profileViewsCount: 1,
          companyViewsCount: 1,
          invitesToApplyCount: 1,
        },
      },
    )
    .toArray();

  const metrics = rows.reduce(
    (acc, row: any) => ({
      profileViews7d: acc.profileViews7d + (Number(row?.profileViewsCount) || 0),
      companyViews7d: acc.companyViews7d + (Number(row?.companyViewsCount) || 0),
      invitesToApply7d: acc.invitesToApply7d + (Number(row?.invitesToApplyCount) || 0),
    }),
    {
      profileViews7d: 0,
      companyViews7d: 0,
      invitesToApply7d: 0,
    },
  );

  metricsCache.set(userId, {
    metrics,
    expiresAt: now + OPEN_TO_WORK_METRICS_CACHE_TTL_MS,
  });

  return metrics;
};
