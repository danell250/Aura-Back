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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRuntimeJobLock = exports.releaseRuntimeJobLock = exports.tryAcquireRuntimeJobLock = exports.ensureRuntimeJobLockIndexes = void 0;
const os_1 = __importDefault(require("os"));
const RUNTIME_JOB_LOCKS_COLLECTION = 'runtime_job_locks';
const RUNTIME_JOB_LOCK_OWNER_ID = `${os_1.default.hostname()}:${process.pid}`;
let runtimeJobLockIndexesPromise = null;
const ensureRuntimeJobLockIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (!runtimeJobLockIndexesPromise) {
        runtimeJobLockIndexesPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
            yield Promise.all([
                db.collection(RUNTIME_JOB_LOCKS_COLLECTION).createIndex({ jobKey: 1 }, { unique: true, name: 'runtime_job_locks_job_key_idx' }),
                db.collection(RUNTIME_JOB_LOCKS_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'runtime_job_locks_expires_at_ttl_idx' }),
            ]);
        }))().catch((error) => {
            runtimeJobLockIndexesPromise = null;
            throw error;
        });
    }
    return runtimeJobLockIndexesPromise;
});
exports.ensureRuntimeJobLockIndexes = ensureRuntimeJobLockIndexes;
const tryAcquireRuntimeJobLock = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, exports.ensureRuntimeJobLockIndexes)(params.db);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(1000, params.ttlMs));
    try {
        const result = yield params.db.collection(RUNTIME_JOB_LOCKS_COLLECTION).updateOne({
            jobKey: params.jobKey,
            $or: [
                { expiresAt: { $lte: now } },
                { ownerId: RUNTIME_JOB_LOCK_OWNER_ID },
            ],
        }, {
            $set: {
                jobKey: params.jobKey,
                ownerId: RUNTIME_JOB_LOCK_OWNER_ID,
                acquiredAt: now.toISOString(),
                expiresAt,
            },
            $setOnInsert: {
                createdAt: now.toISOString(),
            },
        }, { upsert: true });
        return result.matchedCount > 0 || result.upsertedCount > 0;
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) === 11000) {
            return false;
        }
        throw error;
    }
});
exports.tryAcquireRuntimeJobLock = tryAcquireRuntimeJobLock;
const releaseRuntimeJobLock = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield params.db.collection(RUNTIME_JOB_LOCKS_COLLECTION).updateOne({
        jobKey: params.jobKey,
        ownerId: RUNTIME_JOB_LOCK_OWNER_ID,
    }, {
        $set: {
            expiresAt: new Date(0),
            releasedAt: new Date().toISOString(),
        },
    });
});
exports.releaseRuntimeJobLock = releaseRuntimeJobLock;
const withRuntimeJobLock = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const acquired = yield (0, exports.tryAcquireRuntimeJobLock)({
        db: params.db,
        jobKey: params.jobKey,
        ttlMs: params.ttlMs,
    });
    if (!acquired)
        return null;
    try {
        return yield params.task();
    }
    finally {
        yield (0, exports.releaseRuntimeJobLock)({
            db: params.db,
            jobKey: params.jobKey,
        }).catch(() => undefined);
    }
});
exports.withRuntimeJobLock = withRuntimeJobLock;
