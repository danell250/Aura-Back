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
exports.scheduleCompanyNetworkCountRefresh = exports.refreshCompanyNetworkCount = exports.countCompanyNetworkMembers = exports.readCachedCompanyNetworkCount = exports.MAX_NETWORK_COUNT_SCAN_IDS = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';
exports.MAX_NETWORK_COUNT_SCAN_IDS = 25;
const NETWORK_COUNT_CACHE_TTL_MS = 5 * 60000;
const NETWORK_COUNT_CACHE_MAX_KEYS = 500;
const networkCountCache = new Map();
const buildNetworkCountCacheKey = (companyId, viewerUserId) => `${companyId}:${viewerUserId}`;
const getCachedNetworkCount = (cacheKey) => {
    const cached = networkCountCache.get(cacheKey);
    if (!cached)
        return null;
    if (cached.expiresAt <= Date.now()) {
        networkCountCache.delete(cacheKey);
        return null;
    }
    return cached.count;
};
const readCachedCompanyNetworkCount = (params) => {
    const companyId = (0, inputSanitizers_1.readString)(params.companyId, 120);
    const viewerUserId = (0, inputSanitizers_1.readString)(params.viewerUserId, 120);
    if (!companyId || !viewerUserId) {
        return null;
    }
    return getCachedNetworkCount(buildNetworkCountCacheKey(companyId, viewerUserId));
};
exports.readCachedCompanyNetworkCount = readCachedCompanyNetworkCount;
const setCachedNetworkCount = (cacheKey, count) => {
    if (networkCountCache.size >= NETWORK_COUNT_CACHE_MAX_KEYS) {
        const oldestKey = networkCountCache.keys().next().value;
        if (oldestKey) {
            networkCountCache.delete(oldestKey);
        }
    }
    networkCountCache.set(cacheKey, {
        count,
        expiresAt: Date.now() + NETWORK_COUNT_CACHE_TTL_MS,
    });
};
const countCompanyNetworkMembers = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const boundedAcquaintanceIds = params.acquaintanceIds.slice(0, exports.MAX_NETWORK_COUNT_SCAN_IDS);
    const normalizedIds = Array.from(new Set(boundedAcquaintanceIds
        .map((value) => (0, inputSanitizers_1.readString)(value, 120))
        .filter((value) => value.length > 0)));
    if (!params.companyId || normalizedIds.length === 0) {
        return 0;
    }
    const cacheKey = buildNetworkCountCacheKey(params.companyId, params.viewerUserId);
    const cachedCount = getCachedNetworkCount(cacheKey);
    if (cachedCount != null) {
        return cachedCount;
    }
    const count = yield params.db.collection(COMPANY_MEMBERS_COLLECTION).countDocuments({
        companyId: params.companyId,
        userId: { $in: normalizedIds },
    }, {
        hint: { companyId: 1, userId: 1 },
    });
    setCachedNetworkCount(cacheKey, count);
    return count;
});
exports.countCompanyNetworkMembers = countCompanyNetworkMembers;
const refreshCompanyNetworkCount = (params) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const viewerUserId = (0, inputSanitizers_1.readString)(params.viewerUserId, 120);
        if (!viewerUserId) {
            return;
        }
        const currentUser = yield params.db.collection(USERS_COLLECTION).findOne({ id: viewerUserId }, { projection: { acquaintances: { $slice: exports.MAX_NETWORK_COUNT_SCAN_IDS } } });
        yield (0, exports.countCompanyNetworkMembers)({
            db: params.db,
            companyId: params.companyId,
            viewerUserId,
            acquaintanceIds: Array.isArray(currentUser === null || currentUser === void 0 ? void 0 : currentUser.acquaintances) ? currentUser.acquaintances : [],
        });
    }
    catch (error) {
        console.warn('Refresh company network count error:', error);
    }
});
exports.refreshCompanyNetworkCount = refreshCompanyNetworkCount;
const scheduleCompanyNetworkCountRefresh = (params) => {
    setTimeout(() => {
        void (0, exports.refreshCompanyNetworkCount)(params);
    }, 0);
};
exports.scheduleCompanyNetworkCountRefresh = scheduleCompanyNetworkCountRefresh;
