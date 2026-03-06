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
exports.getOpenToWorkMetrics7d = exports.recordOpenToWorkInviteMetric = exports.recordOpenToWorkProfileViewMetric = exports.ensureOpenToWorkMetricsIndexes = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const OPEN_TO_WORK_DAILY_METRICS_COLLECTION = 'user_open_to_work_daily_metrics';
const OPEN_TO_WORK_METRICS_WINDOW_DAYS = 7;
const OPEN_TO_WORK_METRICS_CACHE_TTL_MS = 5 * 60 * 1000;
const metricsCache = new Map();
let metricsIndexesPromise = null;
const buildUtcDayKey = (date) => date.toISOString().slice(0, 10);
const buildUtcDayDate = (date) => {
    const normalized = new Date(date);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
};
const pruneMetricsCache = (now) => {
    for (const [key, entry] of metricsCache.entries()) {
        if (entry.expiresAt <= now) {
            metricsCache.delete(key);
        }
    }
    while (metricsCache.size > 500) {
        const oldest = metricsCache.keys().next();
        if (oldest.done)
            break;
        metricsCache.delete(oldest.value);
    }
};
const invalidateMetricsCache = (userId) => {
    const normalizedUserId = (0, inputSanitizers_1.readString)(userId, 120);
    if (!normalizedUserId)
        return;
    metricsCache.delete(normalizedUserId);
};
const ensureOpenToWorkMetricsIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (!metricsIndexesPromise) {
        metricsIndexesPromise = Promise.all([
            db.collection(OPEN_TO_WORK_DAILY_METRICS_COLLECTION).createIndex({ userId: 1, dateKey: 1 }, { name: 'open_to_work_metrics_user_date_unique', unique: true }),
            db.collection(OPEN_TO_WORK_DAILY_METRICS_COLLECTION).createIndex({ bucketDate: 1 }, { name: 'open_to_work_metrics_bucket_ttl', expireAfterSeconds: 90 * 24 * 60 * 60 }),
        ]).then(() => undefined).catch((error) => {
            metricsIndexesPromise = null;
            throw error;
        });
    }
    return metricsIndexesPromise;
});
exports.ensureOpenToWorkMetricsIndexes = ensureOpenToWorkMetricsIndexes;
const updateDailyMetrics = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = (0, inputSanitizers_1.readString)(params.userId, 120);
    if (!userId)
        return;
    yield (0, exports.ensureOpenToWorkMetricsIndexes)(params.db);
    const now = new Date();
    const dateKey = buildUtcDayKey(now);
    const bucketDate = buildUtcDayDate(now);
    yield params.db.collection(OPEN_TO_WORK_DAILY_METRICS_COLLECTION).updateOne({ userId, dateKey }, {
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
    }, { upsert: true });
    invalidateMetricsCache(userId);
});
const recordOpenToWorkProfileViewMetric = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield updateDailyMetrics({
        db: params.db,
        userId: params.userId,
        profileViewsIncrement: 1,
        companyViewsIncrement: params.viewerIdentityType === 'company' ? 1 : 0,
    });
});
exports.recordOpenToWorkProfileViewMetric = recordOpenToWorkProfileViewMetric;
const recordOpenToWorkInviteMetric = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield updateDailyMetrics({
        db: params.db,
        userId: params.userId,
        invitesToApplyIncrement: 1,
    });
});
exports.recordOpenToWorkInviteMetric = recordOpenToWorkInviteMetric;
const getOpenToWorkMetrics7d = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = (0, inputSanitizers_1.readString)(params.userId, 120);
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
    yield (0, exports.ensureOpenToWorkMetricsIndexes)(params.db);
    const startDate = buildUtcDayDate(new Date(now - ((OPEN_TO_WORK_METRICS_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000)));
    const rows = yield params.db.collection(OPEN_TO_WORK_DAILY_METRICS_COLLECTION)
        .find({
        userId,
        bucketDate: { $gte: startDate },
    }, {
        projection: {
            profileViewsCount: 1,
            companyViewsCount: 1,
            invitesToApplyCount: 1,
        },
    })
        .toArray();
    const metrics = rows.reduce((acc, row) => ({
        profileViews7d: acc.profileViews7d + (Number(row === null || row === void 0 ? void 0 : row.profileViewsCount) || 0),
        companyViews7d: acc.companyViews7d + (Number(row === null || row === void 0 ? void 0 : row.companyViewsCount) || 0),
        invitesToApply7d: acc.invitesToApply7d + (Number(row === null || row === void 0 ? void 0 : row.invitesToApplyCount) || 0),
    }), {
        profileViews7d: 0,
        companyViews7d: 0,
        invitesToApply7d: 0,
    });
    metricsCache.set(userId, {
        metrics,
        expiresAt: now + OPEN_TO_WORK_METRICS_CACHE_TTL_MS,
    });
    return metrics;
});
exports.getOpenToWorkMetrics7d = getOpenToWorkMetrics7d;
