import { readString } from '../utils/inputSanitizers';
import {
  normalizeJobPulseCount,
  resolveJobPulseDiscoveredAt,
  resolveJobPulseSourceType,
  resolveLatestJobPulseIso,
} from './jobPulseUtils';
import {
  buildJobPulseBucketWindowSumExpression,
  buildJobPulseWindowBounds,
  computeJobHeatScore,
  computeWindowedJobPulseActivityScore,
  resolveJobHeatLabel,
  type JobHeatLabel,
} from './jobPulseDomain';
import { scheduleJobPulseMetricRefreshTask } from './jobPulseMetricRefreshQueueService';

const JOBS_COLLECTION = 'jobs';
const JOB_PULSE_BUCKETS_COLLECTION = 'job_pulse_time_buckets';
const JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION = 'job_pulse_metric_snapshots';

const JOB_PULSE_CACHE_TTL_MS = 15_000;
const JOB_PULSE_METRIC_FRESHNESS_MS = 30_000;
const JOB_PULSE_INFLIGHT_REFRESH_TTL_MS = 60_000;
const JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS = 60_000;
const MAX_JOB_PULSE_SNAPSHOT_LIMIT = 40;
const MAX_PULSE_SNAPSHOT_CACHE_ENTRIES = 100;
const MAX_INFLIGHT_PULSE_METRIC_REFRESHES = 200;
const MAX_LOCAL_PULSE_METRIC_FRESHNESS_ENTRIES = 400;
const MAX_PULSE_METRIC_REFRESH_BATCH_SIZE = 12;

type PulseSnapshotCleanupTimerGlobal = typeof globalThis & {
  __auraJobPulseSnapshotCleanupTimer__?: ReturnType<typeof setInterval> | null;
};

type IndexedPulseMetric = {
  applicationsLast2h: number;
  applicationsLast24h: number;
  applicationsToday: number;
  viewsLast1h: number;
  matchesLast10m: number;
  savesToday: number;
  savesLast24h: number;
  latestAt: string | null;
};

type StoredPulseMetric = IndexedPulseMetric & {
  refreshedAtMs: number;
};

type JobPulseSnapshotIdentity = {
  slug: string;
  title: string;
  companyName: string;
  source: string | null;
  sourceType: 'aura' | 'aggregated';
  canDisplayAuraApplicants: boolean;
};

type JobPulseSnapshotTiming = {
  discoveredAt: string | null;
  publishedAt: string | null;
  postedAt: string | null;
  lastActivityAt: string | null;
};

type JobPulseSnapshotMetrics = {
  auraApplicationCount: number;
  auraViewCount: number;
  applicationsLast2h: number;
  applicationCount: number;
  applicationsToday: number;
  viewCount: number;
  applicationsLast24h: number;
  viewsLast1h: number;
  matchesLast10m: number;
  savesToday: number;
  savesLast24h: number;
};

type JobPulseSnapshotScores = {
  heatScore: number;
  heatLabel: JobHeatLabel;
  hotScore: number;
};

export type JobPulseSnapshot = {
  jobId: string;
  identity: JobPulseSnapshotIdentity;
  timing: JobPulseSnapshotTiming;
  metrics: JobPulseSnapshotMetrics;
  scores: JobPulseSnapshotScores;
};

const pulseSnapshotCache = new Map<string, { expiresAt: number; data: JobPulseSnapshot[] }>();
const inflightPulseMetricRefreshes = new Map<string, {
  promise: Promise<void>;
  createdAt: number;
}>();
const pulseMetricFreshUntilByJobId = new Map<string, number>();
let nextPulseSnapshotCacheCleanupAt = 0;
let nextInflightPulseMetricRefreshCleanupAt = 0;
let nextPulseMetricFreshnessCleanupAt = 0;

const readPulseSnapshotCleanupTimerGlobal = (): PulseSnapshotCleanupTimerGlobal =>
  globalThis as PulseSnapshotCleanupTimerGlobal;

const buildRequestedJobIds = (rawIds: string[]): string[] => {
  const seen = new Set<string>();
  const jobIds: string[] = [];
  for (const rawId of rawIds) {
    const normalized = readString(rawId, 120);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    jobIds.push(normalized);
    if (jobIds.length >= MAX_JOB_PULSE_SNAPSHOT_LIMIT) break;
  }
  return jobIds;
};

const buildPulseCacheKey = (requestedJobIds: string[], limit: number, sortBy: 'latest' | 'heat'): string =>
  requestedJobIds.length > 0
    ? `ids:${requestedJobIds.join(',')}:${limit}:${sortBy}`
    : `${sortBy}:${limit}`;

