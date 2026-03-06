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
exports.jobMatchShareController = void 0;
const db_1 = require("../db");
const jobResponseService_1 = require("../services/jobResponseService");
const reverseJobMatchService_1 = require("../services/reverseJobMatchService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const USERS_COLLECTION = 'users';
const AURA_PUBLIC_WEB_BASE_URL = ((0, inputSanitizers_1.readString)(process.env.AURA_PUBLIC_WEB_URL, 320)
    || (0, inputSanitizers_1.readString)(process.env.FRONTEND_URL, 320)
    || (0, inputSanitizers_1.readString)(process.env.VITE_FRONTEND_URL, 320)
    || 'https://aura.social').replace(/\/+$/, '');
const PUBLIC_MATCH_PROFILE_CACHE_TTL_MS = 5 * 60000;
const PUBLIC_MATCH_PROFILE_CACHE_MAX_KEYS = 500;
const publicMatchProfileCache = new Map();
const buildPublicMatchProfile = (user) => ({
    id: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.id, 120),
    handle: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.handle, 120),
    firstName: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.firstName, 120),
    name: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.name, 160),
    title: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.title, 160),
    skills: Array.isArray(user === null || user === void 0 ? void 0 : user.skills) ? user.skills.slice(0, 80) : [],
    profileSkills: Array.isArray(user === null || user === void 0 ? void 0 : user.profileSkills) ? user.profileSkills.slice(0, 80) : [],
    location: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.location, 160),
    country: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.country, 120),
    industry: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.industry, 120),
    remotePreference: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.remotePreference, 60),
    workPreference: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.workPreference, 60),
    preferredWorkModel: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.preferredWorkModel, 60),
    preferredWorkModels: Array.isArray(user === null || user === void 0 ? void 0 : user.preferredWorkModels) ? user.preferredWorkModels.slice(0, 8) : [],
    workPreferences: Array.isArray(user === null || user === void 0 ? void 0 : user.workPreferences) ? user.workPreferences.slice(0, 8) : [],
    experienceLevel: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.experienceLevel, 60),
    seniority: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.seniority, 60),
    roleLevel: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.roleLevel, 60),
    jobSeniorityPreference: (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.jobSeniorityPreference, 60),
    yearsOfExperience: Number.isFinite(Number(user === null || user === void 0 ? void 0 : user.yearsOfExperience)) ? Number(user.yearsOfExperience) : undefined,
    experienceYears: Number.isFinite(Number(user === null || user === void 0 ? void 0 : user.experienceYears)) ? Number(user.experienceYears) : undefined,
    totalExperienceYears: Number.isFinite(Number(user === null || user === void 0 ? void 0 : user.totalExperienceYears)) ? Number(user.totalExperienceYears) : undefined,
});
const prunePublicMatchProfileCache = (now) => {
    const expiredKeys = [];
    for (const [key, entry] of publicMatchProfileCache.entries()) {
        if (entry.expiresAt <= now) {
            expiredKeys.push(key);
        }
    }
    for (const key of expiredKeys) {
        publicMatchProfileCache.delete(key);
    }
    const overflowCount = publicMatchProfileCache.size - PUBLIC_MATCH_PROFILE_CACHE_MAX_KEYS;
    if (overflowCount <= 0) {
        return;
    }
    let trimmedCount = 0;
    while (trimmedCount < overflowCount) {
        const oldestKey = publicMatchProfileCache.keys().next().value;
        if (!oldestKey) {
            break;
        }
        publicMatchProfileCache.delete(oldestKey);
        trimmedCount += 1;
    }
};
const getCachedPublicMatchProfile = (user) => {
    const cacheUserId = (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.id, 120);
    const cacheUpdatedAt = (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.updatedAt, 80) || '0';
    const cacheKey = `${cacheUserId}:${cacheUpdatedAt}`;
    const now = Date.now();
    prunePublicMatchProfileCache(now);
    const cached = publicMatchProfileCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.profile;
    }
    const profile = buildPublicMatchProfile(user);
    if (cacheUserId) {
        publicMatchProfileCache.set(cacheKey, {
            expiresAt: now + PUBLIC_MATCH_PROFILE_CACHE_TTL_MS,
            profile,
        });
        prunePublicMatchProfileCache(now);
    }
    return profile;
};
exports.jobMatchShareController = {
    // GET /api/jobs/matches/:handle
    getPublicJobMatchesByHandle: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const rawHandle = (0, inputSanitizers_1.readString)(req.params.handle, 120).replace(/^@+/, '');
            if (!rawHandle) {
                return res.status(400).json({ success: false, error: 'Handle is required' });
            }
            const db = (0, db_1.getDB)();
            const requestedHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
            const sharedUser = yield db.collection(USERS_COLLECTION).findOne({
                handle: { $in: [rawHandle, requestedHandle] },
                jobMatchShareEnabled: true,
            }, {
                collation: { locale: 'en', strength: 2 },
                projection: {
                    id: 1,
                    handle: 1,
                    firstName: 1,
                    name: 1,
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
                    updatedAt: 1,
                },
            });
            if (!sharedUser) {
                return res.status(404).json({ success: false, error: 'User not found or public matches are disabled' });
            }
            const publicMatchProfile = getCachedPublicMatchProfile(sharedUser);
            if (!publicMatchProfile.id) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_a = req.query) === null || _a === void 0 ? void 0 : _a.limit, 20, 1, 40);
            const matchedJobs = yield (0, reverseJobMatchService_1.listTopJobMatchesForUser)({
                db,
                user: publicMatchProfile,
                limit,
                recordPulse: false,
            });
            const normalizedHandle = publicMatchProfile.handle || `@${rawHandle.toLowerCase()}`;
            const matchedJobsWithHeat = yield (0, jobResponseService_1.attachHeatFieldsToJobResponses)({
                db,
                jobs: matchedJobs.map((job) => (Object.assign(Object.assign({}, (0, jobResponseService_1.toJobResponse)(job)), { recommendationScore: Number.isFinite(job === null || job === void 0 ? void 0 : job.recommendationScore) && Number(job === null || job === void 0 ? void 0 : job.recommendationScore) > 0
                        ? Number(job.recommendationScore)
                        : 0, recommendationReasons: Array.isArray(job === null || job === void 0 ? void 0 : job.recommendationReasons)
                        ? job.recommendationReasons.slice(0, 3)
                        : [], matchedSkills: Array.isArray(job === null || job === void 0 ? void 0 : job.matchedSkills)
                        ? job.matchedSkills.slice(0, 5)
                        : [], recommendationBreakdown: (job === null || job === void 0 ? void 0 : job.recommendationBreakdown) && typeof (job === null || job === void 0 ? void 0 : job.recommendationBreakdown) === 'object'
                        ? job.recommendationBreakdown
                        : undefined, matchTier: (job === null || job === void 0 ? void 0 : job.matchTier) === 'best' || (job === null || job === void 0 ? void 0 : job.matchTier) === 'good' || (job === null || job === void 0 ? void 0 : job.matchTier) === 'other'
                        ? job.matchTier
                        : 'other' }))),
            });
            return res.json({
                success: true,
                data: matchedJobsWithHeat,
                meta: {
                    user: {
                        id: publicMatchProfile.id,
                        handle: normalizedHandle,
                        name: publicMatchProfile.name || publicMatchProfile.firstName || normalizedHandle,
                    },
                    shareUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs/${encodeURIComponent(normalizedHandle)}`,
                },
            });
        }
        catch (error) {
            console.error('Get public job matches by handle error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch public job matches' });
        }
    }),
};
