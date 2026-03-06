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
  computeJobPulseHotScore,
} from './jobPulseDomain';

const JOBS_COLLECTION = 'jobs';
const JOB_PULSE_BUCKETS_COLLECTION = 'job_pulse_time_buckets';
const JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION = 'job_pulse_metric_snapshots';

const JOB_PULSE_CACHE_TTL_MS = 15_000;
const JOB_PULSE_METRIC_FRESHNESS_MS = 30_000;
const JOB_PULSE_INFLIGHT_REFRESH_TTL_MS = 60_000;
const JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS = 60_000;
const MAX_JOB_PULSE_SNAPSHOT_LIMIT = 20;
const MAX_PULSE_SNAPSHOT_CACHE_ENTRIES = 100;
const MAX_INFLIGHT_PULSE_METRIC_REFRESHES = 200;

type IndexedPulseMetric = {
  applicationsLast24h: number;
  viewsLast60m: number;
  matchesLast10m: number;
  savesLast24h: number;
  latestAt: string | null;
};

export type JobPulseSnapshot = {
  jobId: string;
  slug: string;
  title: string;
  companyName: string;
  source: string | null;
  sourceType: 'aura' | 'aggregated';
  canDisplayAuraApplicants: boolean;
  discoveredAt: string | null;
  publishedAt: string | null;
  postedAt: string | null;
  auraApplicationCount: number;
  auraViewCount: number;
  applicationCount: number;
  viewCount: number;
  applicationsLast24h: number;
  viewsLast60m: number;
  matchesLast10m: number;
  savesLast24h: number;
  hotScore: number;
  lastActivityAt: string | null;
};

const pulseSnapshotCache = new Map<string, { expiresAt: number; data: JobPulseSnapshot[] }>();
const inflightPulseMetricRefreshes = new Map<string, {
  promise: Promise<IndexedPulseMetric>;
  createdAt: number;
}>();

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

const buildPulseCacheKey = (requestedJobIds: string[], limit: number): string =>
  requestedJobIds.length > 0
    ? `ids:${requestedJobIds.join(',')}:${limit}`
    : `latest:${limit}`;

const resolveCachedPulseSnapshots = (
  cacheKey: string,
  nowMs: number,
): JobPulseSnapshot[] | null => {
  const cached = pulseSnapshotCache.get(cacheKey);
  if (!cached || cached.expiresAt <= nowMs) return null;
  pulseSnapshotCache.delete(cacheKey);
  pulseSnapshotCache.set(cacheKey, cached);
  return cached.data;
};

const cachePulseSnapshots = (
  cacheKey: string,
  nowMs: number,
  snapshots: JobPulseSnapshot[],
): void => {
  prunePulseSnapshotCache(nowMs);
  pulseSnapshotCache.set(cacheKey, {
    expiresAt: nowMs + JOB_PULSE_CACHE_TTL_MS,
    data: snapshots,
  });
};

const prunePulseSnapshotCache = (nowMs: number): void => {
  for (const [key, entry] of pulseSnapshotCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      pulseSnapshotCache.delete(key);
    }
  }
  while (pulseSnapshotCache.size > MAX_PULSE_SNAPSHOT_CACHE_ENTRIES) {
    const oldestEntry = pulseSnapshotCache.keys().next();
    if (oldestEntry.done) break;
    pulseSnapshotCache.delete(oldestEntry.value);
  }
};

const pruneInflightPulseMetricRefreshes = (nowMs: number): void => {
  for (const [jobId, entry] of inflightPulseMetricRefreshes.entries()) {
    if ((nowMs - entry.createdAt) >= JOB_PULSE_INFLIGHT_REFRESH_TTL_MS) {
      inflightPulseMetricRefreshes.delete(jobId);
    }
  }

  while (inflightPulseMetricRefreshes.size > MAX_INFLIGHT_PULSE_METRIC_REFRESHES) {
    const oldestEntry = inflightPulseMetricRefreshes.keys().next();
    if (oldestEntry.done) break;
    inflightPulseMetricRefreshes.delete(oldestEntry.value);
  }
};

setInterval(() => {
  const nowMs = Date.now();
  prunePulseSnapshotCache(nowMs);
  pruneInflightPulseMetricRefreshes(nowMs);
}, JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS).unref?.();