const resolveCachedPulseSnapshots = (
  cacheKey: string,
  nowMs: number,
): JobPulseSnapshot[] | null => {
  const cached = pulseSnapshotCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= nowMs) {
    pulseSnapshotCache.delete(cacheKey);
    return null;
  }
  pulseSnapshotCache.delete(cacheKey);
  pulseSnapshotCache.set(cacheKey, cached);
  return cached.data;
};

const trimPulseSnapshotCacheToLimit = (): void => {
  while (pulseSnapshotCache.size > MAX_PULSE_SNAPSHOT_CACHE_ENTRIES) {
    const oldestEntry = pulseSnapshotCache.keys().next();
    if (oldestEntry.done) break;
    pulseSnapshotCache.delete(oldestEntry.value);
  }
};

const pruneExpiredPulseSnapshotCacheEntries = (nowMs: number): void => {
  for (const [key, entry] of pulseSnapshotCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      pulseSnapshotCache.delete(key);
    }
  }
};

const maybePrunePulseSnapshotCache = (nowMs: number): void => {
  if (
    pulseSnapshotCache.size <= MAX_PULSE_SNAPSHOT_CACHE_ENTRIES
    && nowMs < nextPulseSnapshotCacheCleanupAt
  ) {
    return;
  }
  nextPulseSnapshotCacheCleanupAt = nowMs + JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS;
  pruneExpiredPulseSnapshotCacheEntries(nowMs);
  trimPulseSnapshotCacheToLimit();
};

const cachePulseSnapshots = (
  cacheKey: string,
  nowMs: number,
  snapshots: JobPulseSnapshot[],
): void => {
  maybePrunePulseSnapshotCache(nowMs);
  pulseSnapshotCache.set(cacheKey, {
    expiresAt: nowMs + JOB_PULSE_CACHE_TTL_MS,
    data: snapshots,
  });
  trimPulseSnapshotCacheToLimit();
};

const trimInflightPulseMetricRefreshesToLimit = (): void => {
  while (inflightPulseMetricRefreshes.size > MAX_INFLIGHT_PULSE_METRIC_REFRESHES) {
    const oldestEntry = inflightPulseMetricRefreshes.keys().next();
    if (oldestEntry.done) break;
    inflightPulseMetricRefreshes.delete(oldestEntry.value);
  }
};

const pruneExpiredInflightPulseMetricRefreshes = (nowMs: number): void => {
  for (const [jobId, entry] of inflightPulseMetricRefreshes.entries()) {
    if ((nowMs - entry.createdAt) >= JOB_PULSE_INFLIGHT_REFRESH_TTL_MS) {
      inflightPulseMetricRefreshes.delete(jobId);
    }
  }
};

const maybePruneInflightPulseMetricRefreshes = (nowMs: number): void => {
  if (
    inflightPulseMetricRefreshes.size <= MAX_INFLIGHT_PULSE_METRIC_REFRESHES
    && nowMs < nextInflightPulseMetricRefreshCleanupAt
  ) {
    return;
  }
  nextInflightPulseMetricRefreshCleanupAt = nowMs + JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS;
  pruneExpiredInflightPulseMetricRefreshes(nowMs);
  trimInflightPulseMetricRefreshesToLimit();
};

const trimPulseMetricFreshnessCacheToLimit = (): void => {
  while (pulseMetricFreshUntilByJobId.size > MAX_LOCAL_PULSE_METRIC_FRESHNESS_ENTRIES) {
    const oldestEntry = pulseMetricFreshUntilByJobId.keys().next();
    if (oldestEntry.done) break;
    pulseMetricFreshUntilByJobId.delete(oldestEntry.value);
  }
};

const upsertPulseMetricFreshness = (jobId: string, freshUntilMs: number): void => {
  if (!jobId) return;
  pulseMetricFreshUntilByJobId.delete(jobId);
  while (pulseMetricFreshUntilByJobId.size >= MAX_LOCAL_PULSE_METRIC_FRESHNESS_ENTRIES) {
    const oldestEntry = pulseMetricFreshUntilByJobId.keys().next();
    if (oldestEntry.done) break;
    pulseMetricFreshUntilByJobId.delete(oldestEntry.value);
  }
  pulseMetricFreshUntilByJobId.set(jobId, freshUntilMs);
};

const pruneExpiredPulseMetricFreshness = (nowMs: number): void => {
  for (const [jobId, freshUntilMs] of pulseMetricFreshUntilByJobId.entries()) {
    if (freshUntilMs <= nowMs) {
      pulseMetricFreshUntilByJobId.delete(jobId);
    }
  }
};

