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
exports.startReverseMatchQueueWorker = exports.nudgeReverseMatchQueueWorker = exports.enqueueReverseJobMatchJobs = exports.ensureReverseMatchQueueIndexes = void 0;
const reverseJobMatchService_1 = require("./reverseJobMatchService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const REVERSE_MATCH_QUEUE_COLLECTION = 'job_reverse_match_queue';
const REVERSE_MATCH_QUEUE_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_BATCH_SIZE))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_BATCH_SIZE)))
    : 12;
const REVERSE_MATCH_QUEUE_POLL_INTERVAL_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_POLL_INTERVAL_MS))
    ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_POLL_INTERVAL_MS)))
    : 3000;
const REVERSE_MATCH_QUEUE_RETRY_DELAY_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_RETRY_DELAY_MS))
    ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_RETRY_DELAY_MS)))
    : 30000;
const REVERSE_MATCH_QUEUE_MAX_ATTEMPTS = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_MAX_ATTEMPTS))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_MAX_ATTEMPTS)))
    : 3;
let reverseMatchQueueIndexesPromise = null;
let reverseMatchQueueWorkerTimer = null;
let reverseMatchQueuePumpScheduled = false;
let reverseMatchQueuePumpInFlight = false;
let reverseMatchQueueDbProvider = null;
const buildReverseMatchQueueId = (jobId) => `reverse-match:${jobId}`;
const ensureReverseMatchQueueIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (!reverseMatchQueueIndexesPromise) {
        reverseMatchQueueIndexesPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
            yield Promise.all([
                db.collection(REVERSE_MATCH_QUEUE_COLLECTION).createIndex({ id: 1 }, { name: 'reverse_match_queue_id_unique', unique: true }),
                db.collection(REVERSE_MATCH_QUEUE_COLLECTION).createIndex({ status: 1, availableAtDate: 1, updatedAt: 1 }, { name: 'reverse_match_queue_status_available_idx' }),
            ]);
        }))().catch((error) => {
            reverseMatchQueueIndexesPromise = null;
            throw error;
        });
    }
    return reverseMatchQueueIndexesPromise;
});
exports.ensureReverseMatchQueueIndexes = ensureReverseMatchQueueIndexes;
const normalizeQueuedJobIds = (jobIds) => Array.from(new Set((Array.isArray(jobIds) ? jobIds : [])
    .map((jobId) => (0, inputSanitizers_1.readString)(jobId, 120))
    .filter((jobId) => jobId.length > 0)));