const fetchPulseJobs = async (params: {
  db: any;
  requestedJobIds: string[];
  limit: number;
}): Promise<{ jobsById: Map<string, any>; orderedJobIds: string[] }> => {
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
      .limit(params.limit)
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

const indexPulseMetricsByJobId = (
  rows: Array<{
    _id?: string;
    applicationsLast24h?: number;
    viewsLast60m?: number;
    matchesLast10m?: number;
    savesLast24h?: number;
    latestAt?: string | null;
  }>,
): Map<string, IndexedPulseMetric> => {
  const next = new Map<string, IndexedPulseMetric>();
  rows.forEach((row) => {
    const jobId = readString((row as any)?._id, 120);
    if (!jobId) return;
    next.set(jobId, {
      applicationsLast24h: Number.isFinite(Number((row as any)?.applicationsLast24h))
        ? Math.max(0, Math.floor(Number((row as any).applicationsLast24h)))
        : 0,
      viewsLast60m: Number.isFinite(Number((row as any)?.viewsLast60m))
        ? Math.max(0, Math.floor(Number((row as any).viewsLast60m)))
        : 0,
      matchesLast10m: Number.isFinite(Number((row as any)?.matchesLast10m))
        ? Math.max(0, Math.floor(Number((row as any).matchesLast10m)))
        : 0,
      savesLast24h: Number.isFinite(Number((row as any)?.savesLast24h))
        ? Math.max(0, Math.floor(Number((row as any).savesLast24h)))
        : 0,
      latestAt: readString((row as any)?.latestAt, 80) || null,
    });
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
    viewSince,
    matchSince,
    saveSince,
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
          applicationsLast24h: buildJobPulseBucketWindowSumExpression('jobAppliedCount', applicationSince),
          viewsLast60m: buildJobPulseBucketWindowSumExpression('jobViewedCount', viewSince),
          matchesLast10m: buildJobPulseBucketWindowSumExpression('jobMatchedCount', matchSince),
          savesLast24h: buildJobPulseBucketWindowSumExpression('jobSavedCount', saveSince),
          latestAt: { $max: '$latestEventAt' },
        },
      },
    ])
    .toArray();

  return indexPulseMetricsByJobId(rows);
};

const buildEmptyPulseMetric = (): IndexedPulseMetric => ({
  applicationsLast24h: 0,
  viewsLast60m: 0,
  matchesLast10m: 0,
  savesLast24h: 0,
  latestAt: null,
});

const readFreshPulseMetrics = async (params: {
  db: any;
  jobIds: string[];
  nowMs: number;
}): Promise<Map<string, IndexedPulseMetric>> => {
  if (params.jobIds.length === 0) return new Map<string, IndexedPulseMetric>();

  const freshnessDate = new Date(params.nowMs - JOB_PULSE_METRIC_FRESHNESS_MS);
  const rows = await params.db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION)
    .find(
      {
        jobId: { $in: params.jobIds },
        refreshedAtDate: { $gte: freshnessDate },
      },
      {
        projection: {
          _id: 0,
          jobId: 1,
          applicationsLast24h: 1,
          viewsLast60m: 1,
          matchesLast10m: 1,
          savesLast24h: 1,
          latestAt: 1,
        },
      },
    )
    .toArray();

  return indexPulseMetricsByJobId(
    rows.map((row: any) => ({
      _id: readString(row?.jobId, 120),
      applicationsLast24h: row?.applicationsLast24h,
      viewsLast60m: row?.viewsLast60m,
      matchesLast10m: row?.matchesLast10m,
      savesLast24h: row?.savesLast24h,
      latestAt: row?.latestAt,
    })),
  );
};