const maybePrunePulseMetricFreshness = (nowMs: number): void => {
  if (
    pulseMetricFreshUntilByJobId.size <= MAX_LOCAL_PULSE_METRIC_FRESHNESS_ENTRIES
    && nowMs < nextPulseMetricFreshnessCleanupAt
  ) {
    return;
  }
  nextPulseMetricFreshnessCleanupAt = nowMs + JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS;
  pruneExpiredPulseMetricFreshness(nowMs);
  trimPulseMetricFreshnessCacheToLimit();
};

const runPulseSnapshotCacheCleanup = (): void => {
  const nowMs = Date.now();
  pruneExpiredPulseSnapshotCacheEntries(nowMs);
  trimPulseSnapshotCacheToLimit();
  pruneExpiredInflightPulseMetricRefreshes(nowMs);
  trimInflightPulseMetricRefreshesToLimit();
  pruneExpiredPulseMetricFreshness(nowMs);
  trimPulseMetricFreshnessCacheToLimit();
};

export const ensureJobPulseSnapshotCleanupTimer = (): void => {
  const cleanupTimerGlobal = readPulseSnapshotCleanupTimerGlobal();
  if (cleanupTimerGlobal.__auraJobPulseSnapshotCleanupTimer__) return;
  cleanupTimerGlobal.__auraJobPulseSnapshotCleanupTimer__ = setInterval(
    runPulseSnapshotCacheCleanup,
    JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS,
  );
};

export const stopJobPulseSnapshotCleanupTimer = (): void => {
  const cleanupTimerGlobal = readPulseSnapshotCleanupTimerGlobal();
  const cleanupTimer = cleanupTimerGlobal.__auraJobPulseSnapshotCleanupTimer__;
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimerGlobal.__auraJobPulseSnapshotCleanupTimer__ = null;
};

const fetchPulseJobs = async (params: {
  db: any;
  requestedJobIds: string[];
  limit: number;
  sortBy: 'latest' | 'heat';
}): Promise<{ jobsById: Map<string, any>; orderedJobIds: string[] }> => {
  const scanLimit = params.sortBy === 'heat'
    ? Math.min(96, Math.max(params.limit * 3, 48))
    : params.limit;
  const jobs = params.requestedJobIds.length > 0
    ? await params.db.collection(JOBS_COLLECTION)
      .find(
        {
          id: { $in: params.requestedJobIds },
          status: { $ne: 'archived' },
        },
        {
          projection: {
            id: 1,
            slug: 1,
            title: 1,
            companyName: 1,
            source: 1,
            discoveredAt: 1,
            publishedAt: 1,
            createdAt: 1,
            applicationCount: 1,
            viewCount: 1,
          },
        },
      )
      .toArray()
    : await params.db.collection(JOBS_COLLECTION)
      .find(
        {
          status: 'open',
          discoveredAt: { $type: 'string', $ne: '' },
        },
        {
          projection: {
            id: 1,
            slug: 1,
            title: 1,
            companyName: 1,
            source: 1,
            discoveredAt: 1,
            publishedAt: 1,
            createdAt: 1,
            applicationCount: 1,
            viewCount: 1,
          },
        },
      )
      .sort({ discoveredAt: -1, createdAt: -1 })
      .limit(scanLimit)
      .toArray();

  const jobsById = new Map<string, any>();
  jobs.forEach((job: any) => {
    const jobId = readString(job?.id, 120);
    if (!jobId) return;
    jobsById.set(jobId, job);
  });

  const orderedJobIds = params.requestedJobIds.length > 0
    ? params.requestedJobIds.filter((jobId) => jobsById.has(jobId))
    : Array.from(jobsById.keys()).slice(0, params.limit);

  return { jobsById, orderedJobIds };
};

function buildIndexedPulseMetric(row: {
  applicationsLast2h?: number;
  applicationsLast24h?: number;
  applicationsToday?: number;
  viewsLast1h?: number;
  matchesLast10m?: number;
  savesToday?: number;
  savesLast24h?: number;
  latestAt?: string | null;
}): IndexedPulseMetric {
  return {
    applicationsLast2h: Number.isFinite(Number(row?.applicationsLast2h))
      ? Math.max(0, Math.floor(Number(row.applicationsLast2h)))
      : 0,
    applicationsLast24h: Number.isFinite(Number(row?.applicationsLast24h))
      ? Math.max(0, Math.floor(Number(row.applicationsLast24h)))
      : 0,
    applicationsToday: Number.isFinite(Number(row?.applicationsToday))
      ? Math.max(0, Math.floor(Number(row.applicationsToday)))
      : 0,
    viewsLast1h: Number.isFinite(Number(row?.viewsLast1h))
      ? Math.max(0, Math.floor(Number(row.viewsLast1h)))
      : 0,
    matchesLast10m: Number.isFinite(Number(row?.matchesLast10m))
      ? Math.max(0, Math.floor(Number(row.matchesLast10m)))
      : 0,
    savesToday: Number.isFinite(Number(row?.savesToday))
      ? Math.max(0, Math.floor(Number(row.savesToday)))
      : 0,
    savesLast24h: Number.isFinite(Number(row?.savesLast24h))
      ? Math.max(0, Math.floor(Number(row.savesLast24h)))
      : 0,
    latestAt: readPulseMetricLatestAtIso(row?.latestAt),
  };
}

