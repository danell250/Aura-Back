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
exports.sendEveryOtherDayUserJobAlertDigests = void 0;
const crypto_1 = __importDefault(require("crypto"));
const jobAlertDigestJobsService_1 = require("./jobAlertDigestJobsService");
const jobAlertEmailService_1 = require("./jobAlertEmailService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const publicWebUrl_1 = require("../utils/publicWebUrl");
const recurringBatchUtils_1 = require("../utils/recurringBatchUtils");
const USERS_COLLECTION = 'users';
const APP_BASE_URL = (0, publicWebUrl_1.getPublicWebUrl)();
const JOB_ALERT_USER_DIGEST_INTERVAL_MS = Number.isFinite(Number(process.env.JOB_ALERT_USER_DIGEST_INTERVAL_HOURS))
    ? Math.max(24, Math.round(Number(process.env.JOB_ALERT_USER_DIGEST_INTERVAL_HOURS))) * 60 * 60 * 1000
    : 48 * 60 * 60 * 1000;
const JOB_ALERT_USER_BATCH_SIZE = Number.isFinite(Number(process.env.JOB_ALERT_USER_BATCH_SIZE))
    ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_USER_BATCH_SIZE)))
    : 16;
const JOB_ALERT_MAX_USERS_PER_RUN = Number.isFinite(Number(process.env.JOB_ALERT_MAX_USERS_PER_RUN))
    ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_MAX_USERS_PER_RUN)))
    : 150;
const JOB_ALERT_USER_SHARED_CANDIDATE_LIMIT = Number.isFinite(Number(process.env.JOB_ALERT_USER_SHARED_CANDIDATE_LIMIT))
    ? Math.min(420, Math.max(140, Math.round(Number(process.env.JOB_ALERT_USER_SHARED_CANDIDATE_LIMIT))))
    : 420;
const JOB_ALERT_USER_DIGEST_CACHE_LIMIT = Math.min(128, Math.max(80, Math.ceil(JOB_ALERT_MAX_USERS_PER_RUN * 0.67)));
const JOB_ALERT_USER_DIGEST_CACHE_MAX_BYTES = Number.isFinite(Number(process.env.JOB_ALERT_USER_DIGEST_CACHE_MAX_BYTES))
    ? Math.max(64 * 1024, Math.round(Number(process.env.JOB_ALERT_USER_DIGEST_CACHE_MAX_BYTES)))
    : 512 * 1024;
const JOB_ALERT_USER_DIGEST_CACHE_TTL_MS = Math.min(15 * 60 * 1000, JOB_ALERT_USER_DIGEST_INTERVAL_MS);
const JOB_ALERT_USER_DIGEST_WINDOW_BUFFER_MS = Number.isFinite(Number(process.env.JOB_ALERT_USER_DIGEST_WINDOW_BUFFER_HOURS))
    ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_USER_DIGEST_WINDOW_BUFFER_HOURS))) * 60 * 60 * 1000
    : 6 * 60 * 60 * 1000;
const JOB_ALERT_USER_GROUP_CONCURRENCY = Number.isFinite(Number(process.env.JOB_ALERT_USER_GROUP_CONCURRENCY))
    ? Math.max(1, Math.min(4, Math.round(Number(process.env.JOB_ALERT_USER_GROUP_CONCURRENCY))))
    : 2;
