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
exports.incrementJobViewCountAsync = exports.flushRegisteredJobViewCountBuffer = exports.registerJobViewCountShutdownHooks = void 0;
const db_1 = require("../db");
const jobPulseService_1 = require("./jobPulseService");
const JOBS_COLLECTION = 'jobs';
const JOB_VIEW_FLUSH_INTERVAL_MS = 5000;
const JOB_VIEW_BUFFER_MAX_KEYS = 400;
const JOB_VIEW_BUFFER_HARD_MAX_KEYS = 1000;
const JOB_VIEW_BUFFER_GROWTH_STEP_KEYS = 500;
const JOB_VIEW_FLUSH_BATCH_SIZE = 100;
const pendingJobViewCount = new Map();
const flushingJobViewCount = new Map();
let isJobViewFlushScheduled = false;
let isJobViewFlushInFlight = false;
let shouldFlushJobViewCountAgain = false;
let isJobViewShutdownHookRegistered = false;
let jobViewCountDbProvider = null;
let hasLoggedJobViewBufferGrowth = false;
let jobViewFlushChain = Promise.resolve();
let jobViewFlushTimer = null;
let isJobViewShutdownDraining = false;
let jobViewBufferCapacity = JOB_VIEW_BUFFER_HARD_MAX_KEYS;
const takePendingJobViewCountBatch = () => {
    if (flushingJobViewCount.size > 0) {
        return [];
    }
    const snapshot = Array.from(pendingJobViewCount.entries()).slice(0, JOB_VIEW_FLUSH_BATCH_SIZE);
    for (const [jobId, count] of snapshot) {
        pendingJobViewCount.delete(jobId);
        flushingJobViewCount.set(jobId, count);
    }
    return snapshot;
};
const clearFlushingJobViewCountBatch = () => {
    flushingJobViewCount.clear();
};
const restoreFlushingJobViewCountBatch = () => {
    for (const [jobId, count] of flushingJobViewCount.entries()) {
        pendingJobViewCount.set(jobId, (pendingJobViewCount.get(jobId) || 0) + count);
    }
    flushingJobViewCount.clear();
};
const flushJobViewCountBuffer = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (isJobViewFlushInFlight) {
        shouldFlushJobViewCountAgain = true;
        return;
    }
    if (pendingJobViewCount.size === 0)
        return;
    const snapshot = takePendingJobViewCountBatch();
    if (snapshot.length === 0)
        return;
    isJobViewFlushInFlight = true;
    const operations = snapshot.map(([jobId, count]) => ({
        updateOne: {
            filter: { id: jobId, status: { $ne: 'archived' } },
            update: { $inc: { viewCount: count } },
        },
    }));
    try {
        yield db.collection(JOBS_COLLECTION).bulkWrite(operations, { ordered: false });
        clearFlushingJobViewCountBatch();
    }
    catch (error) {
        restoreFlushingJobViewCountBatch();
        console.warn('Flush job view count buffer error:', error);
    }
    finally {
        isJobViewFlushInFlight = false;
        if (pendingJobViewCount.size <= JOB_VIEW_BUFFER_HARD_MAX_KEYS) {
            jobViewBufferCapacity = JOB_VIEW_BUFFER_HARD_MAX_KEYS;
            hasLoggedJobViewBufferGrowth = false;
        }
        const shouldFlushAgain = shouldFlushJobViewCountAgain || pendingJobViewCount.size >= JOB_VIEW_BUFFER_MAX_KEYS;
        shouldFlushJobViewCountAgain = false;
        if (pendingJobViewCount.size > 0 && !isJobViewShutdownDraining) {
            scheduleJobViewCountFlush(db);
            if (shouldFlushAgain) {
                return;
            }
        }
    }
});
const scheduleJobViewCountFlush = (db) => {
    if (isJobViewFlushScheduled)
        return;
    isJobViewFlushScheduled = true;
    jobViewFlushTimer = setTimeout(() => {
        jobViewFlushTimer = null;
        isJobViewFlushScheduled = false;
        jobViewFlushChain = jobViewFlushChain
            .then(() => flushJobViewCountBuffer(db))
            .catch((error) => {
            console.warn('Flush job view count queue error:', error);
        });
    }, JOB_VIEW_FLUSH_INTERVAL_MS);
};
const registerJobViewCountShutdownHooks = (dbProvider = db_1.getDB) => {
    jobViewCountDbProvider = dbProvider;
    if (isJobViewShutdownHookRegistered)
        return;
    isJobViewShutdownHookRegistered = true;
};
exports.registerJobViewCountShutdownHooks = registerJobViewCountShutdownHooks;
const flushRegisteredJobViewCountBuffer = () => __awaiter(void 0, void 0, void 0, function* () {
    if (!jobViewCountDbProvider || !(0, db_1.isDBConnected)())
        return;
    isJobViewShutdownDraining = true;
    if (jobViewFlushTimer) {
        clearTimeout(jobViewFlushTimer);
        jobViewFlushTimer = null;
        isJobViewFlushScheduled = false;
    }
    try {
        yield jobViewFlushChain;
        const db = jobViewCountDbProvider();
        let previousPendingSize = -1;
        while ((pendingJobViewCount.size > 0 || flushingJobViewCount.size > 0)
            && pendingJobViewCount.size !== previousPendingSize) {
            yield jobViewFlushChain;
            previousPendingSize = pendingJobViewCount.size;
            yield flushJobViewCountBuffer(db);
        }
        yield jobViewFlushChain;
    }
    finally {
        isJobViewShutdownDraining = false;
    }
});
exports.flushRegisteredJobViewCountBuffer = flushRegisteredJobViewCountBuffer;
const incrementJobViewCountAsync = (db, jobId, userId) => {
    if (!jobId)
        return;
    if (!pendingJobViewCount.has(jobId) && pendingJobViewCount.size >= jobViewBufferCapacity) {
        jobViewBufferCapacity += JOB_VIEW_BUFFER_GROWTH_STEP_KEYS;
        if (!hasLoggedJobViewBufferGrowth) {
            hasLoggedJobViewBufferGrowth = true;
            console.warn(`Job view count buffer exceeded ${JOB_VIEW_BUFFER_HARD_MAX_KEYS} unique jobs. Expanding buffer capacity to ${jobViewBufferCapacity} while the queued writes drain.`);
        }
    }
    pendingJobViewCount.set(jobId, (pendingJobViewCount.get(jobId) || 0) + 1);
    (0, jobPulseService_1.recordJobPulseEventAsync)(db, {
        jobId,
        type: 'job_viewed',
        userId,
    });
    if (pendingJobViewCount.size >= JOB_VIEW_BUFFER_MAX_KEYS) {
        scheduleJobViewCountFlush(db);
        return;
    }
    scheduleJobViewCountFlush(db);
};
exports.incrementJobViewCountAsync = incrementJobViewCountAsync;