const indexPulseMetricsByJobId = (
  rows: Array<{
    _id?: string;
    applicationsLast24h?: number;
    viewsLast1h?: number;
    matchesLast10m?: number;
    savesLast24h?: number;
    latestAt?: string | null;
  }>,
): Map<string, IndexedPulseMetric> => {
  const next = new Map<string, IndexedPulseMetric>();
  rows.forEach((row) => {
    const jobId = readString((row as any)?._id, 120);
    if (!jobId) return;
    next.set(jobId, buildIndexedPulseMetric({
      applicationsLast2h: (row as any)?.applicationsLast2h,
      applicationsLast24h: row?.applicationsLast24h,
      applicationsToday: (row as any)?.applicationsToday,
      viewsLast1h: row?.viewsLast1h,
      matchesLast10m: row?.matchesLast10m,
      savesToday: (row as any)?.savesToday,
      savesLast24h: row?.savesLast24h,
      latestAt: row?.latestAt,
    }));
  });
  return next;
};

const aggregatePulseMetrics = async (params: {
  db: any;
  jobIds: string[];
  nowMs: number;
}): Promise<Map<string, IndexedPulseMetric>> => {
  if (params.jobIds.length === 0) return new Map<string, IndexedPulseMetric>();

  const {
    applicationSince,
    applicationRecentSince,
    todaySince,
    viewSince,
    matchSince,
  } = buildJobPulseWindowBounds(params.nowMs);

  const rows = await params.db.collection(JOB_PULSE_BUCKETS_COLLECTION)
    .aggregate([
      {
        $match: {
          jobId: { $in: params.jobIds },
          bucketStartDate: { $gte: applicationSince },
        },
      },
      {
        $group: {
          _id: '$jobId',
          applicationsLast2h: buildJobPulseBucketWindowSumExpression('jobAppliedCount', applicationRecentSince),
          applicationsLast24h: { $sum: '$jobAppliedCount' },
          applicationsToday: buildJobPulseBucketWindowSumExpression('jobAppliedCount', todaySince),
          viewsLast1h: buildJobPulseBucketWindowSumExpression('jobViewedCount', viewSince),
          matchesLast10m: buildJobPulseBucketWindowSumExpression('jobMatchedCount', matchSince),
          savesToday: buildJobPulseBucketWindowSumExpression('jobSavedCount', todaySince),
          savesLast24h: { $sum: '$jobSavedCount' },
          latestAt: { $max: '$latestEventAt' },
        },
      },
    ])
    .toArray();

  return indexPulseMetricsByJobId(rows);
};

const buildEmptyPulseMetric = (): IndexedPulseMetric => ({
  applicationsLast2h: 0,
  applicationsLast24h: 0,
  applicationsToday: 0,
  viewsLast1h: 0,
  matchesLast10m: 0,
  savesToday: 0,
  savesLast24h: 0,
  latestAt: null,
});

const readPulseMetricRefreshedAtMs = (row: any): number => {
  const refreshedAtRaw = row?.refreshedAtDate || row?.refreshedAt;
  if (!refreshedAtRaw) return 0;
  const refreshedAtMs = new Date(refreshedAtRaw).getTime();
  return Number.isFinite(refreshedAtMs) ? refreshedAtMs : 0;
};

const readPulseMetricLatestAtIso = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return readString(String(value || ''), 80) || null;
};

export const normalizeLegacyPulseMetricViewsWindowField = async (db: any): Promise<void> => {
  const rows = await db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION)
    .find(
      {
        viewsLast1h: { $exists: false },
        viewsLast60m: { $exists: true },
      },
      {
        projection: {
          _id: 0,
          jobId: 1,
          viewsLast60m: 1,
        },
      },
    )
    .limit(500)
    .toArray();

  const operations = rows.flatMap((row: any) => {
    const jobId = readString(row?.jobId, 120);
    if (!jobId || !Number.isFinite(Number(row?.viewsLast60m))) {
      return [];
    }
    return {
      updateOne: {
        filter: {
          jobId,
          viewsLast1h: { $exists: false },
        },
        update: {
          $set: {
            viewsLast1h: Math.max(0, Math.floor(Number(row.viewsLast60m))),
          },
          $unset: {
            viewsLast60m: '',
          },
        },
      },
    };
  });
  if (operations.length === 0) return;
  await db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).bulkWrite(
    operations,
    { ordered: false },
  );
};

