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
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.listJobPulseSnapshots = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobPulseUtils_1 = require("./jobPulseUtils");
const jobPulseDomain_1 = require("./jobPulseDomain");
const JOBS_COLLECTION = 'jobs';
const JOB_PULSE_BUCKETS_COLLECTION = 'job_pulse_time_buckets';
const JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION = 'job_pulse_metric_snapshots';
const JOB_PULSE_CACHE_TTL_MS = 15000;
const JOB_PULSE_METRIC_FRESHNESS_MS = 30000;
const JOB_PULSE_INFLIGHT_REFRESH_TTL_MS = 60000;
const JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS = 60000;
const MAX_JOB_PULSE_SNAPSHOT_LIMIT = 20;
const MAX_PULSE_SNAPSHOT_CACHE_ENTRIES = 100;
const MAX_INFLIGHT_PULSE_METRIC_REFRESHES = 200;
const pulseSnapshotCache = new Map();
const inflightPulseMetricRefreshes = new Map();
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
const buildPulseCacheKey = (requestedJobIds, limit) => requestedJobIds.length > 0
    ? `ids:${requestedJobIds.join(',')}:${limit}`
    : `latest:${limit}`;
const resolveCachedPulseSnapshots = (cacheKey, nowMs) => {
    const cached = pulseSnapshotCache.get(cacheKey);
    if (!cached || cached.expiresAt <= nowMs)
        return null;
    pulseSnapshotCache.delete(cacheKey);
    pulseSnapshotCache.set(cacheKey, cached);
    return cached.data;
};
const cachePulseSnapshots = (cacheKey, nowMs, snapshots) => {
    prunePulseSnapshotCache(nowMs);
    pulseSnapshotCache.set(cacheKey, {
        expiresAt: nowMs + JOB_PULSE_CACHE_TTL_MS,
        data: snapshots,
    });
};
const prunePulseSnapshotCache = (nowMs) => {
    for (const [key, entry] of pulseSnapshotCache.entries()) {
        if (entry.expiresAt <= nowMs) {
            pulseSnapshotCache.delete(key);
        }
    }
    while (pulseSnapshotCache.size > MAX_PULSE_SNAPSHOT_CACHE_ENTRIES) {
        const oldestEntry = pulseSnapshotCache.keys().next();
        if (oldestEntry.done)
            break;
        pulseSnapshotCache.delete(oldestEntry.value);
    }
};
const pruneInflightPulseMetricRefreshes = (nowMs) => {
    for (const [jobId, entry] of inflightPulseMetricRefreshes.entries()) {
        if ((nowMs - entry.createdAt) >= JOB_PULSE_INFLIGHT_REFRESH_TTL_MS) {
            inflightPulseMetricRefreshes.delete(jobId);
        }
    }
    while (inflightPulseMetricRefreshes.size > MAX_INFLIGHT_PULSE_METRIC_REFRESHES) {
        const oldestEntry = inflightPulseMetricRefreshes.keys().next();
        if (oldestEntry.done)
            break;
        inflightPulseMetricRefreshes.delete(oldestEntry.value);
    }
};
(_b = (_a = setInterval(() => {
    const nowMs = Date.now();
    prunePulseSnapshotCache(nowMs);
    pruneInflightPulseMetricRefreshes(nowMs);
}, JOB_PULSE_CACHE_CLEANUP_INTERVAL_MS)).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
const fetchPulseJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
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
            .limit(params.limit)
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
const indexPulseMetricsByJobId = (rows) => {
    const next = new Map();
    rows.forEach((row) => {
        const jobId = (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row._id, 120);
        if (!jobId)
            return;
        next.set(jobId, {
            applicationsLast24h: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.applicationsLast24h))
                ? Math.max(0, Math.floor(Number(row.applicationsLast24h)))
                : 0,
            viewsLast60m: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.viewsLast60m))
                ? Math.max(0, Math.floor(Number(row.viewsLast60m)))
                : 0,
            matchesLast10m: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.matchesLast10m))
                ? Math.max(0, Math.floor(Number(row.matchesLast10m)))
                : 0,
            savesLast24h: Number.isFinite(Number(row === null || row === void 0 ? void 0 : row.savesLast24h))
                ? Math.max(0, Math.floor(Number(row.savesLast24h)))
                : 0,
            latestAt: (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.latestAt, 80) || null,
        });
    });
    return next;
};
const aggregatePulseMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobIds.length === 0)
        return new Map();
    const { applicationSince, viewSince, matchSince, saveSince, } = (0, jobPulseDomain_1.buildJobPulseWindowBounds)(params.nowMs);
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
                applicationsLast24h: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobAppliedCount', applicationSince),
                viewsLast60m: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobViewedCount', viewSince),
                matchesLast10m: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobMatchedCount', matchSince),
                savesLast24h: (0, jobPulseDomain_1.buildJobPulseBucketWindowSumExpression)('jobSavedCount', saveSince),
                latestAt: { $max: '$latestEventAt' },
            },
        },
    ])
        .toArray();
    return indexPulseMetricsByJobId(rows);
});
const buildEmptyPulseMetric = () => ({
    applicationsLast24h: 0,
    viewsLast60m: 0,
    matchesLast10m: 0,
    savesLast24h: 0,
    latestAt: null,
});
const readFreshPulseMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobIds.length === 0)
        return new Map();
    const freshnessDate = new Date(params.nowMs - JOB_PULSE_METRIC_FRESHNESS_MS);
    const rows = yield params.db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION)
        .find({
        jobId: { $in: params.jobIds },
        refreshedAtDate: { $gte: freshnessDate },
    }, {
        projection: {
            _id: 0,
            jobId: 1,
            applicationsLast24h: 1,
            viewsLast60m: 1,
            matchesLast10m: 1,
            savesLast24h: 1,
            latestAt: 1,
        },
    })
        .toArray();
    return indexPulseMetricsByJobId(rows.map((row) => ({
        _id: (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.jobId, 120),
        applicationsLast24h: row === null || row === void 0 ? void 0 : row.applicationsLast24h,
        viewsLast60m: row === null || row === void 0 ? void 0 : row.viewsLast60m,
        matchesLast10m: row === null || row === void 0 ? void 0 : row.matchesLast10m,
        savesLast24h: row === null || row === void 0 ? void 0 : row.savesLast24h,
        latestAt: row === null || row === void 0 ? void 0 : row.latestAt,
    })));
});
const persistPulseMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobIds.length === 0)
        return;
    const refreshedAtDate = new Date(params.refreshedAtIso);
    yield params.db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).bulkWrite(params.jobIds.map((jobId) => {
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
    }), { ordered: false });
});
const createPulseMetricRefreshPromise = (params) => {
    const promisesByJobId = new Map();
    if (params.jobIds.length === 0)
        return promisesByJobId;
    pruneInflightPulseMetricRefreshes(params.nowMs);
    const refreshedAtIso = new Date(params.nowMs).toISOString();
    const refreshBatchPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
        const metricsByJobId = yield aggregatePulseMetrics(params);
        yield persistPulseMetrics({
            db: params.db,
            jobIds: params.jobIds,
            metricsByJobId,
            refreshedAtIso,
        });
        return metricsByJobId;
    }))();
    params.jobIds.forEach((jobId) => {
        const metricPromise = refreshBatchPromise
            .then((metricsByJobId) => metricsByJobId.get(jobId) || buildEmptyPulseMetric())
            .finally(() => {
            const current = inflightPulseMetricRefreshes.get(jobId);
            if ((current === null || current === void 0 ? void 0 : current.promise) === metricPromise) {
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
const resolveInflightPulseMetricPromises = (params) => {
    const promisesByJobId = new Map();
    const missingJobIds = [];
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
const resolvePulseMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobIds.length === 0)
        return new Map();
    const freshMetricsByJobId = yield readFreshPulseMetrics(params);
    if (freshMetricsByJobId.size === params.jobIds.length) {
        return freshMetricsByJobId;
    }
    const staleJobIds = params.jobIds.filter((jobId) => !freshMetricsByJobId.has(jobId));
    const inflightPromisesByJobId = resolveInflightPulseMetricPromises({
        db: params.db,
        jobIds: staleJobIds,
        nowMs: params.nowMs,
    });
    const recalculatedMetricsByJobId = new Map();
    yield Promise.all(staleJobIds.map((jobId) => __awaiter(void 0, void 0, void 0, function* () {
        const metricPromise = inflightPromisesByJobId.get(jobId);
        const metric = metricPromise ? yield metricPromise : buildEmptyPulseMetric();
        recalculatedMetricsByJobId.set(jobId, metric);
    })));
    const merged = new Map();
    params.jobIds.forEach((jobId) => {
        merged.set(jobId, freshMetricsByJobId.get(jobId) || recalculatedMetricsByJobId.get(jobId) || buildEmptyPulseMetric());
    });
    return merged;
});
const resolvePulseIdentityFields = (jobId, job) => {
    const source = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.source, 120) || null;
    const sourceType = (0, jobPulseUtils_1.resolveJobPulseSourceType)(source);
    return {
        jobId,
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
        applicationsLast24h: (metrics === null || metrics === void 0 ? void 0 : metrics.applicationsLast24h) || 0,
        viewsLast60m: (metrics === null || metrics === void 0 ? void 0 : metrics.viewsLast60m) || 0,
        matchesLast10m: (metrics === null || metrics === void 0 ? void 0 : metrics.matchesLast10m) || 0,
        savesLast24h: (metrics === null || metrics === void 0 ? void 0 : metrics.savesLast24h) || 0,
    };
};
const buildPulseSnapshot = (params) => {
    var _a;
    const identity = resolvePulseIdentityFields(params.jobId, params.job);
    const timing = resolvePulseTimingFields(params.job);
    const counts = resolvePulseCountFields(params.job, params.metrics);
    return Object.assign(Object.assign(Object.assign(Object.assign({}, identity), timing), counts), { hotScore: (0, jobPulseDomain_1.computeJobPulseHotScore)({
            applicationsLast24h: counts.applicationsLast24h,
            viewsLast60m: counts.viewsLast60m,
            matchesLast10m: counts.matchesLast10m,
            savesLast24h: counts.savesLast24h,
            discoveredAt: timing.discoveredAt,
            nowMs: params.nowMs,
        }), lastActivityAt: (0, jobPulseUtils_1.resolveLatestJobPulseIso)((_a = params.metrics) === null || _a === void 0 ? void 0 : _a.latestAt) });
};
const buildPulseSnapshotsFromJobs = (params) => params.orderedJobIds.map((jobId) => buildPulseSnapshot({
    jobId,
    job: params.jobsById.get(jobId) || {},
    metrics: params.pulseMetricsByJobId.get(jobId),
    nowMs: params.nowMs,
}));
const listJobPulseSnapshots = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const requestedJobIds = buildRequestedJobIds(params.requestedJobIds || []);
    const limit = Number.isFinite(Number(params.limit))
        ? Math.max(1, Math.min(MAX_JOB_PULSE_SNAPSHOT_LIMIT, Math.round(Number(params.limit))))
        : MAX_JOB_PULSE_SNAPSHOT_LIMIT;
    const cacheKey = buildPulseCacheKey(requestedJobIds, limit);
    const nowMs = Date.now();
    prunePulseSnapshotCache(nowMs);
    const cached = resolveCachedPulseSnapshots(cacheKey, nowMs);
    if (cached)
        return cached;
    const { jobsById, orderedJobIds } = yield fetchPulseJobs({
        db: params.db,
        requestedJobIds,
        limit,
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
    cachePulseSnapshots(cacheKey, nowMs, snapshots);
    return snapshots;
});
exports.listJobPulseSnapshots = listJobPulseSnapshots;
