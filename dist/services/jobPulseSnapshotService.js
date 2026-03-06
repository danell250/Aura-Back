"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobHeatResponseFields = exports.listJobPulseSnapshots = exports.normalizeLegacyPulseMetricViewsWindowField = exports.stopJobPulseSnapshotCleanupTimer = exports.ensureJobPulseSnapshotCleanupTimer = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobPulseUtils_1 = require("./jobPulseUtils");
const jobPulseDomain_1 = require("./jobPulseDomain");
const jobPulseMetricRefreshQueueService_1 = require("./jobPulseMetricRefreshQueueService");
const JOBS_COLLECTION = 'jobs';
const JOB_PULSE_BUCKETS_COLLECTION = 'job_pulse_time_buckets';
const JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION = 'job_pulse_metric_snapshots';
const JOB_PULSE_CACHE_TTL_MS = 15000;
const JOB_PULSE_METRIC_FRESHNESS_MS = 30000;
const JOB_PULSE_INFLIGHT_REFRESH_TTL_MS = 60000;
const JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS = 60000;
const MAX_JOB_PULSE_SNAPSHOT_LIMIT = 40;
const MAX_PULSE_SNAPSHOT_CACHE_ENTRIES = 100;
const MAX_INFLIGHT_PULSE_METRIC_REFRESHES = 200;
const MAX_LOCAL_PULSE_METRIC_FRESHNESS_ENTRIES = 400;
const MAX_PULSE_METRIC_REFRESH_BATCH_SIZE = 12;
const pulseSnapshotCache = new Map();
const inflightPulseMetricRefreshes = new Map();
const pulseMetricFreshUntilByJobId = new Map();
let nextPulseSnapshotCacheCleanupAt = 0;
let nextInflightPulseMetricRefreshCleanupAt = 0;
let nextPulseMetricFreshnessCleanupAt = 0;
const readPulseSnapshotCleanupTimerGlobal = () => globalThis;
const buildRequestedJobIds = (rawIds) => {
    const seen = new Set();
    const jobIds = [];
    for (const rawId of rawIds) {
        const normalized = (0, inputSanitizers_1.readString)(rawId, 120);
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        jobIds.push(normalized);
        if (jobIds.length >= MAX_JOB_PULSE_SNAPSHOT_LIMIT)
            break;
    }
    return jobIds;
};
const buildPulseCacheKey = (requestedJobIds, limit, sortBy) => requestedJobIds.length > 0
    ? `ids:${requestedJobIds.join(',')}:${limit}:${sortBy}`
    : `${sortBy}:${limit}`;