const readStoredPulseMetrics = async (params: {
  db: any;
  jobIds: string[];
}): Promise<Map<string, StoredPulseMetric>> => {
  if (params.jobIds.length === 0) return new Map<string, StoredPulseMetric>();
  const rows = await params.db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION)
    .aggregate([
      {
        $match: {
          jobId: { $in: params.jobIds },
        },
      },
      {
        $project: {
          _id: 0,
          jobId: 1,
          applicationsLast2h: 1,
          applicationsLast24h: 1,
          applicationsToday: 1,
          viewsLast1h: { $ifNull: ['$viewsLast1h', { $ifNull: ['$viewsLast60m', 0] }] },
          matchesLast10m: 1,
          savesToday: 1,
          savesLast24h: 1,
          latestAt: 1,
          refreshedAt: 1,
          refreshedAtDate: 1,
        },
      },
    ])
    .toArray();

  const storedMetricsByJobId = new Map<string, StoredPulseMetric>();
  rows.forEach((row: any) => {
    const jobId = readString(row?.jobId, 120);
    if (!jobId) return;
    storedMetricsByJobId.set(jobId, {
      ...buildIndexedPulseMetric({
        applicationsLast2h: row?.applicationsLast2h,
        applicationsLast24h: row?.applicationsLast24h,
        applicationsToday: row?.applicationsToday,
        viewsLast1h: row?.viewsLast1h,
        matchesLast10m: row?.matchesLast10m,
        savesToday: row?.savesToday,
        savesLast24h: row?.savesLast24h,
        latestAt: row?.latestAt,
      }),
      refreshedAtMs: readPulseMetricRefreshedAtMs(row),
    });
  });

  return storedMetricsByJobId;
};

const hasPulseMetricChanged = (
  currentMetric: IndexedPulseMetric | StoredPulseMetric | undefined,
  nextMetric: IndexedPulseMetric,
): boolean =>
  !currentMetric
  || currentMetric.applicationsLast2h !== nextMetric.applicationsLast2h
  || currentMetric.applicationsLast24h !== nextMetric.applicationsLast24h
  || currentMetric.applicationsToday !== nextMetric.applicationsToday
  || currentMetric.viewsLast1h !== nextMetric.viewsLast1h
  || currentMetric.matchesLast10m !== nextMetric.matchesLast10m
  || currentMetric.savesToday !== nextMetric.savesToday
  || currentMetric.savesLast24h !== nextMetric.savesLast24h
  || currentMetric.latestAt !== nextMetric.latestAt;

const persistPulseMetrics = async (params: {
  db: any;
  jobIds: string[];
  metricsByJobId: Map<string, IndexedPulseMetric>;
  refreshedAtIso: string;
  storedMetricsByJobId?: Map<string, StoredPulseMetric>;
}): Promise<void> => {
  if (params.jobIds.length === 0) return;

  const refreshedAtDate = new Date(params.refreshedAtIso);
  const operations = params.jobIds.flatMap((jobId) => {
    const metric = params.metricsByJobId.get(jobId) || buildEmptyPulseMetric();
    if (!hasPulseMetricChanged(params.storedMetricsByJobId?.get(jobId), metric)) {
      return [];
    }
    return {
      updateOne: {
        filter: { jobId },
        update: {
          $set: {
            jobId,
            applicationsLast2h: metric.applicationsLast2h,
            applicationsLast24h: metric.applicationsLast24h,
            applicationsToday: metric.applicationsToday,
            viewsLast1h: metric.viewsLast1h,
            matchesLast10m: metric.matchesLast10m,
            savesToday: metric.savesToday,
            savesLast24h: metric.savesLast24h,
            latestAt: metric.latestAt,
            refreshedAt: params.refreshedAtIso,
            refreshedAtDate,
          },
          $unset: {
            viewsLast60m: '',
          },
        },
        upsert: true,
      },
    };
  });
  if (operations.length === 0) return;
  await params.db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).bulkWrite(
    operations,
    { ordered: false },
  );
};

const buildPulseMetricRefreshBatches = (jobIds: string[]): string[][] => {
  if (jobIds.length === 0) return [];
  const batches: string[][] = [];
  for (let index = 0; index < jobIds.length; index += MAX_PULSE_METRIC_REFRESH_BATCH_SIZE) {
    batches.push(jobIds.slice(index, index + MAX_PULSE_METRIC_REFRESH_BATCH_SIZE));
  }
  return batches;
};

