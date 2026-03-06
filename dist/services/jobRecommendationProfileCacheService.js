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
exports.resolveCachedRecommendationProfile = void 0;
const jobRecommendationService_1 = require("./jobRecommendationService");
const USERS_COLLECTION = 'users';
const JOB_RECOMMENDATION_PROFILE_CACHE_TTL_MS = 60000;
const JOB_RECOMMENDATION_PROFILE_CACHE_MAX_KEYS = 200;
const JOB_RECOMMENDATION_PROFILE_CACHE_CLEANUP_INTERVAL_MS = 60000;
const recommendationProfileCache = new Map();
const refreshRecommendationProfileCacheOrder = (currentUserId, entry) => {
    recommendationProfileCache.delete(currentUserId);
    recommendationProfileCache.set(currentUserId, entry);
};
const pruneRecommendationProfileCache = (now) => {
    for (const [cacheKey, entry] of recommendationProfileCache.entries()) {
        if (entry.expiresAt <= now) {
            recommendationProfileCache.delete(cacheKey);
        }
    }
    while (recommendationProfileCache.size > JOB_RECOMMENDATION_PROFILE_CACHE_MAX_KEYS) {
        const oldestEntry = recommendationProfileCache.keys().next();
        if (oldestEntry.done)
            break;
        recommendationProfileCache.delete(oldestEntry.value);
    }
};
(_b = (_a = setInterval(() => {
    pruneRecommendationProfileCache(Date.now());
}, JOB_RECOMMENDATION_PROFILE_CACHE_CLEANUP_INTERVAL_MS)).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
const resolveCachedRecommendationProfile = (db, currentUserId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!currentUserId)
        return null;
    const now = Date.now();
    const cached = recommendationProfileCache.get(currentUserId);
    if (cached && cached.expiresAt > now) {
        refreshRecommendationProfileCacheOrder(currentUserId, cached);
        return cached.profile;
    }
    pruneRecommendationProfileCache(now);
    const recommendationUser = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId }, {
        projection: {
            id: 1,
            title: 1,
            skills: 1,
            profileSkills: 1,
            location: 1,
            country: 1,
            industry: 1,
            remotePreference: 1,
            workPreference: 1,
            preferredWorkModel: 1,
            preferredWorkModels: 1,
            workPreferences: 1,
            experienceLevel: 1,
            seniority: 1,
            roleLevel: 1,
            jobSeniorityPreference: 1,
            yearsOfExperience: 1,
            experienceYears: 1,
            totalExperienceYears: 1,
        },
    });
    if (!recommendationUser) {
        recommendationProfileCache.delete(currentUserId);
        return null;
    }
    const recommendationProfile = (0, jobRecommendationService_1.buildRecommendationProfile)(recommendationUser);
    refreshRecommendationProfileCacheOrder(currentUserId, {
        profile: recommendationProfile,
        expiresAt: now + JOB_RECOMMENDATION_PROFILE_CACHE_TTL_MS,
    });
    pruneRecommendationProfileCache(now);
    return recommendationProfile;
});
exports.resolveCachedRecommendationProfile = resolveCachedRecommendationProfile;
