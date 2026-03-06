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
exports.buildOpenToWorkProfileResponse = exports.computeOpenToWorkProfileCompleteness = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const openToWorkDemandService_1 = require("./openToWorkDemandService");
const openToWorkMetricsService_1 = require("./openToWorkMetricsService");
const REVERSE_MATCH_ALERTS_COLLECTION = 'job_reverse_match_alerts';
const OPEN_TO_WORK_MATCH_CACHE_TTL_MS = 10 * 60 * 1000;
const openToWorkJobSignalCache = new Map();
const normalizeArrayField = (value, maxItems, maxLength) => {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const next = [];
    for (const item of value) {
        const normalized = (0, inputSanitizers_1.readString)(item, maxLength);
        if (!normalized)
            continue;
        const key = normalized.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        next.push(normalized);
        if (next.length >= maxItems)
            break;
    }
    return next;
};
const sanitizePortfolioUrl = (value) => {
    const normalized = (0, inputSanitizers_1.readString)(value, 300);
    if (!normalized)
        return '';
    const prefixed = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
    return /^https?:\/\/.+/i.test(prefixed) ? prefixed : '';
};
const computeOpenToWorkProfileCompleteness = (user) => {
    const checks = [
        (0, inputSanitizers_1.readString)(user.title, 120).length > 0,
        (0, inputSanitizers_1.readString)(user.bio, 600).length > 0,
        (0, inputSanitizers_1.readString)(user.country, 120).length > 0,
        (0, inputSanitizers_1.readString)(user.availability, 120).length > 0,
        normalizeArrayField(user.preferredRoles, 6, 120).length > 0,
        normalizeArrayField(user.preferredLocations, 6, 120).length > 0,
        normalizeArrayField(user.preferredWorkModels, 4, 40).length > 0,
        (0, inputSanitizers_1.readString)(user.salaryExpectation, 120).length > 0,
        sanitizePortfolioUrl(user.portfolioUrl).length > 0,
        Boolean((0, inputSanitizers_1.readString)(user.resumeKey, 500) || (0, inputSanitizers_1.readString)(user.defaultResumeKey, 500)),
        normalizeArrayField(user.profileSkills, 10, 80).length > 0 || normalizeArrayField(user.skills, 10, 80).length > 0,
    ];
    const completed = checks.reduce((sum, check) => sum + (check ? 1 : 0), 0);
    return Math.round((completed / checks.length) * 100);
};
exports.computeOpenToWorkProfileCompleteness = computeOpenToWorkProfileCompleteness;
const buildJobSignalCacheKey = (user) => {
    const userId = (0, inputSanitizers_1.readString)(user.id, 120);
    const updatedAt = (0, inputSanitizers_1.readString)(user.updatedAt, 80) || (0, inputSanitizers_1.readString)(user.createdAt, 80);
    return `${userId}:${updatedAt}`;
};
const pruneOpenToWorkJobSignalCache = (now) => {
    for (const [key, entry] of openToWorkJobSignalCache.entries()) {
        if (entry.expiresAt <= now) {
            openToWorkJobSignalCache.delete(key);
        }
    }
    while (openToWorkJobSignalCache.size > 500) {
        const oldest = openToWorkJobSignalCache.keys().next();
        if (oldest.done)
            break;
        openToWorkJobSignalCache.delete(oldest.value);
    }
};
const buildOpenToWorkJobSignalSnapshot = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = (0, inputSanitizers_1.readString)(params.user.id, 120);
    if (!userId) {
        return { jobsMatchingNow: 0, demandSignals: [] };
    }
    const matchedJobs = yield params.db.collection(REVERSE_MATCH_ALERTS_COLLECTION)
        .find({ userId }, {
        projection: {
            title: 1,
            createdAt: 1,
            updatedAt: 1,
        },
        sort: {
            updatedAt: -1,
            createdAt: -1,
        },
        limit: 60,
    })
        .toArray();
    const signalJobs = matchedJobs.map((job) => ({
        title: (0, inputSanitizers_1.readString)(job.title, 140),
        discoveredAt: job.updatedAt,
        publishedAt: job.createdAt,
    }));
    return {
        jobsMatchingNow: signalJobs.length,
        demandSignals: (0, openToWorkDemandService_1.computeDemandSignals)(signalJobs),
    };
});
const getCachedOpenToWorkJobSignalSnapshot = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const cacheKey = buildJobSignalCacheKey(params.user);
    const now = Date.now();
    pruneOpenToWorkJobSignalCache(now);
    const cached = openToWorkJobSignalCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.snapshot;
    }
    const snapshot = yield buildOpenToWorkJobSignalSnapshot(params);
    openToWorkJobSignalCache.set(cacheKey, {
        snapshot,
        expiresAt: now + OPEN_TO_WORK_MATCH_CACHE_TTL_MS,
    });
    return snapshot;
});
const buildOpenToWorkProfileResponse = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const { db, user, isSelf } = params;
    const openToWork = user.openToWork === true;
    const topSkills = normalizeArrayField(Array.isArray(user.profileSkills) && user.profileSkills.length > 0
        ? user.profileSkills
        : user.skills, 8, 80);
    const resumeAvailable = Boolean((0, inputSanitizers_1.readString)(user.resumeKey, 500) || (0, inputSanitizers_1.readString)(user.defaultResumeKey, 500));
    const response = {
        openToWork,
        profileCompleteness: (0, exports.computeOpenToWorkProfileCompleteness)(user),
    };
    if (openToWork || isSelf) {
        response.availability = (0, inputSanitizers_1.readString)(user.availability, 120);
        response.preferredRoles = normalizeArrayField(user.preferredRoles, 6, 120);
        response.preferredLocations = normalizeArrayField(user.preferredLocations, 6, 120);
        response.preferredWorkModels = normalizeArrayField(user.preferredWorkModels, 4, 40);
        response.salaryExpectation = (0, inputSanitizers_1.readString)(user.salaryExpectation, 120);
        response.portfolioUrl = sanitizePortfolioUrl(user.portfolioUrl);
        response.resumeAvailable = resumeAvailable;
        response.topSkills = topSkills;
        const jobSignals = yield getCachedOpenToWorkJobSignalSnapshot({ db, user });
        response.jobsMatchingNow = jobSignals.jobsMatchingNow;
        response.demandSignals = jobSignals.demandSignals;
    }
    if (isSelf) {
        const metrics = yield (0, openToWorkMetricsService_1.getOpenToWorkMetrics7d)({
            db,
            userId: (0, inputSanitizers_1.readString)(user.id, 120),
        });
        response.profileViews7d = metrics.profileViews7d;
        response.companyViews7d = metrics.companyViews7d;
        response.invitesToApply7d = metrics.invitesToApply7d;
    }
    if (!openToWork && !isSelf) {
        return {
            openToWork: false,
            profileCompleteness: response.profileCompleteness,
        };
    }
    return response;
});
exports.buildOpenToWorkProfileResponse = buildOpenToWorkProfileResponse;