const buildStoredPulseMetricSubset = (
  storedMetricsByJobId: Map<string, StoredPulseMetric>,
  jobIds: string[],
): Map<string, StoredPulseMetric> => {
  const subset = new Map<string, StoredPulseMetric>();
  jobIds.forEach((jobId) => {
    const metric = storedMetricsByJobId.get(jobId);
    if (metric) subset.set(jobId, metric);
  });
  return subset;
};

const refreshPulseMetricBatches = async (params: {
  db: any;
  jobIds: string[];
  storedMetricsByJobId: Map<string, StoredPulseMetric>;
}): Promise<void> => {
  for (const batchJobIds of buildPulseMetricRefreshBatches(params.jobIds)) {
    const batchNowMs = Date.now();
    const metricsByJobId = await aggregatePulseMetrics({
      db: params.db,
      jobIds: batchJobIds,
      nowMs: batchNowMs,
    });
    await persistPulseMetrics({
      db: params.db,
      jobIds: batchJobIds,
      metricsByJobId,
      refreshedAtIso: new Date(batchNowMs).toISOString(),
      storedMetricsByJobId: buildStoredPulseMetricSubset(params.storedMetricsByJobId, batchJobIds),
    });
  }
};

const markPulseMetricsFresh = (jobIds: string[], nowMs: number): void => {
  const freshUntilMs = nowMs + JOB_PULSE_METRIC_FRESHNESS_MS;
  jobIds.forEach((jobId) => {
    upsertPulseMetricFreshness(jobId, freshUntilMs);
  });
};

const isPulseMetricFresh = (
  jobId: string,
  metric: StoredPulseMetric | undefined,
  nowMs: number,
): boolean => {
  const localFreshUntilMs = pulseMetricFreshUntilByJobId.get(jobId) || 0;
  if (localFreshUntilMs > nowMs) return true;
  return Boolean(metric && metric.refreshedAtMs >= (nowMs - JOB_PULSE_METRIC_FRESHNESS_MS));
};

const schedulePulseMetricRefresh = (params: {
  db: any;
  jobIds: string[];
  nowMs: number;
  storedMetricsByJobId: Map<string, StoredPulseMetric>;
}): void => {
  if (params.jobIds.length === 0) return;
  maybePruneInflightPulseMetricRefreshes(params.nowMs);
  maybePrunePulseMetricFreshness(params.nowMs);
  const refreshJobIds = params.jobIds.filter((jobId) => {
    if (isPulseMetricFresh(jobId, params.storedMetricsByJobId.get(jobId), params.nowMs)) {
      return false;
    }
    return !inflightPulseMetricRefreshes.has(jobId);
  });
  if (refreshJobIds.length === 0) return;

  const refreshBatchPromise = scheduleJobPulseMetricRefreshTask({
    jobIds: refreshJobIds,
    stateByJobId: new Map(buildStoredPulseMetricSubset(params.storedMetricsByJobId, refreshJobIds)),
    runTask: async (jobIds, stateByJobId) => {
      await refreshPulseMetricBatches({
        db: params.db,
        jobIds,
        storedMetricsByJobId: stateByJobId as Map<string, StoredPulseMetric>,
      });
      markPulseMetricsFresh(jobIds, Date.now());
    },
  });
  if (!refreshBatchPromise) return;

  refreshJobIds.forEach((jobId) => {
    inflightPulseMetricRefreshes.set(jobId, {
      promise: refreshBatchPromise,
      createdAt: params.nowMs,
    });
  });
  void refreshBatchPromise
    .catch(() => undefined)
    .finally(() => {
      refreshJobIds.forEach((jobId) => {
        const current = inflightPulseMetricRefreshes.get(jobId);
        if (current?.promise === refreshBatchPromise) {
          inflightPulseMetricRefreshes.delete(jobId);
        }
      });
    });
  trimInflightPulseMetricRefreshesToLimit();
};

const resolvePulseMetrics = async (params: {
  db: any;
  jobIds: string[];
  nowMs: number;
}): Promise<Map<string, IndexedPulseMetric>> => {
  if (params.jobIds.length === 0) return new Map<string, IndexedPulseMetric>();

  const storedMetricsByJobId = await readStoredPulseMetrics({
    db: params.db,
    jobIds: params.jobIds,
  });
  const merged = new Map<string, IndexedPulseMetric>();
  const staleJobIds: string[] = [];
  params.jobIds.forEach((jobId) => {
    const storedMetric = storedMetricsByJobId.get(jobId);
    merged.set(jobId, storedMetric || buildEmptyPulseMetric());
    if (!isPulseMetricFresh(jobId, storedMetric, params.nowMs)) {
      staleJobIds.push(jobId);
    }
  });
  schedulePulseMetricRefresh({
    db: params.db,
    jobIds: staleJobIds,
    nowMs: params.nowMs,
    storedMetricsByJobId,
  });
  return merged;
};