const getDefaultDigestWindowStartIso = () => new Date(Date.now() - JOB_ALERT_USER_DIGEST_INTERVAL_MS - JOB_ALERT_USER_DIGEST_WINDOW_BUFFER_MS).toISOString();
const normalizeUserDigestWindowStartIso = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return getDefaultDigestWindowStartIso();
    }
    return parsed.toISOString();
};
const hasUserJobDigestSignals = (user) => {
    if (Boolean(user === null || user === void 0 ? void 0 : user.openToWork))
        return true;
    if ((0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.title, 120))
        return true;
    if (Array.isArray(user === null || user === void 0 ? void 0 : user.skills) && user.skills.length > 0)
        return true;
    if (Array.isArray(user === null || user === void 0 ? void 0 : user.profileSkills) && user.profileSkills.length > 0)
        return true;
    if (Array.isArray(user === null || user === void 0 ? void 0 : user.preferredRoles) && user.preferredRoles.length > 0)
        return true;
    return false;
};
const buildDigestWindowStartIso = (lastDigestAtRaw) => {
    const configuredWindowStartIso = getDefaultDigestWindowStartIso();
    const configuredWindowStartTs = new Date(configuredWindowStartIso).getTime();
    const normalized = normalizeUserDigestWindowStartIso(lastDigestAtRaw || configuredWindowStartIso);
    return new Date(normalized).getTime() < configuredWindowStartTs
        ? configuredWindowStartIso
        : normalized;
};
const normalizeDigestCacheList = (values) => Array.from(new Set(values
    .map((value) => (0, inputSanitizers_1.readString)(value, 120).trim().toLowerCase())
    .filter(Boolean))).sort();