const claimReverseMatchQueueEntries = (db, nowIso) => __awaiter(void 0, void 0, void 0, function* () {
    const nowDate = new Date(nowIso);
    const queuedEntries = yield db.collection(REVERSE_MATCH_QUEUE_COLLECTION).find({
        status: 'queued',
        availableAtDate: { $lte: nowDate },
    }, {
        projection: { id: 1, jobId: 1 },
        sort: { availableAtDate: 1, updatedAt: 1 },
        limit: REVERSE_MATCH_QUEUE_BATCH_SIZE,
    }).toArray();
    if (queuedEntries.length === 0) {
        return [];
    }
    const queuedIds = queuedEntries
        .map((entry) => (0, inputSanitizers_1.readString)(entry === null || entry === void 0 ? void 0 : entry.id, 160))
        .filter((id) => id.length > 0);
    if (queuedIds.length === 0) {
        return [];
    }
    yield db.collection(REVERSE_MATCH_QUEUE_COLLECTION).updateMany({
        id: { $in: queuedIds },
        status: 'queued',
        availableAtDate: { $lte: nowDate },
    }, {
        $set: {
            status: 'processing',
            processingStartedAt: nowIso,
            updatedAt: nowIso,
        },
        $inc: { attempts: 1 },
    });
    const claimed = yield db.collection(REVERSE_MATCH_QUEUE_COLLECTION).find({
        id: { $in: queuedIds },
        status: 'processing',
        processingStartedAt: nowIso,
    }, {
        projection: { id: 1, jobId: 1, attempts: 1 },
    }).toArray();
    return claimed
        .map((entry) => ({
        id: (0, inputSanitizers_1.readString)(entry === null || entry === void 0 ? void 0 : entry.id, 160),
        jobId: (0, inputSanitizers_1.readString)(entry === null || entry === void 0 ? void 0 : entry.jobId, 120),
        attempts: Number.isFinite(Number(entry === null || entry === void 0 ? void 0 : entry.attempts)) ? Number(entry.attempts) : 0,
    }))
        .filter((entry) => entry.id.length > 0 && entry.jobId.length > 0);
});
const completeReverseMatchQueueEntries = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const ids = params.entries
        .map((entry) => (0, inputSanitizers_1.readString)(entry.id, 160))
        .filter((id) => id.length > 0);
    if (ids.length === 0)
        return;
    yield params.db.collection(REVERSE_MATCH_QUEUE_COLLECTION).updateMany({
        id: { $in: ids },
        status: 'processing',
    }, {
        $set: {
            status: 'completed',
            completedAt: params.completedAtIso,
            updatedAt: params.completedAtIso,
        },
        $unset: {
            processingStartedAt: '',
        },
    });
});
const deleteReverseMatchQueueEntries = (db, entries) => __awaiter(void 0, void 0, void 0, function* () {
    const ids = entries
        .map((entry) => (0, inputSanitizers_1.readString)(entry.id, 160))
        .filter((id) => id.length > 0);
    if (ids.length === 0)
        return;
    yield db.collection(REVERSE_MATCH_QUEUE_COLLECTION).deleteMany({
        id: { $in: ids },
        status: 'completed',
    });
});
const requeueReverseMatchQueueEntries = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (params.entries.length === 0)
        return;
    const errorMessage = (0, inputSanitizers_1.readString)((_a = params.error) === null || _a === void 0 ? void 0 : _a.message, 300) || 'Reverse match queue processing failed';
    const retryAtIso = new Date(Date.now() + REVERSE_MATCH_QUEUE_RETRY_DELAY_MS).toISOString();
    const retryAtDate = new Date(retryAtIso);
    yield params.db.collection(REVERSE_MATCH_QUEUE_COLLECTION).bulkWrite(params.entries.map((entry) => {
        const attempts = Number.isFinite(Number(entry.attempts)) ? Number(entry.attempts) : 0;
        const shouldFail = attempts >= REVERSE_MATCH_QUEUE_MAX_ATTEMPTS;
        return {
            updateOne: {
                filter: { id: entry.id, status: 'processing' },
                update: shouldFail
                    ? {
                        $set: {
                            status: 'failed',
                            failedAt: params.nowIso,
                            updatedAt: params.nowIso,
                            lastError: errorMessage,
                        },
                        $unset: {
                            processingStartedAt: '',
                            availableAt: '',
                            availableAtDate: '',
                        },
                    }
                    : {
                        $set: {
                            status: 'queued',
                            availableAt: retryAtIso,
                            availableAtDate: retryAtDate,
                            updatedAt: params.nowIso,
                            lastError: errorMessage,
                        },
                        $unset: {
                            processingStartedAt: '',
                        },
                    },
            },
        };
    }), { ordered: false });
});
const processReverseMatchQueueBatch = (dbProvider) => __awaiter(void 0, void 0, void 0, function* () {
    if (reverseMatchQueuePumpInFlight)
        return;
    reverseMatchQueuePumpInFlight = true;
    try {
        const db = dbProvider();
        yield (0, exports.ensureReverseMatchQueueIndexes)(db);
        const nowIso = new Date().toISOString();
        const entries = yield claimReverseMatchQueueEntries(db, nowIso);
        if (entries.length === 0)
            return;
        try {
            yield (0, reverseJobMatchService_1.processReverseJobMatchesForIngestedPayload)({
                db,
                jobIds: entries.map((entry) => entry.jobId),
                nowIso,
            });
            yield completeReverseMatchQueueEntries({
                db,
                entries,
                completedAtIso: nowIso,
            });
            yield deleteReverseMatchQueueEntries(db, entries);
        }
        catch (error) {
            yield requeueReverseMatchQueueEntries({
                db,
                entries,
                nowIso,
                error,
            });
            console.error('Reverse match queue batch error:', error);
        }
    }
    catch (error) {
        console.error('Reverse match queue pump error:', error);
    }
    finally {
        reverseMatchQueuePumpInFlight = false;
    }
});
const enqueueReverseJobMatchJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const jobIds = normalizeQueuedJobIds(params.jobIds);
    if (jobIds.length === 0)
        return 0;
    yield (0, exports.ensureReverseMatchQueueIndexes)(params.db);
    const queuedAtIso = (0, inputSanitizers_1.readString)(params.queuedAtIso, 80) || new Date().toISOString();
    const queuedAtDate = new Date(queuedAtIso);
    yield params.db.collection(REVERSE_MATCH_QUEUE_COLLECTION).bulkWrite(jobIds.map((jobId) => ({
        updateOne: {
            filter: { id: buildReverseMatchQueueId(jobId) },
            update: {
                $set: {
                    jobId,
                    status: 'queued',
                    availableAt: queuedAtIso,
                    availableAtDate: queuedAtDate,
                    updatedAt: queuedAtIso,
                },
                $unset: {
                    failedAt: '',
                    processingStartedAt: '',
                    lastError: '',
                },
                $setOnInsert: {
                    id: buildReverseMatchQueueId(jobId),
                    createdAt: queuedAtIso,
                    attempts: 0,
                },
            },
            upsert: true,
        },
    })), { ordered: false });
    (0, exports.nudgeReverseMatchQueueWorker)();
    return jobIds.length;
});
exports.enqueueReverseJobMatchJobs = enqueueReverseJobMatchJobs;
const nudgeReverseMatchQueueWorker = () => {
    if (!reverseMatchQueueDbProvider || reverseMatchQueuePumpScheduled)
        return;
    reverseMatchQueuePumpScheduled = true;
    setImmediate(() => {
        reverseMatchQueuePumpScheduled = false;
        void processReverseMatchQueueBatch(reverseMatchQueueDbProvider);
    });
};
exports.nudgeReverseMatchQueueWorker = nudgeReverseMatchQueueWorker;
const startReverseMatchQueueWorker = (dbProvider) => {
    var _a;
    reverseMatchQueueDbProvider = dbProvider;
    if (reverseMatchQueueWorkerTimer)
        return;
    reverseMatchQueueWorkerTimer = setInterval(() => {
        void processReverseMatchQueueBatch(dbProvider);
    }, REVERSE_MATCH_QUEUE_POLL_INTERVAL_MS);
    (_a = reverseMatchQueueWorkerTimer.unref) === null || _a === void 0 ? void 0 : _a.call(reverseMatchQueueWorkerTimer);
    (0, exports.nudgeReverseMatchQueueWorker)();
};
exports.startReverseMatchQueueWorker = startReverseMatchQueueWorker;