const resolvePulseIdentityFields = (job: any) => {
  const source = readString(job?.source, 120) || null;
  const sourceType = resolveJobPulseSourceType(source);
  return {
    slug: readString(job?.slug, 220),
    title: readString(job?.title, 200),
    companyName: readString(job?.companyName, 180),
    source,
    sourceType,
    canDisplayAuraApplicants: sourceType === 'aura',
  };
};

const resolvePulseTimingFields = (job: any) => {
  const discoveredAt = resolveJobPulseDiscoveredAt(job);
  const postedAt = readString(job?.publishedAt, 80) || null;
  return {
    discoveredAt,
    publishedAt: postedAt,
    postedAt,
  };
};

const resolvePulseCountFields = (job: any, metrics?: IndexedPulseMetric) => {
  const totalApplicationCount = normalizeJobPulseCount(job?.applicationCount);
  const auraViewCount = normalizeJobPulseCount(job?.viewCount);
  const source = readString(job?.source, 120) || null;
  const sourceType = resolveJobPulseSourceType(source);
  const auraApplicationCount = sourceType === 'aura' ? totalApplicationCount : 0;
  return {
    auraApplicationCount,
    auraViewCount,
    applicationCount: totalApplicationCount,
    viewCount: auraViewCount,
    applicationsLast2h: metrics?.applicationsLast2h || 0,
    applicationsLast24h: metrics?.applicationsLast24h || 0,
    applicationsToday: metrics?.applicationsToday || 0,
    viewsLast1h: metrics?.viewsLast1h || 0,
    matchesLast10m: metrics?.matchesLast10m || 0,
    savesToday: metrics?.savesToday || 0,
    savesLast24h: metrics?.savesLast24h || 0,
  };
};

const buildPulseSnapshot = (params: {
  jobId: string;
  job: any;
  metrics?: IndexedPulseMetric;
  nowMs: number;
}): JobPulseSnapshot => {
  const identity = resolvePulseIdentityFields(params.job);
  const timing = resolvePulseTimingFields(params.job);
  const counts = resolvePulseCountFields(params.job, params.metrics);
  const heatScore = computeJobHeatScore({
    applicationsLast2h: counts.applicationsLast2h,
    applicationsToday: counts.applicationsToday,
    totalAuraApplications: counts.auraApplicationCount,
    viewsLast1h: counts.viewsLast1h,
    savesToday: counts.savesToday,
  });
  return {
    jobId: params.jobId,
    identity,
    timing: {
      ...timing,
      lastActivityAt: resolveLatestJobPulseIso(params.metrics?.latestAt),
    },
    metrics: counts,
    scores: {
      heatScore,
      heatLabel: resolveJobHeatLabel(heatScore),
      hotScore: computeWindowedJobPulseActivityScore({
        applicationsLast24h: counts.applicationsLast24h,
        viewsLast1h: counts.viewsLast1h,
        matchesLast10m: counts.matchesLast10m,
        savesLast24h: counts.savesLast24h,
        discoveredAt: timing.discoveredAt,
        nowMs: params.nowMs,
      }),
    },
  };
};

const buildPulseSnapshotsFromJobs = (params: {
  jobsById: Map<string, any>;
  orderedJobIds: string[];
  pulseMetricsByJobId: Map<string, IndexedPulseMetric>;
  nowMs: number;
}): JobPulseSnapshot[] =>
  params.orderedJobIds.map((jobId) => buildPulseSnapshot({
    jobId,
    job: params.jobsById.get(jobId) || {},
    metrics: params.pulseMetricsByJobId.get(jobId),
    nowMs: params.nowMs,
  }));

const sortPulseSnapshotsByHeat = (
  snapshots: JobPulseSnapshot[],
  limit: number,
): JobPulseSnapshot[] =>
  [...snapshots]
    .sort((left, right) => {
      if (right.scores.heatScore !== left.scores.heatScore) return right.scores.heatScore - left.scores.heatScore;
      if (right.metrics.viewsLast1h !== left.metrics.viewsLast1h) return right.metrics.viewsLast1h - left.metrics.viewsLast1h;
      if (right.metrics.applicationsLast2h !== left.metrics.applicationsLast2h) return right.metrics.applicationsLast2h - left.metrics.applicationsLast2h;
      return String(right.timing.lastActivityAt || right.timing.discoveredAt || '').localeCompare(String(left.timing.lastActivityAt || left.timing.discoveredAt || ''));
    })
    .slice(0, limit);