const DIGEST_CACHE_KEY_SEPARATOR = '\u001f';
const buildUserDigestCacheKey = (user, windowStartIso) => crypto_1.default.createHash('sha1').update([
    windowStartIso,
    (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.title, 160).trim().toLowerCase(),
    (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.location, 160).trim().toLowerCase(),
    (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.country, 120).trim().toLowerCase(),
    (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.industry, 160).trim().toLowerCase(),
    (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.remotePreference, 80).trim().toLowerCase(),
    (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.workPreference, 80).trim().toLowerCase(),
    (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.experienceLevel, 80).trim().toLowerCase(),
    (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.seniority, 80).trim().toLowerCase(),
    normalizeDigestCacheList(Array.isArray(user === null || user === void 0 ? void 0 : user.skills) ? user.skills : []).join(','),
    normalizeDigestCacheList(Array.isArray(user === null || user === void 0 ? void 0 : user.profileSkills) ? user.profileSkills : []).join(','),
    normalizeDigestCacheList(Array.isArray(user === null || user === void 0 ? void 0 : user.preferredRoles) ? user.preferredRoles : []).join(','),
    normalizeDigestCacheList(Array.isArray(user === null || user === void 0 ? void 0 : user.preferredLocations) ? user.preferredLocations : []).join(','),
    normalizeDigestCacheList(Array.isArray(user === null || user === void 0 ? void 0 : user.preferredWorkModels) ? user.preferredWorkModels : []).join(','),
].join(DIGEST_CACHE_KEY_SEPARATOR)).digest('hex');
const resolveUserDigestRecipientName = (user) => (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.firstName, 120) || (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.name, 160) || 'there';
const estimateDigestJobsCacheEntryBytes = (cacheKey, jobs) => (cacheKey.length * 2) + jobs.reduce((sum, job) => {
    var _a, _b, _c, _d;
    return sum
        + (((_a = job.title) === null || _a === void 0 ? void 0 : _a.length) || 0) * 2
        + (((_b = job.companyName) === null || _b === void 0 ? void 0 : _b.length) || 0) * 2
        + (((_c = job.locationText) === null || _c === void 0 ? void 0 : _c.length) || 0) * 2
        + (((_d = job.url) === null || _d === void 0 ? void 0 : _d.length) || 0) * 2
        + 64;
}, 0);
const getDigestJobsCacheSizeBytes = (cache) => Array.from(cache.values()).reduce((sum, entry) => sum + entry.approxBytes, 0);
const updateUserDigestTimestamp = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield params.db.collection(USERS_COLLECTION).updateOne({ id: params.userId }, {
        $set: {
            lastJobDigestAt: params.nowIso,
        },
    });
});
const setDigestJobsCacheEntry = (params) => {
    const nowMs = Date.now();
    for (const [entryKey, entry] of params.cache.entries()) {
        if (nowMs - entry.createdAtMs > JOB_ALERT_USER_DIGEST_CACHE_TTL_MS) {
            params.cache.delete(entryKey);
        }
    }
    if (params.cache.has(params.cacheKey)) {
        params.cache.delete(params.cacheKey);
    }
    const nextApproxBytes = estimateDigestJobsCacheEntryBytes(params.cacheKey, params.jobs);
    while (params.cache.size >= JOB_ALERT_USER_DIGEST_CACHE_LIMIT
        || (params.cache.size > 0 && getDigestJobsCacheSizeBytes(params.cache) + nextApproxBytes > JOB_ALERT_USER_DIGEST_CACHE_MAX_BYTES)) {
        const oldestKey = params.cache.keys().next().value;
        if (typeof oldestKey === 'string') {
            params.cache.delete(oldestKey);
            continue;
        }
        break;
    }
    params.cache.set(params.cacheKey, {
        jobs: params.jobs,
        createdAtMs: nowMs,
        approxBytes: nextApproxBytes,
    });
};
const resolveUserDigestJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const lastDigestAt = (0, inputSanitizers_1.readString)((_a = params.user) === null || _a === void 0 ? void 0 : _a.lastJobDigestAt, 80);
    const windowStartIso = buildDigestWindowStartIso(lastDigestAt);
    const cacheKey = buildUserDigestCacheKey(params.user, windowStartIso);
    const cachedEntry = params.digestJobsCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.createdAtMs <= JOB_ALERT_USER_DIGEST_CACHE_TTL_MS) {
        params.digestJobsCache.delete(cacheKey);
        params.digestJobsCache.set(cacheKey, cachedEntry);
        return {
            windowStartIso,
            jobs: cachedEntry.jobs,
        };
    }
    if (cachedEntry) {
        params.digestJobsCache.delete(cacheKey);
    }
    const recommendationProfile = (0, jobAlertDigestJobsService_1.buildUserDigestRecommendationProfile)(params.user);
    const jobs = yield (0, jobAlertDigestJobsService_1.buildUserDigestJobsForProfile)({
        db: params.db,
        recommendationProfile,
        windowStartIso,
        candidateIndex: params.candidateIndex,
    });
    setDigestJobsCacheEntry({
        cache: params.digestJobsCache,
        cacheKey,
        jobs,
    });
    return {
        windowStartIso,
        jobs,
    };
});
const listUsersDueForJobDigests = (params) => __awaiter(void 0, void 0, void 0, function* () {
    return params.db.collection(USERS_COLLECTION)
        .find({
        email: { $type: 'string', $ne: '' },
        $and: [
            {
                $or: [
                    { 'privacySettings.emailNotifications': { $exists: false } },
                    { 'privacySettings.emailNotifications': true },
                ],
            },
            {
                $or: [
                    { lastJobDigestAt: { $exists: false } },
                    { lastJobDigestAt: null },
                    { lastJobDigestAt: { $lt: params.cutoffIso } },
                ],
            },
        ],
    }, {
        projection: {
            id: 1,
            email: 1,
            firstName: 1,
            name: 1,
            handle: 1,
            title: 1,
            openToWork: 1,
            skills: 1,
            profileSkills: 1,
            preferredRoles: 1,
            preferredLocations: 1,
            preferredWorkModels: 1,
            location: 1,
            country: 1,
            remotePreference: 1,
            workPreference: 1,
            experienceLevel: 1,
            seniority: 1,
            jobSeniorityPreference: 1,
            yearsOfExperience: 1,
            experienceYears: 1,
            totalExperienceYears: 1,
            industry: 1,
            lastJobDigestAt: 1,
            privacySettings: 1,
        },
    })
        .limit(JOB_ALERT_MAX_USERS_PER_RUN)
        .toArray();
});
const groupUsersByDigestWindow = (users) => {
    const groups = new Map();
    users.forEach((user) => {
        const windowStartIso = buildDigestWindowStartIso((0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.lastJobDigestAt, 80));
        const bucket = groups.get(windowStartIso);
        if (bucket) {
            bucket.push(user);
            return;
        }
        groups.set(windowStartIso, [user]);
    });
    return Array.from(groups.entries()).map(([windowStartIso, groupedUsers]) => ({
        windowStartIso,
        users: groupedUsers,
    }));
};
const deliverEveryOtherDayUserDigest = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const { db, user, nowIso, candidateIndex, digestJobsCache } = params;
    if (!hasUserJobDigestSignals(user))
        return;
    const email = (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.email, 220).toLowerCase();
    if (!email)
        return;
    const { jobs } = yield resolveUserDigestJobs({
        db,
        user,
        candidateIndex,
        digestJobsCache,
    });
    if (jobs.length === 0)
        return;
    yield (0, jobAlertEmailService_1.sendJobAlertDigestEmail)(email, {
        recipientName: resolveUserDigestRecipientName(user),
        headline: 'New jobs for you on Aura',
        subheadline: 'Fresh roles discovered since your last Aura job alert.',
        jobs,
        ctaUrl: `${APP_BASE_URL}/jobs/recommended`,
        ctaLabel: 'Open my job board',
        manageUrl: `${APP_BASE_URL}/settings?tab=privacy`,
    });
    yield updateUserDigestTimestamp({
        db,
        userId: user.id,
        nowIso,
    });
});
const processEveryOtherDayUserDigestGroup = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, recurringBatchUtils_1.runSettledBatches)({
        items: params.group.users,
        batchSize: JOB_ALERT_USER_BATCH_SIZE,
        worker: (user) => deliverEveryOtherDayUserDigest({
            db: params.db,
            user,
            nowIso: params.nowIso,
            candidateIndex: params.sharedCandidateIndex,
            digestJobsCache: params.digestJobsCache,
        }),
        onRejected: (reason) => {
            console.error('User job digest dispatch error:', reason);
        },
    });
});
const sendEveryOtherDayUserJobAlertDigests = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const nowIso = new Date().toISOString();
    const cutoffIso = new Date(Date.now() - JOB_ALERT_USER_DIGEST_INTERVAL_MS).toISOString();
    const dueUsers = yield listUsersDueForJobDigests({
        db,
        cutoffIso,
    });
    if (dueUsers.length === 0)
        return;
    const groupedUsers = groupUsersByDigestWindow(dueUsers);
    const oldestWindowStartIso = groupedUsers.reduce((oldest, group) => {
        if (!oldest)
            return group.windowStartIso;
        return new Date(group.windowStartIso).getTime() < new Date(oldest).getTime() ? group.windowStartIso : oldest;
    }, '');
    const sharedCandidateJobs = yield (0, jobAlertDigestJobsService_1.listUserDigestCandidateJobs)({
        db,
        windowStartIso: oldestWindowStartIso || getDefaultDigestWindowStartIso(),
        limit: JOB_ALERT_USER_SHARED_CANDIDATE_LIMIT,
    });
    const sharedCandidateIndex = (0, jobAlertDigestJobsService_1.createUserDigestCandidateIndex)(sharedCandidateJobs);
    const digestJobsCache = new Map();
    yield (0, recurringBatchUtils_1.runSettledConcurrentChunks)({
        items: groupedUsers,
        concurrency: JOB_ALERT_USER_GROUP_CONCURRENCY,
        worker: (group) => processEveryOtherDayUserDigestGroup({
            db,
            group,
            nowIso,
            sharedCandidateIndex,
            digestJobsCache,
        }),
        onRejected: (reason) => {
            console.error('User job digest group error:', reason);
        },
    });
});
exports.sendEveryOtherDayUserJobAlertDigests = sendEveryOtherDayUserJobAlertDigests;