const resolveCachedPulseSnapshots = (cacheKey, nowMs) => {
    const cached = pulseSnapshotCache.get(cacheKey);
    if (!cached)
        return null;
    if (cached.expiresAt <= nowMs) {
        pulseSnapshotCache.delete(cacheKey);
        return null;
    }
    pulseSnapshotCache.delete(cacheKey);
    pulseSnapshotCache.set(cacheKey, cached);
    return cached.data;
};
const trimPulseSnapshotCacheToLimit = () => {
    while (pulseSnapshotCache.size > MAX_PULSE_SNAPSHOT_CACHE_ENTRIES) {
        const oldestEntry = pulseSnapshotCache.keys().next();
        if (oldestEntry.done)
            break;
        pulseSnapshotCache.delete(oldestEntry.value);
    }
};
const pruneExpiredPulseSnapshotCacheEntries = (nowMs) => {
    for (const [key, entry] of pulseSnapshotCache.entries()) {
        if (entry.expiresAt <= nowMs) {
            pulseSnapshotCache.delete(key);
        }
    }
};
const maybePrunePulseSnapshotCache = (nowMs) => {
    if (pulseSnapshotCache.size <= MAX_PULSE_SNAPSHOT_CACHE_ENTRIES
        && nowMs < nextPulseSnapshotCacheCleanupAt) {
        return;
    }
    nextPulseSnapshotCacheCleanupAt = nowMs + JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS;
    pruneExpiredPulseSnapshotCacheEntries(nowMs);
    trimPulseSnapshotCacheToLimit();
};
const cachePulseSnapshots = (cacheKey, nowMs, snapshots) => {
    maybePrunePulseSnapshotCache(nowMs);
    pulseSnapshotCache.set(cacheKey, {
        expiresAt: nowMs + JOB_PULSE_CACHE_TTL_MS,
        data: snapshots,
    });
    trimPulseSnapshotCacheToLimit();
};
const trimInflightPulseMetricRefreshesToLimit = () => {
    while (inflightPulseMetricRefreshes.size > MAX_INFLIGHT_PULSE_METRIC_REFRESHES) {
        const oldestEntry = inflightPulseMetricRefreshes.keys().next();
        if (oldestEntry.done)
            break;
        inflightPulseMetricRefreshes.delete(oldestEntry.value);
    }
};
const pruneExpiredInflightPulseMetricRefreshes = (nowMs) => {
    for (const [jobId, entry] of inflightPulseMetricRefreshes.entries()) {
        if ((nowMs - entry.createdAt) >= JOB_PULSE_INFLIGHT_REFRESH_TTL_MS) {
            inflightPulseMetricRefreshes.delete(jobId);
        }
    }
};
const maybePruneInflightPulseMetricRefreshes = (nowMs) => {
    if (inflightPulseMetricRefreshes.size <= MAX_INFLIGHT_PULSE_METRIC_REFRESHES
        && nowMs < nextInflightPulseMetricRefreshCleanupAt) {
        return;
    }
    nextInflightPulseMetricRefreshCleanupAt = nowMs + JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS;
    pruneExpiredInflightPulseMetricRefreshes(nowMs);
    trimInflightPulseMetricRefreshesToLimit();
};
const trimPulseMetricFreshnessCacheToLimit = () => {
    while (pulseMetricFreshUntilByJobId.size > MAX_LOCAL_PULSE_METRIC_FRESHNESS_ENTRIES) {
        const oldestEntry = pulseMetricFreshUntilByJobId.keys().next();
        if (oldestEntry.done)
            break;
        pulseMetricFreshUntilByJobId.delete(oldestEntry.value);
    }
};
const upsertPulseMetricFreshness = (jobId, freshUntilMs) => {
    if (!jobId)
        return;
    pulseMetricFreshUntilByJobId.delete(jobId);
    while (pulseMetricFreshUntilByJobId.size >= MAX_LOCAL_PULSE_METRIC_FRESHNESS_ENTRIES) {
        const oldestEntry = pulseMetricFreshUntilByJobId.keys().next();
        if (oldestEntry.done)
            break;
        pulseMetricFreshUntilByJobId.delete(oldestEntry.value);
    }
    pulseMetricFreshUntilByJobId.set(jobId, freshUntilMs);
};
const pruneExpiredPulseMetricFreshness = (nowMs) => {
    for (const [jobId, freshUntilMs] of pulseMetricFreshUntilByJobId.entries()) {
        if (freshUntilMs <= nowMs) {
            pulseMetricFreshUntilByJobId.delete(jobId);
        }
    }
};
const maybePrunePulseMetricFreshness = (nowMs) => {
    if (pulseMetricFreshUntilByJobId.size <= MAX_LOCAL_PULSE_METRIC_FRESHNESS_ENTRIES
        && nowMs < nextPulseMetricFreshnessCleanupAt) {
        return;
    }
    nextPulseMetricFreshnessCleanupAt = nowMs + JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS;
    pruneExpiredPulseMetricFreshness(nowMs);
    trimPulseMetricFreshnessCacheToLimit();
};
const runPulseSnapshotCacheCleanup = () => {
    const nowMs = Date.now();
    pruneExpiredPulseSnapshotCacheEntries(nowMs);
    trimPulseSnapshotCacheToLimit();
    pruneExpiredInflightPulseMetricRefreshes(nowMs);
    trimInflightPulseMetricRefreshesToLimit();
    pruneExpiredPulseMetricFreshness(nowMs);
    trimPulseMetricFreshnessCacheToLimit();
};
const ensureJobPulseSnapshotCleanupTimer = () => {
    const cleanupTimerGlobal = readPulseSnapshotCleanupTimerGlobal();
    if (cleanupTimerGlobal.__auraJobPulseSnapshotCleanupTimer__)
        return;
    cleanupTimerGlobal.__auraJobPulseSnapshotCleanupTimer__ = setInterval(runPulseSnapshotCacheCleanup, JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS);
};
exports.ensureJobPulseSnapshotCleanupTimer = ensureJobPulseSnapshotCleanupTimer;
const stopJobPulseSnapshotCleanupTimer = () => {
    const cleanupTimerGlobal = readPulseSnapshotCleanupTimerGlobal();
    const cleanupTimer = cleanupTimerGlobal.__auraJobPulseSnapshotCleanupTimer__;
    if (!cleanupTimer)
        return;
    clearInterval(cleanupTimer);
    cleanupTimerGlobal.__auraJobPulseSnapshotCleanupTimer__ = null;
};
exports.stopJobPulseSnapshotCleanupTimer = stopJobPulseSnapshotCleanupTimer;
const fetchPulseJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const scanLimit = params.sortBy === 'heat'
        ? Math.min(96, Math.max(params.limit * 3, 48))
        : params.limit;
    const jobs = params.requestedJobIds.length > 0
        ? yield params.db.collection(JOBS_COLLECTION)
            .find({
            id: { $in: params.requestedJobIds },
            status: { $ne: 'archived' },
        }, {
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
        })
            .toArray()
        : yield params.db.collection(JOBS_COLLECTION)
            .find({
            status: 'open',
            discoveredAt: { $type: 'string', $ne: '' },
        }, {
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
        })
            .sort({ discoveredAt: -1, createdAt: -1 })
            .limit(scanLimit)
            .toArray();
    const jobsById = new Map();
    jobs.forEach((job) => {
        const jobId = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120);
        if (!jobId)
            return;
        jobsById.set(jobId, job);
    });
    const orderedJobIds = params.requestedJobIds.length > 0
        ? params.requestedJobIds.filter((jobId) => jobsById.has(jobId))
        : Array.from(jobsById.keys()).slice(0, params.limit);
    return { jobsById, orderedJobIds };
});
function buildIndexedPulseMetric(row) {
    return {
        applicationsLast2h: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.applicationsLast2h))
            ? Math.max(0, Math.floor(Number(row.applicationsLast2h)))
            : 0,
        applicationsLast24h: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.applicationsLast24h))
            ? Math.max(0, Math.floor(Number(row.applicationsLast24h)))
            : 0,
        applicationsToday: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.applicationsToday))
            ? Math.max(0, Math.floor(Number(row.applicationsToday)))
            : 0,
        viewsLast1h: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.viewsLast1h))
            ? Math.max(0, Math.floor(Number(row.viewsLast1h)))
            : 0,
        matchesLast10m: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.matchesLast10m))
            ? Math.max(0, Math.floor(Number(row.matchesLast10m)))
            : 0,
        savesToday: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.savesToday))
            ? Math.max(0, Math.floor(Number(row.savesToday)))
            : 0,
        savesLast24h: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.savesLast24h))
            ? Math.max(0, Math.floor(Number(row.savesLast24h)))
            : 0,
        latestAt: readPulseMetricLatestAtIso(row === null || row === void 0 ? void 0 : row.latestAt),
    };
}
const indexPulseMetricsByJobId = (rows) => {
    const next = new Map();
    rows.forEach((row) => {
        const jobId = (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row._id, 120);
        if (!jobId)
            return;
        next.set(jobId, buildIndexedPulseMetric({
            applicationsLast2h: row === null || row === void 0 ? void 0 : row.applicationsLast2h,
            applicationsLast24h: row === null || row === void 0 ? void 0 : row.applicationsLast24h,
            applicationsToday: row === null || row === void 0 ? void 0 : row.applicationsToday,
            viewsLast1h: row === null || row === void 0 ? void 0 : row.viewsLast1h,
            matchesLast10m: row === null || row === void 0 ? void 0 : row.matchesLast10m,
            savesToday: row === null || row === void 0 ? void 0 : row.savesToday,
            savesLast24h: row === null || row === void 0 ? void 0 : row.savesLast24h,
            latestAt: row === null || row === void 0 ? void 0 : row.latestAt,
        }));
    });
    return next;
};
const aggregatePulseMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobIds.length === 0)
        return new Map();
    const { applicationSince, applicationRecentSince, todaySince, viewSince, matchSince, } = (0, jobPulseDomain_1.buildJobPulseWindowBounds)(params.nowMs);
    const rows = yield params.db.collection(JOB_PULSE_BUCKETS_COLLECTION)
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
                applicationsLast2h: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobAppliedCount', applicationRecentSince),
                applicationsLast24h: { $sum: '$jobAppliedCount' },
                applicationsToday: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobAppliedCount', todaySince),
                viewsLast1h: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobViewedCount', viewSince),
                matchesLast10m: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobMatchedCount', matchSince),
                savesToday: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobSavedCount', todaySince),
                savesLast24h: { $sum: '$jobSavedCount' },
                latestAt: { $max: '$latestEventAt' },
            },
        },
    ])
        .toArray();
    return indexPulseMetricsByJobId(rows);
});
const buildEmptyPulseMetric = () => ({
    applicationsLast2h: 0,
    applicationsLast24h: 0,
    applicationsToday: 0,
    viewsLast1h: 0,
    matchesLast10m: 0,
    savesToday: 0,
    savesLast24h: 0,
    latestAt: null,
});
const readPulseMetricRefreshedAtMs = (row) => {
    const refreshedAtRaw = (row === null || row === void 0 ? void 0 : row.refreshedAtDate) || (row === null || row === void 0 ? void 0 : row.refreshedAt);
    if (!refreshedAtRaw)
        return 0;
    const refreshedAtMs = new Date(refreshedAtRaw).getTime();
    return Number.isFinite(refreshedAtMs) ? refreshedAtMs : 0;
};
const readPulseMetricLatestAtIso = (value) => {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return (0, inputSanitizers_1.readString)(String(value || ''), 80) || null;
};
const normalizeLegacyPulseMetricViewsWindowField = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const rows = yield db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION)
        .find({
        viewsLast1h: { $exists: false },
        viewsLast60m: { $exists: true },
    }, {
        projection: {
            _id: 0,
            jobId: 1,
            viewsLast60m: 1,
        },
    })
        .limit(500)
        .toArray();
    const operations = rows.flatMap((row) => {
        const jobId = (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.jobId, 120);
        if (!jobId || !Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.viewsLast60m))) {
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
    if (operations.length === 0)
        return;
    yield db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).bulkWrite(operations, { ordered: false });
});
exports.normalizeLegacyPulseMetricViewsWindowField = normalizeLegacyPulseMetricViewsWindowField;
const readStoredPulseMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobIds.length === 0)
        return new Map();
    const rows = yield params.db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION)
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
    const storedMetricsByJobId = new Map();
    rows.forEach((row) => {
        const jobId = (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.jobId, 120);
        if (!jobId)
            return;
        storedMetricsByJobId.set(jobId, Object.assign(Object.assign({}, buildIndexedPulseMetric({
            applicationsLast2h: row === null || row === void 0 ? void 0 : row.applicationsLast2h,
            applicationsLast24h: row === null || row === void 0 ? void 0 : row.applicationsLast24h,
            applicationsToday: row === null || row === void 0 ? void 0 : row.applicationsToday,
            viewsLast1h: row === null || row === void 0 ? void 0 : row.viewsLast1h,
            matchesLast10m: row === null || row === void 0 ? void 0 : row.matchesLast10m,
            savesToday: row === null || row === void 0 ? void 0 : row.savesToday,
            savesLast24h: row === null || row === void 0 ? void 0 : row.savesLast24h,
            latestAt: row === null || row === void 0 ? void 0 : row.latestAt,
        })), { refreshedAtMs: readPulseMetricRefreshedAtMs(row) }));
    });
    return storedMetricsByJobId;
});
const hasPulseMetricChanged = (currentMetric, nextMetric) => !currentMetric
    || currentMetric.applicationsLast2h !== nextMetric.applicationsLast2h
    || currentMetric.applicationsLast24h !== nextMetric.applicationsLast24h
    || currentMetric.applicationsToday !== nextMetric.applicationsToday
    || currentMetric.viewsLast1h !== nextMetric.viewsLast1h
    || currentMetric.matchesLast10m !== nextMetric.matchesLast10m
    || currentMetric.savesToday !== nextMetric.savesToday
    || currentMetric.savesLast24h !== nextMetric.savesLast24h
    || currentMetric.latestAt !== nextMetric.latestAt;
const persistPulseMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobIds.length === 0)
        return;
    const refreshedAtDate = new Date(params.refreshedAtIso);
    const operations = params.jobIds.flatMap((jobId) => {
        var _a;
        const metric = params.metricsByJobId.get(jobId) || buildEmptyPulseMetric();
        if (!hasPulseMetricChanged((_a = params.storedMetricsByJobId) === null || _a === void 0 ? void 0 : _a.get(jobId), metric)) {
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
    if (operations.length === 0)
        return;
    yield params.db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).bulkWrite(operations, { ordered: false });
});
const buildPulseMetricRefreshBatches = (jobIds) => {
    if (jobIds.length === 0)
        return [];
    const batches = [];
    for (let index = 0; index < jobIds.length; index += MAX_PULSE_METRIC_REFRESH_BATCH_SIZE) {
        batches.push(jobIds.slice(index, index + MAX_PULSE_METRIC_REFRESH_BATCH_SIZE));
    }
    return batches;
};
const buildStoredPulseMetricSubset = (storedMetricsByJobId, jobIds) => {
    const subset = new Map();
    jobIds.forEach((jobId) => {
        const metric = storedMetricsByJobId.get(jobId);
        if (metric)
            subset.set(jobId, metric);
    });
    return subset;
};
const refreshPulseMetricBatches = (params) => __awaiter(void 0, void 0, void 0, function* () {
    for (const batchJobIds of buildPulseMetricRefreshBatches(params.jobIds)) {
        const batchNowMs = Date.now();
        const metricsByJobId = yield aggregatePulseMetrics({
            db: params.db,
            jobIds: batchJobIds,
            nowMs: batchNowMs,
        });
        yield persistPulseMetrics({
            db: params.db,
            jobIds: batchJobIds,
            metricsByJobId,
            refreshedAtIso: new Date(batchNowMs).toISOString(),
            storedMetricsByJobId: buildStoredPulseMetricSubset(params.storedMetricsByJobId, batchJobIds),
        });
    }
});
const markPulseMetricsFresh = (jobIds, nowMs) => {
    const freshUntilMs = nowMs + JOB_PULSE_METRIC_FRESHNESS_MS;
    jobIds.forEach((jobId) => {
        upsertPulseMetricFreshness(jobId, freshUntilMs);
    });
};
const isPulseMetricFresh = (jobId, metric, nowMs) => {
    const localFreshUntilMs = pulseMetricFreshUntilByJobId.get(jobId) || 0;
    if (localFreshUntilMs > nowMs)
        return true;
    return Boolean(metric && metric.refreshedAtMs >= (nowMs - JOB_PULSE_METRIC_FRESHNESS_MS));
};
const schedulePulseMetricRefresh = (params) => {
    if (params.jobIds.length === 0)
        return;
    maybePruneInflightPulseMetricRefreshes(params.nowMs);
    maybePrunePulseMetricFreshness(params.nowMs);
    const refreshJobIds = params.jobIds.filter((jobId) => {
        if (isPulseMetricFresh(jobId, params.storedMetricsByJobId.get(jobId), params.nowMs)) {
            return false;
        }
        return !inflightPulseMetricRefreshes.has(jobId);
    });
    if (refreshJobIds.length === 0)
        return;
    const refreshBatchPromise = (0, jobPulseMetricRefreshQueueService_1.scheduleJobPulseMetricRefreshTask)({
        jobIds: refreshJobIds,
        stateByJobId: new Map(buildStoredPulseMetricSubset(params.storedMetricsByJobId, refreshJobIds)),
        runTask: (jobIds, stateByJobId) => __awaiter(void 0, void 0, void 0, function* () {
            yield refreshPulseMetricBatches({
                db: params.db,
                jobIds,
                storedMetricsByJobId: stateByJobId,
            });
            markPulseMetricsFresh(jobIds, Date.now());
        }),
    });
    if (!refreshBatchPromise)
        return;
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
            if ((current === null || current === void 0 ? void 0 : current.promise) === refreshBatchPromise) {
                inflightPulseMetricRefreshes.delete(jobId);
            }
        });
    });
    trimInflightPulseMetricRefreshesToLimit();
};
const resolvePulseMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobIds.length === 0)
        return new Map();
    const storedMetricsByJobId = yield readStoredPulseMetrics({
        db: params.db,
        jobIds: params.jobIds,
    });
    const merged = new Map();
    const staleJobIds = [];
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
});
const resolvePulseIdentityFields = (job) => {
    const source = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.source, 120) || null;
    const sourceType = (0, jobPulseUtils_1.resolveJobPulseSourceType)(source);
    return {
        slug: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.slug, 220),
        title: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 200),
        companyName: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.companyName, 180),
        source,
        sourceType,
        canDisplayAuraApplicants: sourceType === 'aura',
    };
};
const resolvePulseTimingFields = (job) => {
    const discoveredAt = (0, jobPulseUtils_1.resolveJobPulseDiscoveredAt)(job);
    const postedAt = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.publishedAt, 80) || null;
    return {
        discoveredAt,
        publishedAt: postedAt,
        postedAt,
    };
};
const resolvePulseCountFields = (job, metrics) => {
    const totalApplicationCount = (0, jobPulseUtils_1.normalizeJobPulseCount)(job === null || job === void 0 ? void 0 : job.applicationCount);
    const auraViewCount = (0, jobPulseUtils_1.normalizeJobPulseCount)(job === null || job === void 0 ? void 0 : job.viewCount);
    const source = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.source, 120) || null;
    const sourceType = (0, jobPulseUtils_1.resolveJobPulseSourceType)(source);
    const auraApplicationCount = sourceType === 'aura' ? totalApplicationCount : 0;
    return {
        auraApplicationCount,
        auraViewCount,
        applicationCount: totalApplicationCount,
        viewCount: auraViewCount,
        applicationsLast2h: (metrics === null || metrics === void 0 ? void 0 : metrics.applicationsLast2h) || 0,
        applicationsLast24h: (metrics === null || metrics === void 0 ? void 0 : metrics.applicationsLast24h) || 0,
        applicationsToday: (metrics === null || metrics === void 0 ? void 0 : metrics.applicationsToday) || 0,
        viewsLast1h: (metrics === null || metrics === void 0 ? void 0 : metrics.viewsLast1h) || 0,
        matchesLast10m: (metrics === null || metrics === void 0 ? void 0 : metrics.matchesLast10m) || 0,
        savesToday: (metrics === null || metrics === void 0 ? void 0 : metrics.savesToday) || 0,
        savesLast24h: (metrics === null || metrics === void 0 ? void 0 : metrics.savesLast24h) || 0,
    };
};
const buildPulseSnapshot = (params) => {
    var _a;
    const identity = resolvePulseIdentityFields(params.job);
    const timing = resolvePulseTimingFields(params.job);
    const counts = resolvePulseCountFields(params.job, params.metrics);
    const heatScore = (0, jobPulseDomain_1.computeJobHeatScore)({
        applicationsLast2h: counts.applicationsLast2h,
        applicationsToday: counts.applicationsToday,
        totalAuraApplications: counts.auraApplicationCount,
        viewsLast1h: counts.viewsLast1h,
        savesToday: counts.savesToday,
    });
    return {
        jobId: params.jobId,
        identity,
        timing: Object.assign(Object.assign({}, timing), { lastActivityAt: (0, jobPulseUtils_1.resolveLatestJobPulseIso)((_a = params.metrics) === null || _a === void 0 ? void 0 : _a.latestAt) }),
        metrics: counts,
        scores: {
            heatScore,
            heatLabel: (0, jobPulseDomain_1.resolveJobHeatLabel)(heatScore),
            hotScore: (0, jobPulseDomain_1.computeWindowedJobPulseActivityScore)({
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
const buildPulseSnapshotsFromJobs = (params) => params.orderedJobIds.map((jobId) => buildPulseSnapshot({
    jobId,
    job: params.jobsById.get(jobId) || {},
    metrics: params.pulseMetricsByJobId.get(jobId),
    nowMs: params.nowMs,
}));
const sortPulseSnapshotsByHeat = (snapshots, limit) => [...snapshots]
    .sort((left, right) => {
    if (right.scores.heatScore !== left.scores.heatScore)
        return right.scores.heatScore - left.scores.heatScore;
    if (right.metrics.viewsLast1h !== left.metrics.viewsLast1h)
        return right.metrics.viewsLast1h - left.metrics.viewsLast1h;
    if (right.metrics.applicationsLast2h !== left.metrics.applicationsLast2h)
        return right.metrics.applicationsLast2h - left.metrics.applicationsLast2h;
    return String(right.timing.lastActivityAt || right.timing.discoveredAt || '').localeCompare(String(left.timing.lastActivityAt || left.timing.discoveredAt || ''));
})
    .slice(0, limit);
const normalizePulseSnapshotListParams = (params) => {
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
const listJobPulseSnapshots = (params) => __awaiter(void 0, void 0, void 0, function* () {
    (0, exports.ensureJobPulseSnapshotCleanupTimer)();
    const { requestedJobIds, limit, sortBy, cacheKey } = normalizePulseSnapshotListParams(params);
    const nowMs = Date.now();
    maybePrunePulseSnapshotCache(nowMs);
    const cached = resolveCachedPulseSnapshots(cacheKey, nowMs);
    if (cached)
        return cached;
    const { jobsById, orderedJobIds } = yield fetchPulseJobs({
        db: params.db,
        requestedJobIds,
        limit,
        sortBy,
    });
    if (orderedJobIds.length === 0)
        return [];
    const pulseMetricsByJobId = yield resolvePulseMetrics({
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
});
exports.listJobPulseSnapshots = listJobPulseSnapshots;
const buildJobHeatResponseFields = (params = {}) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    return ({
        sourceType: ((_a = params.snapshot) === null || _a === void 0 ? void 0 : _a.identity.sourceType) === 'aura' ? 'aura' : 'aggregated',
        canDisplayAuraApplicants: Boolean((_b = params.snapshot) === null || _b === void 0 ? void 0 : _b.identity.canDisplayAuraApplicants),
        heatScore: Number.isFinite(Number((_c = params.snapshot) === null || _c === void 0 ? void 0 : _c.scores.heatScore)) ? Math.max(0, Math.round(Number((_d = params.snapshot) === null || _d === void 0 ? void 0 : _d.scores.heatScore))) : 0,
        heatLabel: ((_e = params.snapshot) === null || _e === void 0 ? void 0 : _e.scores.heatLabel) || 'low',
        applicationsLast2h: Number.isFinite(Number((_f = params.snapshot) === null || _f === void 0 ? void 0 : _f.metrics.applicationsLast2h)) ? Math.max(0, Math.floor(Number((_g = params.snapshot) === null || _g === void 0 ? void 0 : _g.metrics.applicationsLast2h))) : 0,
        applicationsToday: Number.isFinite(Number((_h = params.snapshot) === null || _h === void 0 ? void 0 : _h.metrics.applicationsToday)) ? Math.max(0, Math.floor(Number((_j = params.snapshot) === null || _j === void 0 ? void 0 : _j.metrics.applicationsToday))) : 0,
        viewsLast1h: Number.isFinite(Number((_k = params.snapshot) === null || _k === void 0 ? void 0 : _k.metrics.viewsLast1h)) ? Math.max(0, Math.floor(Number((_l = params.snapshot) === null || _l === void 0 ? void 0 : _l.metrics.viewsLast1h))) : 0,
        savesToday: Number.isFinite(Number((_m = params.snapshot) === null || _m === void 0 ? void 0 : _m.metrics.savesToday)) ? Math.max(0, Math.floor(Number((_o = params.snapshot) === null || _o === void 0 ? void 0 : _o.metrics.savesToday))) : 0,
        auraApplicationCount: Number.isFinite(Number((_p = params.snapshot) === null || _p === void 0 ? void 0 : _p.metrics.auraApplicationCount)) ? Math.max(0, Math.floor(Number((_q = params.snapshot) === null || _q === void 0 ? void 0 : _q.metrics.auraApplicationCount))) : 0,
        auraViewCount: Number.isFinite(Number((_r = params.snapshot) === null || _r === void 0 ? void 0 : _r.metrics.auraViewCount)) ? Math.max(0, Math.floor(Number((_s = params.snapshot) === null || _s === void 0 ? void 0 : _s.metrics.auraViewCount))) : 0,
        lastActivityAt: (0, inputSanitizers_1.readString)((_t = params.snapshot) === null || _t === void 0 ? void 0 : _t.timing.lastActivityAt, 80) || null,
    });
};
exports.buildJobHeatResponseFields = buildJobHeatResponseFields;
