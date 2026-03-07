"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedSavedJobStates = exports.setCachedSavedJobState = exports.getCachedSavedJobState = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const SAVED_JOB_STATE_CACHE_TTL_MS = 30000;
const SAVED_JOB_STATE_CACHE_MAX_ITEMS = 10000;
const SAVED_JOB_STATE_CACHE_CLEANUP_INTERVAL_MS = 60000;
const savedJobStateCache = new Map();
const buildCacheKey = (currentUserId, jobId) => `${currentUserId}:${jobId}`;
const evictSavedJobStateCacheEntries = () => {
    while (savedJobStateCache.size > SAVED_JOB_STATE_CACHE_MAX_ITEMS) {
        const oldestKey = savedJobStateCache.keys().next().value;
        if (!oldestKey)
            break;
        savedJobStateCache.delete(oldestKey);
    }
};
const pruneExpiredSavedJobStateCacheEntries = () => {
    if (savedJobStateCache.size === 0)
        return;
    const now = Date.now();
    for (const [cacheKey, entry] of savedJobStateCache.entries()) {
        if (!entry || entry.expiresAt <= now) {
            savedJobStateCache.delete(cacheKey);
        }
    }
};
const savedJobStateCacheCleanupTimer = setInterval(() => {
    pruneExpiredSavedJobStateCacheEntries();
}, SAVED_JOB_STATE_CACHE_CLEANUP_INTERVAL_MS);
if (typeof (savedJobStateCacheCleanupTimer === null || savedJobStateCacheCleanupTimer === void 0 ? void 0 : savedJobStateCacheCleanupTimer.unref) === 'function') {
    savedJobStateCacheCleanupTimer.unref();
}
const touchAndReadCacheEntry = (cacheKey) => {
    const cached = savedJobStateCache.get(cacheKey);
    if (!cached)
        return null;
    if (cached.expiresAt <= Date.now()) {
        savedJobStateCache.delete(cacheKey);
        return null;
    }
    savedJobStateCache.delete(cacheKey);
    savedJobStateCache.set(cacheKey, cached);
    return cached;
};
const getCachedSavedJobState = (params) => {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const jobId = (0, inputSanitizers_1.readString)(params.jobId, 120);
    if (!currentUserId || !jobId)
        return undefined;
    const cached = touchAndReadCacheEntry(buildCacheKey(currentUserId, jobId));
    if (!cached)
        return undefined;
    return cached.state;
};
exports.getCachedSavedJobState = getCachedSavedJobState;
const setCachedSavedJobState = (params) => {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const jobId = (0, inputSanitizers_1.readString)(params.jobId, 120);
    if (!currentUserId || !jobId)
        return;
    const cacheKey = buildCacheKey(currentUserId, jobId);
    savedJobStateCache.delete(cacheKey);
    savedJobStateCache.set(cacheKey, {
        state: params.state,
        expiresAt: Date.now() + SAVED_JOB_STATE_CACHE_TTL_MS,
    });
    evictSavedJobStateCacheEntries();
};
exports.setCachedSavedJobState = setCachedSavedJobState;
const getCachedSavedJobStates = (params) => {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const userKeyPrefix = currentUserId ? `${currentUserId}:` : '';
    const jobIds = Array.from(new Set((Array.isArray(params.jobIds) ? params.jobIds : [])
        .map((jobId) => (0, inputSanitizers_1.readString)(jobId, 120))
        .filter((jobId) => jobId.length > 0)));
    const statesByJobId = new Map();
    const missingJobIds = [];
    if (!currentUserId || jobIds.length === 0) {
        return { statesByJobId, missingJobIds };
    }
    jobIds.forEach((jobId) => {
        const cached = touchAndReadCacheEntry(`${userKeyPrefix}${jobId}`);
        if (!cached) {
            missingJobIds.push(jobId);
            return;
        }
        if (cached.state) {
            statesByJobId.set(jobId, cached.state);
        }
    });
    return { statesByJobId, missingJobIds };
};
exports.getCachedSavedJobStates = getCachedSavedJobStates;
