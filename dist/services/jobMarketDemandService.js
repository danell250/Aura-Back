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
exports.listJobMarketDemand = exports.clearJobMarketDemandCache = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobMarketDemandScoringService_1 = require("./jobMarketDemandScoringService");
const jobMarketDemandStorageService_1 = require("./jobMarketDemandStorageService");
const openToWorkDemandService_1 = require("./openToWorkDemandService");
const MARKET_DEMAND_CACHE_TTL_MS = 60000;
const MARKET_DEMAND_CACHE_MAX_KEYS = 100;
const marketDemandCache = new Map();
const pruneMarketDemandCache = (now) => {
    for (const [key, value] of marketDemandCache.entries()) {
        if (value.expiresAt <= now) {
            marketDemandCache.delete(key);
        }
    }
    while (marketDemandCache.size > MARKET_DEMAND_CACHE_MAX_KEYS) {
        const oldest = marketDemandCache.keys().next();
        if (oldest.done)
            break;
        marketDemandCache.delete(oldest.value);
    }
};
const normalizeRoleFilters = (roles) => {
    const seen = new Set();
    const normalized = [];
    for (const role of roles) {
        const mapped = (0, openToWorkDemandService_1.normalizeDemandRoleFamily)(role);
        if (!mapped || seen.has(mapped.roleFamily))
            continue;
        seen.add(mapped.roleFamily);
        normalized.push(mapped);
        if (normalized.length >= 10)
            break;
    }
    return normalized;
};
const touchMarketDemandCache = (cacheKey, entry) => {
    marketDemandCache.delete(cacheKey);
    marketDemandCache.set(cacheKey, entry);
};
const readCachedMarketDemand = (cacheKey) => {
    pruneMarketDemandCache(Date.now());
    const cached = marketDemandCache.get(cacheKey);
    if (!cached)
        return null;
    if (cached.expiresAt <= Date.now()) {
        marketDemandCache.delete(cacheKey);
        return null;
    }
    touchMarketDemandCache(cacheKey, cached);
    return cached.data;
};
const storeMarketDemandCache = (cacheKey, data) => {
    pruneMarketDemandCache(Date.now());
    marketDemandCache.set(cacheKey, {
        expiresAt: Date.now() + MARKET_DEMAND_CACHE_TTL_MS,
        data,
    });
    pruneMarketDemandCache(Date.now());
};
const clearJobMarketDemandCache = () => {
    marketDemandCache.clear();
};
exports.clearJobMarketDemandCache = clearJobMarketDemandCache;
const buildMarketDemandExecutionState = (params) => {
    var _a, _b, _c, _d;
    const location = (0, inputSanitizers_1.readString)((_a = params.query) === null || _a === void 0 ? void 0 : _a.location, 120);
    const normalizedWorkModelRaw = (0, inputSanitizers_1.readString)((_b = params.query) === null || _b === void 0 ? void 0 : _b.workModel, 20).toLowerCase();
    const workModel = jobMarketDemandStorageService_1.ALLOWED_WORK_MODELS.has(normalizedWorkModelRaw) ? normalizedWorkModelRaw : null;
    const limit = (0, inputSanitizers_1.parsePositiveInt)((_c = params.query) === null || _c === void 0 ? void 0 : _c.limit, 6, 1, 12);
    const normalizedRoleFilters = normalizeRoleFilters(Array.isArray((_d = params.query) === null || _d === void 0 ? void 0 : _d.roles) ? params.query.roles : []);
    const requestedRoleFamilies = new Set(normalizedRoleFilters.map((entry) => entry.roleFamily));
    const roleCacheKey = normalizedRoleFilters.map((entry) => entry.roleFamily).sort();
    const context = (0, jobMarketDemandStorageService_1.buildJobMarketDemandSnapshotContext)({ location, workModel });
    const todayBucket = (0, jobMarketDemandStorageService_1.toJobMarketDemandIsoDate)((0, jobMarketDemandStorageService_1.startOfJobMarketDemandUtcDay)(new Date()));
    const historicalBucket = (0, jobMarketDemandStorageService_1.toJobMarketDemandIsoDate)((0, jobMarketDemandStorageService_1.startOfJobMarketDemandUtcDay)(new Date(Date.now() - (jobMarketDemandStorageService_1.TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000))));
    return {
        location,
        workModel,
        limit,
        normalizedRoleFilters,
        requestedRoleFamilies,
        context,
        todayBucket,
        historicalBucket,
        cacheKey: JSON.stringify({
            location: context.locationKey,
            workModel: context.workModelKey,
            roles: roleCacheKey,
            limit,
            personalized: Boolean(params.personalized),
        }),
        personalized: Boolean(params.personalized),
    };
};
const buildMarketDemandResult = (params) => ({
    entries: (0, jobMarketDemandScoringService_1.buildJobMarketDemandEntries)({
        groups: params.groups,
        requestedRoleFamilies: params.state.requestedRoleFamilies,
        limit: params.state.limit,
        baselineSnapshots: params.baselineSnapshots,
    }),
    meta: {
        location: params.state.context.location,
        workModel: params.state.context.workModel,
        roles: params.state.normalizedRoleFilters.map((entry) => entry.label),
        trendWindowDays: jobMarketDemandStorageService_1.TREND_WINDOW_DAYS,
        salarySource: 'listed_job_salaries',
        snapshotDate: params.state.todayBucket,
        trendAvailable: params.baselineSnapshots !== null,
        personalized: params.state.personalized,
    },
});
const loadFreshMarketDemandResult = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const groups = (yield (0, jobMarketDemandStorageService_1.loadJobMarketDemandSnapshotGroups)({
        db: params.db,
        context: params.state.context,
        bucketDate: params.state.todayBucket,
    })) || new Map();
    const baselineSnapshots = yield (0, jobMarketDemandStorageService_1.loadJobMarketDemandBaselineSnapshots)({
        db: params.db,
        context: params.state.context,
        bucketDate: params.state.historicalBucket,
    });
    return buildMarketDemandResult({
        state: params.state,
        groups,
        baselineSnapshots,
    });
});
const listJobMarketDemand = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const state = buildMarketDemandExecutionState(params);
    const cached = readCachedMarketDemand(state.cacheKey);
    if (cached)
        return cached;
    const result = yield loadFreshMarketDemandResult({
        db: params.db,
        state,
    });
    storeMarketDemandCache(state.cacheKey, result);
    return result;
});
exports.listJobMarketDemand = listJobMarketDemand;