const persistPulseMetrics = async (params: {
  db: any;
  jobIds: string[];
  metricsByJobId: Map<string, IndexedPulseMetric>;
  refreshedAtIso: string;
}): Promise<void> => {
  if (params.jobIds.length === 0) return;

  const refreshedAtDate = new Date(params.refreshedAtIso);
  await params.db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).bulkWrite(
    params.jobIds.map((jobId) => {
      const metric = params.metricsByJobId.get(jobId) || buildEmptyPulseMetric();
      return {
        updateOne: {
          filter: { jobId },
          update: {
            $set: {
              jobId,
              applicationsLast24h: metric.applicationsLast24h,
              viewsLast60m: metric.viewsLast60m,
              matchesLast10m: metric.matchesLast10m,
              savesLast24h: metric.savesLast24h,
              latestAt: metric.latestAt,
              refreshedAt: params.refreshedAtIso,
              refreshedAtDate,
            },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
};

const createPulseMetricRefreshPromise = (params: {
  db: any;
  jobIds: string[];
  nowMs: number;
}): Map<string, Promise<IndexedPulseMetric>> => {
  const promisesByJobId = new Map<string, Promise<IndexedPulseMetric>>();
  if (params.jobIds.length === 0) return promisesByJobId;
  pruneInflightPulseMetricRefreshes(params.nowMs);

  const refreshedAtIso = new Date(params.nowMs).toISOString();
  const refreshBatchPromise = (async () => {
    const metricsByJobId = await aggregatePulseMetrics(params);
    await persistPulseMetrics({
      db: params.db,
      jobIds: params.jobIds,
      metricsByJobId,
      refreshedAtIso,
    });
    return metricsByJobId;
  })();

  params.jobIds.forEach((jobId) => {
    const metricPromise = refreshBatchPromise
      .then((metricsByJobId) => metricsByJobId.get(jobId) || buildEmptyPulseMetric())
      .finally(() => {
        const current = inflightPulseMetricRefreshes.get(jobId);
        if (current?.promise === metricPromise) {
          inflightPulseMetricRefreshes.delete(jobId);
        }
      });
    inflightPulseMetricRefreshes.set(jobId, {
      promise: metricPromise,
      createdAt: params.nowMs,
    });
    promisesByJobId.set(jobId, metricPromise);
  });
  pruneInflightPulseMetricRefreshes(params.nowMs);

  return promisesByJobId;
};

const resolveInflightPulseMetricPromises = (params: {
  db: any;
  jobIds: string[];
  nowMs: number;
}): Map<string, Promise<IndexedPulseMetric>> => {
  const promisesByJobId = new Map<string, Promise<IndexedPulseMetric>>();
  const missingJobIds: string[] = [];
  pruneInflightPulseMetricRefreshes(params.nowMs);

  params.jobIds.forEach((jobId) => {
    const existing = inflightPulseMetricRefreshes.get(jobId);
    if (existing) {
      promisesByJobId.set(jobId, existing.promise);
      return;
    }
    missingJobIds.push(jobId);
  });

  const newPromisesByJobId = createPulseMetricRefreshPromise({
    db: params.db,
    jobIds: missingJobIds,
    nowMs: params.nowMs,
  });
  newPromisesByJobId.forEach((metricPromise, jobId) => {
    promisesByJobId.set(jobId, metricPromise);
  });

  return promisesByJobId;
};

const resolvePulseMetrics = async (params: {
  db: any;
  jobIds: string[];
  nowMs: number;
}): Promise<Map<string, IndexedPulseMetric>> => {
  if (params.jobIds.length === 0) return new Map<string, IndexedPulseMetric>();

  const freshMetricsByJobId = await readFreshPulseMetrics(params);
  if (freshMetricsByJobId.size === params.jobIds.length) {
    return freshMetricsByJobId;
  }

  const staleJobIds = params.jobIds.filter((jobId) => !freshMetricsByJobId.has(jobId));
  const inflightPromisesByJobId = resolveInflightPulseMetricPromises({
    db: params.db,
    jobIds: staleJobIds,
    nowMs: params.nowMs,
  });
  const recalculatedMetricsByJobId = new Map<string, IndexedPulseMetric>();
  await Promise.all(
    staleJobIds.map(async (jobId) => {
      const metricPromise = inflightPromisesByJobId.get(jobId);
      const metric = metricPromise ? await metricPromise : buildEmptyPulseMetric();
      recalculatedMetricsByJobId.set(jobId, metric);
    }),
  );

  const merged = new Map<string, IndexedPulseMetric>();
  params.jobIds.forEach((jobId) => {
    merged.set(
      jobId,
      freshMetricsByJobId.get(jobId) || recalculatedMetricsByJobId.get(jobId) || buildEmptyPulseMetric(),
    );
  });
  return merged;
};

const resolvePulseIdentityFields = (jobId: string, job: any) => {
  const source = readString(job?.source, 120) || null;
  const sourceType = resolveJobPulseSourceType(source);
  return {
    jobId,
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
    applicationsLast24h: metrics?.applicationsLast24h || 0,
    viewsLast60m: metrics?.viewsLast60m || 0,
    matchesLast10m: metrics?.matchesLast10m || 0,
    savesLast24h: metrics?.savesLast24h || 0,
  };
};

const buildPulseSnapshot = (params: {
  jobId: string;
  job: any;
  metrics?: IndexedPulseMetric;
  nowMs: number;
}): JobPulseSnapshot => {
  const identity = resolvePulseIdentityFields(params.jobId, params.job);
  const timing = resolvePulseTimingFields(params.job);
  const counts = resolvePulseCountFields(params.job, params.metrics);
  return {
    ...identity,
    ...timing,
    ...counts,
    hotScore: computeJobPulseHotScore({
      applicationsLast24h: counts.applicationsLast24h,
      viewsLast60m: counts.viewsLast60m,
      matchesLast10m: counts.matchesLast10m,
      savesLast24h: counts.savesLast24h,
      discoveredAt: timing.discoveredAt,
      nowMs: params.nowMs,
    }),
    lastActivityAt: resolveLatestJobPulseIso(params.metrics?.latestAt),
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

export const listJobPulseSnapshots = async (params: {
  db: any;
  requestedJobIds?: string[];
  limit?: number;
}): Promise<JobPulseSnapshot[]> => {
  const requestedJobIds = buildRequestedJobIds(params.requestedJobIds || []);
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Math.min(MAX_JOB_PULSE_SNAPSHOT_LIMIT, Math.round(Number(params.limit))))
    : MAX_JOB_PULSE_SNAPSHOT_LIMIT;
  const cacheKey = buildPulseCacheKey(requestedJobIds, limit);
  const nowMs = Date.now();
  prunePulseSnapshotCache(nowMs);
  const cached = resolveCachedPulseSnapshots(cacheKey, nowMs);
  if (cached) return cached;

  const { jobsById, orderedJobIds } = await fetchPulseJobs({
    db: params.db,
    requestedJobIds,
    limit,
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
  cachePulseSnapshots(cacheKey, nowMs, snapshots);
  return snapshots;
};