const normalizePulseSnapshotListParams = (params: {
  requestedJobIds?: string[];
  limit?: number;
  sortBy?: 'latest' | 'heat';
}): {
  requestedJobIds: string[];
  limit: number;
  sortBy: 'latest' | 'heat';
  cacheKey: string;
} => {
  const requestedJobIds = buildRequestedJobIds(params.requestedJobIds || []);
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Math.min(MAX_JOB_PULSE_SNAPSHOT_LIMIT, Math.round(Number(params.limit))))
    : MAX_JOB_PULSE_SNAPSHOT_LIMIT;
  const sortBy = params.sortBy === 'heat' ? 'heat' : 'latest';
  return {
    requestedJobIds,
    limit,
    sortBy,
    cacheKey: buildPulseCacheKey(requestedJobIds, limit, sortBy),
  };
};

export const listJobPulseSnapshots = async (params: {
  db: any;
  requestedJobIds?: string[];
  limit?: number;
  sortBy?: 'latest' | 'heat';
}): Promise<JobPulseSnapshot[]> => {
  ensureJobPulseSnapshotCleanupTimer();
  const { requestedJobIds, limit, sortBy, cacheKey } = normalizePulseSnapshotListParams(params);
  const nowMs = Date.now();
  maybePrunePulseSnapshotCache(nowMs);
  const cached = resolveCachedPulseSnapshots(cacheKey, nowMs);
  if (cached) return cached;

  const { jobsById, orderedJobIds } = await fetchPulseJobs({
    db: params.db,
    requestedJobIds,
    limit,
    sortBy,
  });
  if (orderedJobIds.length === 0) return [];

  const pulseMetricsByJobId = await resolvePulseMetrics({
    db: params.db,
    jobIds: orderedJobIds,
    nowMs,
  });
  const snapshots = buildPulseSnapshotsFromJobs({
    jobsById,
    orderedJobIds,
    pulseMetricsByJobId,
    nowMs,
  });
  const normalizedSnapshots = requestedJobIds.length > 0 || sortBy !== 'heat'
    ? snapshots
    : sortPulseSnapshotsByHeat(snapshots, limit);
  cachePulseSnapshots(cacheKey, nowMs, normalizedSnapshots);
  return normalizedSnapshots;
};

export type JobHeatResponseFields = {
  sourceType: 'aura' | 'aggregated';
  canDisplayAuraApplicants: boolean;
  heatScore: number;
  heatLabel: JobHeatLabel;
  applicationsLast2h: number;
  applicationsToday: number;
  viewsLast1h: number;
  savesToday: number;
  auraApplicationCount: number;
  auraViewCount: number;
  lastActivityAt: string | null;
};

export const buildJobHeatResponseFields = (
  snapshot?: JobPulseSnapshot | null,
): JobHeatResponseFields => ({
  sourceType: snapshot?.identity.sourceType === 'aura' ? 'aura' : 'aggregated',
  canDisplayAuraApplicants: Boolean(snapshot?.identity.canDisplayAuraApplicants),
  heatScore: Number.isFinite(Number(snapshot?.scores.heatScore)) ? Math.max(0, Math.round(Number(snapshot?.scores.heatScore))) : 0,
  heatLabel: snapshot?.scores.heatLabel || 'low',
  applicationsLast2h: Number.isFinite(Number(snapshot?.metrics.applicationsLast2h)) ? Math.max(0, Math.floor(Number(snapshot?.metrics.applicationsLast2h))) : 0,
  applicationsToday: Number.isFinite(Number(snapshot?.metrics.applicationsToday)) ? Math.max(0, Math.floor(Number(snapshot?.metrics.applicationsToday))) : 0,
  viewsLast1h: Number.isFinite(Number(snapshot?.metrics.viewsLast1h)) ? Math.max(0, Math.floor(Number(snapshot?.metrics.viewsLast1h))) : 0,
  savesToday: Number.isFinite(Number(snapshot?.metrics.savesToday)) ? Math.max(0, Math.floor(Number(snapshot?.metrics.savesToday))) : 0,
  auraApplicationCount: Number.isFinite(Number(snapshot?.metrics.auraApplicationCount)) ? Math.max(0, Math.floor(Number(snapshot?.metrics.auraApplicationCount))) : 0,
  auraViewCount: Number.isFinite(Number(snapshot?.metrics.auraViewCount)) ? Math.max(0, Math.floor(Number(snapshot?.metrics.auraViewCount))) : 0,
  lastActivityAt: readString(snapshot?.timing.lastActivityAt, 80) || null,
});
