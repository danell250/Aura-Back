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
exports.listTopJobMatchesForUser = exports.processReverseJobMatchesForIngestedPayload = exports.ensureReverseMatchIndexes = void 0;
const crypto_1 = require("crypto");
const notificationsController_1 = require("../controllers/notificationsController");
const jobRecommendationService_1 = require("./jobRecommendationService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const USERS_COLLECTION = 'users';
const JOBS_COLLECTION = 'jobs';
const REVERSE_MATCH_ALERTS_COLLECTION = 'job_reverse_match_alerts';
const REVERSE_MATCH_MIN_SCORE = Number.isFinite(Number(process.env.REVERSE_MATCH_MIN_SCORE))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_MIN_SCORE)))
    : 70;
const REVERSE_MATCH_MAX_USER_SCAN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_USER_SCAN))
    ? Math.max(100, Math.round(Number(process.env.REVERSE_MATCH_MAX_USER_SCAN)))
    : 3000;
const REVERSE_MATCH_MAX_JOBS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_JOBS_PER_RUN))
    ? Math.max(20, Math.round(Number(process.env.REVERSE_MATCH_MAX_JOBS_PER_RUN)))
    : 400;
const REVERSE_MATCH_MAX_OPS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_OPS_PER_RUN))
    ? Math.max(200, Math.round(Number(process.env.REVERSE_MATCH_MAX_OPS_PER_RUN)))
    : 25000;
const REVERSE_MATCH_MAX_CANDIDATES_PER_JOB = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_CANDIDATES_PER_JOB))
    ? Math.max(60, Math.round(Number(process.env.REVERSE_MATCH_MAX_CANDIDATES_PER_JOB)))
    : 180;
const REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB = Number.isFinite(Number(process.env.REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB))
    ? Math.max(20, Math.round(Number(process.env.REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB)))
    : 80;
const REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN))
    ? Math.max(2000, Math.round(Number(process.env.REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN)))
    : 18000;
const REVERSE_MATCH_NOTIFICATION_TOP_JOBS = Number.isFinite(Number(process.env.REVERSE_MATCH_NOTIFICATION_TOP_JOBS))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_NOTIFICATION_TOP_JOBS)))
    : 5;
const REVERSE_MATCH_NOTIFICATION_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_NOTIFICATION_BATCH_SIZE))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_NOTIFICATION_BATCH_SIZE)))
    : 25;
const REVERSE_MATCH_SCORE_YIELD_EVERY = Number.isFinite(Number(process.env.REVERSE_MATCH_SCORE_YIELD_EVERY))
    ? Math.max(20, Math.round(Number(process.env.REVERSE_MATCH_SCORE_YIELD_EVERY)))
    : 120;
const REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS))
    ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS)))
    : 5 * 60 * 1000;
const REVERSE_MATCH_INDEX_CACHE_TTL_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_INDEX_CACHE_TTL_MS))
    ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_INDEX_CACHE_TTL_MS)))
    : 2 * 60 * 1000;
const REVERSE_MATCH_USER_CONTEXT_CACHE_TTL_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_USER_CONTEXT_CACHE_TTL_MS))
    ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_USER_CONTEXT_CACHE_TTL_MS)))
    : 10 * 60 * 1000;
const DEFAULT_MATCH_CANDIDATE_LIMIT = 180;
const DEFAULT_PUBLIC_MATCH_LIMIT = 20;
let reverseMatchIndexesPromise = null;
let reverseMatchIndexesLastFailureAtMs = 0;
let reverseMatchIndexesEnsured = false;
let reverseMatchUserScanIndexesPromise = null;
let reverseMatchUserScanIndexesLastFailureAtMs = 0;
let reverseMatchUserScanIndexesEnsured = false;
let matchIndexBundleCache = null;
let candidateUserContextCache = null;
const normalizeSkillToken = (value) => (0, inputSanitizers_1.readString)(String(value || ''), 120)
    .toLowerCase()
    .replace(/[^a-z0-9+.#\-/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const uniqueStrings = (items, max = 40) => {
    const dedupe = new Set();
    const next = [];
    for (const item of items) {
        const normalized = normalizeSkillToken(item);
        if (!normalized || dedupe.has(normalized))
            continue;
        dedupe.add(normalized);
        next.push(normalized);
        if (next.length >= max)
            break;
    }
    return next;
};
const normalizeWorkModelToken = (value) => {
    const normalized = (0, inputSanitizers_1.readString)(String(value !== null && value !== void 0 ? value : ''), 40).toLowerCase();
    if (normalized === 'remote')
        return 'remote';
    if (normalized === 'hybrid')
        return 'hybrid';
    if (normalized === 'onsite' || normalized === 'on_site' || normalized === 'on-site')
        return 'onsite';
    return '';
};
const hasIntersection = (left, rightTokens) => {
    if (left.size === 0 || rightTokens.length === 0)
        return false;
    for (const token of rightTokens) {
        if (left.has(token))
            return true;
    }
    return false;
};
const appendIndexedContextEntries = (index, tokens, ctxIndex) => {
    for (const token of tokens) {
        const normalized = normalizeSkillToken(token);
        if (!normalized)
            continue;
        const bucket = index.get(normalized);
        if (bucket) {
            bucket.push(ctxIndex);
            continue;
        }
        index.set(normalized, [ctxIndex]);
    }
};
const collectIndexedCandidates = (index, tokens, target) => {
    for (const token of tokens) {
        const normalized = normalizeSkillToken(token);
        if (!normalized)
            continue;
        const indexes = index.get(normalized);
        if (!indexes)
            continue;
        indexes.forEach((ctxIndex) => target.add(ctxIndex));
    }
};
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));
const runTasksInBatches = (tasks, batchSize) => __awaiter(void 0, void 0, void 0, function* () {
    for (let index = 0; index < tasks.length; index += batchSize) {
        const batch = tasks.slice(index, index + batchSize);
        yield Promise.allSettled(batch.map((task) => task()));
        yield yieldToEventLoop();
    }
});
const normalizeExternalUrl = (value) => {
    const raw = (0, inputSanitizers_1.readString)(String(value || ''), 700);
    if (!raw)
        return '';
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const parsed = new URL(withProtocol);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return '';
        return parsed.toString();
    }
    catch (_a) {
        return '';
    }
};
const buildIngestFilterKey = (source, originalId, originalUrl) => {
    if (source && originalId)
        return `s:${source}|i:${originalId}`;
    if (source && originalUrl)
        return `s:${source}|u:${originalUrl}`;
    return '';
};
const resolveIngestedOpenJobsFromPayload = (db, rawJobs) => __awaiter(void 0, void 0, void 0, function* () {
    const filters = [];
    const dedupe = new Set();
    for (const raw of rawJobs) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            continue;
        const payload = raw;
        const source = (0, inputSanitizers_1.readString)(payload.source, 80).toLowerCase();
        const originalId = (0, inputSanitizers_1.readString)(payload.originalId, 240);
        const originalUrl = normalizeExternalUrl(payload.originalUrl);
        const key = buildIngestFilterKey(source, originalId, originalUrl);
        if (!key || dedupe.has(key))
            continue;
        dedupe.add(key);
        if (source && originalId) {
            filters.push({ source, originalId });
            continue;
        }
        if (source && originalUrl) {
            filters.push({ source, originalUrl });
        }
    }
    if (filters.length === 0)
        return [];
    return db.collection(JOBS_COLLECTION)
        .find({
        status: 'open',
        $or: filters,
    }, {
        projection: {
            id: 1,
            slug: 1,
            source: 1,
            originalId: 1,
            originalUrl: 1,
            title: 1,
            companyName: 1,
            summary: 1,
            description: 1,
            locationText: 1,
            workModel: 1,
            salaryMin: 1,
            salaryMax: 1,
            tags: 1,
            publishedAt: 1,
            createdAt: 1,
            recommendationSkillLabelByToken: 1,
            recommendationLocationTokens: 1,
            recommendationSemanticTokens: 1,
            recommendationPublishedTs: 1,
            recommendationHasSalarySignal: 1,
            recommendationIsRemoteRole: 1,
        },
    })
        .sort({ publishedAt: -1, createdAt: -1 })
        .limit(REVERSE_MATCH_MAX_JOBS_PER_RUN)
        .toArray();
});
const ensureReverseMatchIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (reverseMatchIndexesEnsured)
        return;
    if (reverseMatchIndexesPromise)
        return reverseMatchIndexesPromise;
    if (reverseMatchIndexesLastFailureAtMs > 0
        && (Date.now() - reverseMatchIndexesLastFailureAtMs) < REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS) {
        return;
    }
    reverseMatchIndexesPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield Promise.all([
                db.collection(REVERSE_MATCH_ALERTS_COLLECTION).createIndex({ id: 1 }, { name: 'reverse_match_alert_id_unique', unique: true }),
                db.collection(REVERSE_MATCH_ALERTS_COLLECTION).createIndex({ userId: 1, createdAt: -1 }, { name: 'reverse_match_alert_user_created_idx' }),
                db.collection(REVERSE_MATCH_ALERTS_COLLECTION).createIndex({ emailDigestSentAt: 1, createdAt: -1 }, { name: 'reverse_match_alert_digest_idx' }),
            ]);
            reverseMatchIndexesEnsured = true;
            reverseMatchIndexesLastFailureAtMs = 0;
        }
        catch (error) {
            reverseMatchIndexesLastFailureAtMs = Date.now();
            reverseMatchIndexesPromise = null;
            throw error;
        }
    }))();
    return reverseMatchIndexesPromise;
});
exports.ensureReverseMatchIndexes = ensureReverseMatchIndexes;
const ensureReverseMatchUserScanIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (reverseMatchUserScanIndexesEnsured)
        return;
    if (reverseMatchUserScanIndexesPromise)
        return reverseMatchUserScanIndexesPromise;
    if (reverseMatchUserScanIndexesLastFailureAtMs > 0
        && (Date.now() - reverseMatchUserScanIndexesLastFailureAtMs) < REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS) {
        return;
    }
    reverseMatchUserScanIndexesPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield db.collection(USERS_COLLECTION).createIndex({ reverseJobMatchEnabled: 1, updatedAt: -1 }, {
                name: 'reverse_match_user_scan_idx',
                partialFilterExpression: {
                    reverseJobMatchEnabled: { $ne: false },
                },
            });
            reverseMatchUserScanIndexesEnsured = true;
            reverseMatchUserScanIndexesLastFailureAtMs = 0;
        }
        catch (error) {
            const message = String((error === null || error === void 0 ? void 0 : error.message) || '').toLowerCase();
            if (message.includes('already exists')
                || message.includes('index with name')
                || message.includes('equivalent index already exists')) {
                reverseMatchUserScanIndexesEnsured = true;
                reverseMatchUserScanIndexesLastFailureAtMs = 0;
                return;
            }
            reverseMatchUserScanIndexesLastFailureAtMs = Date.now();
            throw error;
        }
        finally {
            reverseMatchUserScanIndexesPromise = null;
        }
    }))();
    return reverseMatchUserScanIndexesPromise;
});
const resolveCandidateUsersForReverseMatch = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (candidateUserContextCache && candidateUserContextCache.expiresAt > Date.now()) {
        return candidateUserContextCache.contexts;
    }
    try {
        yield ensureReverseMatchUserScanIndexes(db);
    }
    catch (error) {
        console.warn('Reverse match user scan index ensure error:', error);
    }
    const users = yield db.collection(USERS_COLLECTION).find({
        reverseJobMatchEnabled: { $ne: false },
        $or: [
            { skills: { $exists: true, $ne: [] } },
            { profileSkills: { $exists: true, $ne: [] } },
            { location: { $exists: true, $ne: '' } },
            { industry: { $exists: true, $ne: '' } },
            { preferredWorkModel: { $exists: true, $ne: '' } },
        ],
    }, {
        projection: {
            id: 1,
            handle: 1,
            name: 1,
            firstName: 1,
            email: 1,
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
            jobMatchShareEnabled: 1,
            lastReverseJobDigestAt: 1,
        },
    }).limit(REVERSE_MATCH_MAX_USER_SCAN).toArray();
    const contexts = [];
    for (const user of users) {
        const userId = (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.id, 120);
        if (!userId)
            continue;
        const profile = (0, jobRecommendationService_1.buildRecommendationProfile)(user);
        const hasSignal = (profile.skillTokens.size > 0
            || profile.locationTokens.size > 0
            || profile.industryTokens.size > 0
            || profile.preferredWorkModels.size > 0
            || profile.experienceLevel !== null);
        if (!hasSignal)
            continue;
        contexts.push({
            user,
            userId,
            profile,
            skillTokens: profile.skillTokens,
            locationTokens: profile.locationTokens,
            industryTokens: profile.industryTokens,
            preferredWorkModels: new Set(Array.from(profile.preferredWorkModels.values())),
        });
    }
    candidateUserContextCache = {
        expiresAt: Date.now() + REVERSE_MATCH_USER_CONTEXT_CACHE_TTL_MS,
        contexts,
    };
    return contexts;
});
const extractJobSkillTokens = (job) => {
    const tokenSources = [];
    if ((job === null || job === void 0 ? void 0 : job.recommendationSkillLabelByToken) && typeof job.recommendationSkillLabelByToken === 'object') {
        tokenSources.push(...Object.keys(job.recommendationSkillLabelByToken));
    }
    if (Array.isArray(job === null || job === void 0 ? void 0 : job.tags)) {
        tokenSources.push(...job.tags);
    }
    return uniqueStrings(tokenSources, 50);
};
const extractJobLocationTokens = (job) => {
    const tokenSources = [];
    if (Array.isArray(job === null || job === void 0 ? void 0 : job.recommendationLocationTokens)) {
        tokenSources.push(...job.recommendationLocationTokens);
    }
    tokenSources.push(...(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.locationText, 220).split(/\s+/g));
    return uniqueStrings(tokenSources, 30);
};
const extractJobSemanticTokens = (job) => {
    const tokenSources = [];
    if (Array.isArray(job === null || job === void 0 ? void 0 : job.recommendationSemanticTokens)) {
        tokenSources.push(...job.recommendationSemanticTokens);
    }
    const titleTokens = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 140).split(/\s+/g);
    const summaryTokens = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.summary, 260).split(/\s+/g);
    tokenSources.push(...titleTokens, ...summaryTokens);
    return uniqueStrings(tokenSources, 120);
};
const buildJobSignalBundle = (job) => {
    const skillTokens = extractJobSkillTokens(job);
    const locationTokens = extractJobLocationTokens(job);
    const semanticTokens = extractJobSemanticTokens(job);
    const explicitWorkModel = normalizeWorkModelToken(job === null || job === void 0 ? void 0 : job.workModel);
    const remoteHintText = [
        (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.locationText, 220),
        (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 140),
        (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.summary, 260),
    ].join(' ').toLowerCase();
    const hasRemoteHint = /\b(remote|work from home|wfh|anywhere|distributed)\b/.test(remoteHintText);
    const isRemoteRole = typeof (job === null || job === void 0 ? void 0 : job.recommendationIsRemoteRole) === 'boolean'
        ? Boolean(job.recommendationIsRemoteRole)
        : (explicitWorkModel === 'remote' || hasRemoteHint);
    const workModel = explicitWorkModel || (isRemoteRole ? 'remote' : '');
    return {
        skillTokens,
        locationTokens,
        semanticTokens,
        workModel,
        isRemoteRole,
        hasSignals: skillTokens.length > 0
            || locationTokens.length > 0
            || semanticTokens.length > 0
            || Boolean(workModel)
            || isRemoteRole,
    };
};
const buildMatchIndexBundle = (contexts) => {
    const bySkillToken = new Map();
    const byLocationToken = new Map();
    const byIndustryToken = new Map();
    const byWorkModel = new Map();
    contexts.forEach((context, ctxIndex) => {
        appendIndexedContextEntries(bySkillToken, context.skillTokens, ctxIndex);
        appendIndexedContextEntries(byLocationToken, context.locationTokens, ctxIndex);
        appendIndexedContextEntries(byIndustryToken, context.industryTokens, ctxIndex);
        appendIndexedContextEntries(byWorkModel, context.preferredWorkModels, ctxIndex);
    });
    return {
        allIndexes: contexts.map((_, index) => index),
        bySkillToken,
        byLocationToken,
        byIndustryToken,
        byWorkModel,
    };
};
const buildMatchIndexCacheKey = (contexts) => {
    var _a, _b, _c;
    const total = contexts.length;
    if (total === 0)
        return '0';
    const first = (0, inputSanitizers_1.readString)((_a = contexts[0]) === null || _a === void 0 ? void 0 : _a.userId, 120);
    const middle = (0, inputSanitizers_1.readString)((_b = contexts[Math.floor(total / 2)]) === null || _b === void 0 ? void 0 : _b.userId, 120);
    const last = (0, inputSanitizers_1.readString)((_c = contexts[total - 1]) === null || _c === void 0 ? void 0 : _c.userId, 120);
    return `${total}:${first}:${middle}:${last}`;
};
const resolveMatchIndexBundle = (contexts) => {
    const nowMs = Date.now();
    const cacheKey = buildMatchIndexCacheKey(contexts);
    if (matchIndexBundleCache
        && matchIndexBundleCache.key === cacheKey
        && matchIndexBundleCache.expiresAt > nowMs) {
        return matchIndexBundleCache.bundle;
    }
    const bundle = buildMatchIndexBundle(contexts);
    matchIndexBundleCache = {
        key: cacheKey,
        expiresAt: nowMs + REVERSE_MATCH_INDEX_CACHE_TTL_MS,
        bundle,
    };
    return bundle;
};
const resolveCandidateContextIndexesForJob = (indexBundle, jobSignals) => {
    const prioritized = new Set();
    const secondary = new Set();
    collectIndexedCandidates(indexBundle.bySkillToken, jobSignals.skillTokens, prioritized);
    collectIndexedCandidates(indexBundle.byLocationToken, jobSignals.locationTokens, secondary);
    collectIndexedCandidates(indexBundle.byIndustryToken, jobSignals.semanticTokens, secondary);
    const workModelTokens = [];
    if (jobSignals.workModel)
        workModelTokens.push(jobSignals.workModel);
    if (jobSignals.isRemoteRole)
        workModelTokens.push('remote');
    collectIndexedCandidates(indexBundle.byWorkModel, workModelTokens, secondary);
    const candidateOrder = [];
    prioritized.forEach((ctxIndex) => {
        candidateOrder.push(ctxIndex);
    });
    secondary.forEach((ctxIndex) => {
        if (!prioritized.has(ctxIndex)) {
            candidateOrder.push(ctxIndex);
        }
    });
    if (candidateOrder.length === 0) {
        const fallbackPool = jobSignals.hasSignals
            ? indexBundle.allIndexes.slice(0, REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB)
            : indexBundle.allIndexes;
        for (const ctxIndex of fallbackPool) {
            candidateOrder.push(ctxIndex);
            if (candidateOrder.length >= REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB)
                break;
        }
    }
    if (candidateOrder.length > REVERSE_MATCH_MAX_CANDIDATES_PER_JOB) {
        return candidateOrder.slice(0, REVERSE_MATCH_MAX_CANDIDATES_PER_JOB);
    }
    return candidateOrder;
};
const buildReverseMatchAlertId = (userId, jobId) => (0, crypto_1.createHash)('sha256').update(`${userId}:${jobId}`).digest('hex');
const passesReverseMatchCoarseFilter = (context, jobSignals) => {
    const userHasWorkPreference = context.preferredWorkModels.size > 0;
    const hasWorkModelMatch = !userHasWorkPreference
        || (jobSignals.workModel ? context.preferredWorkModels.has(jobSignals.workModel) : false)
        || (jobSignals.isRemoteRole && context.preferredWorkModels.has('remote'));
    if (!hasWorkModelMatch)
        return false;
    const hasSkillMatch = hasIntersection(context.skillTokens, jobSignals.skillTokens);
    const hasLocationMatch = hasIntersection(context.locationTokens, jobSignals.locationTokens);
    const hasIndustryMatch = hasIntersection(context.industryTokens, jobSignals.semanticTokens);
    if (hasSkillMatch || hasLocationMatch || hasIndustryMatch)
        return true;
    if (!jobSignals.hasSignals)
        return true;
    const userHasSignal = context.skillTokens.size > 0
        || context.locationTokens.size > 0
        || context.industryTokens.size > 0
        || context.preferredWorkModels.size > 0;
    if (!userHasSignal)
        return true;
    if (userHasWorkPreference && hasWorkModelMatch)
        return true;
    return false;
};
const buildReverseMatchRecord = (context, job, roundedScore, reasons, matchedSkills) => {
    const jobId = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120);
    return {
        alertId: buildReverseMatchAlertId(context.userId, jobId),
        userId: context.userId,
        jobId,
        jobSlug: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.slug, 220),
        title: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 140),
        companyName: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.companyName, 160),
        locationText: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.locationText, 180),
        score: roundedScore,
        reasons: reasons.slice(0, 4),
        matchedSkills: matchedSkills.slice(0, 6),
    };
};
const toReverseMatchUpsertOperation = (record, nowIso) => ({
    updateOne: {
        filter: { id: record.alertId },
        update: {
            $set: {
                score: record.score,
                reasons: record.reasons,
                matchedSkills: record.matchedSkills,
                updatedAt: nowIso,
            },
            $setOnInsert: {
                id: record.alertId,
                userId: record.userId,
                jobId: record.jobId,
                jobSlug: record.jobSlug,
                title: record.title,
                companyName: record.companyName,
                locationText: record.locationText,
                score: record.score,
                reasons: record.reasons,
                matchedSkills: record.matchedSkills,
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        },
        upsert: true,
    },
});
const toNotificationEntry = (record) => ({
    userId: record.userId,
    jobId: record.jobId,
    jobSlug: record.jobSlug,
    title: record.title,
    companyName: record.companyName,
    score: record.score,
    reasons: record.reasons,
    matchedSkills: record.matchedSkills,
});
const resolvePerJobEvaluationCap = (remainingEvalBudget, jobsRemaining) => Math.max(40, Math.min(REVERSE_MATCH_MAX_CANDIDATES_PER_JOB, Math.floor(remainingEvalBudget / Math.max(1, jobsRemaining))));
const collectScoredRecordsForJob = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const records = [];
    let evaluatedForJob = 0;
    let evaluationsUsed = 0;
    for (const ctxIndex of params.candidateContextIndexes) {
        if (evaluatedForJob >= params.perJobEvaluationCap || evaluationsUsed >= params.remainingGlobalBudget) {
            break;
        }
        const context = params.contexts[ctxIndex];
        if (!context)
            continue;
        if (!passesReverseMatchCoarseFilter(context, params.jobSignals))
            continue;
        evaluatedForJob += 1;
        evaluationsUsed += 1;
        const scoreResult = (0, jobRecommendationService_1.buildJobRecommendationScore)(params.job, context.profile);
        if (evaluationsUsed % REVERSE_MATCH_SCORE_YIELD_EVERY === 0) {
            yield yieldToEventLoop();
        }
        const roundedScore = Math.max(0, Math.round(scoreResult.score));
        if (roundedScore < REVERSE_MATCH_MIN_SCORE)
            continue;
        records.push(buildReverseMatchRecord(context, params.job, roundedScore, scoreResult.reasons, scoreResult.matchedSkills));
    }
    return { records, evaluationsUsed };
});
const collectJobMatchRecords = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const jobId = (0, inputSanitizers_1.readString)((_a = params.job) === null || _a === void 0 ? void 0 : _a.id, 120);
    if (!jobId || params.remainingEvalBudget <= 0) {
        return { records: [], evaluationsUsed: 0 };
    }
    const jobSignals = buildJobSignalBundle(params.job);
    const candidateContextIndexes = resolveCandidateContextIndexesForJob(params.indexBundle, jobSignals);
    if (candidateContextIndexes.length === 0) {
        return { records: [], evaluationsUsed: 0 };
    }
    const perJobEvaluationCap = resolvePerJobEvaluationCap(params.remainingEvalBudget, params.totalJobs - params.jobIndex);
    return collectScoredRecordsForJob({
        job: params.job,
        jobSignals,
        candidateContextIndexes,
        contexts: params.contexts,
        perJobEvaluationCap,
        remainingGlobalBudget: params.remainingEvalBudget,
    });
});
const collectReverseMatchOperations = (jobs, contexts, nowIso) => __awaiter(void 0, void 0, void 0, function* () {
    const operations = [];
    const records = [];
    const indexBundle = resolveMatchIndexBundle(contexts);
    let scoreEvaluations = 0;
    for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
        const job = jobs[jobIndex];
        if (operations.length >= REVERSE_MATCH_MAX_OPS_PER_RUN)
            break;
        const remainingEvalBudget = REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN - scoreEvaluations;
        if (remainingEvalBudget <= 0)
            break;
        const { records: scoredRecords, evaluationsUsed } = yield collectJobMatchRecords({
            job,
            jobIndex,
            totalJobs: jobs.length,
            contexts,
            indexBundle,
            remainingEvalBudget,
        });
        scoreEvaluations += evaluationsUsed;
        if (scoredRecords.length === 0)
            continue;
        for (const record of scoredRecords) {
            if (operations.length >= REVERSE_MATCH_MAX_OPS_PER_RUN)
                break;
            operations.push(toReverseMatchUpsertOperation(record, nowIso));
            records.push(record);
        }
    }
    return { operations, records };
});
const resolveExistingAlertIds = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const alertIds = Array.from(new Set(params.records
        .map((record) => (0, inputSanitizers_1.readString)(record.alertId, 160))
        .filter((id) => id.length > 0))).slice(0, REVERSE_MATCH_MAX_OPS_PER_RUN);
    if (alertIds.length === 0)
        return new Set();
    const existing = yield params.db.collection(REVERSE_MATCH_ALERTS_COLLECTION)
        .find({ id: { $in: alertIds } }, { projection: { id: 1 } })
        .toArray();
    return new Set(existing
        .map((entry) => (0, inputSanitizers_1.readString)(entry === null || entry === void 0 ? void 0 : entry.id, 160))
        .filter((id) => id.length > 0));
});
const dispatchReverseMatchNotifications = (groupedByUser) => __awaiter(void 0, void 0, void 0, function* () {
    const tasks = [];
    for (const [userId, entries] of groupedByUser.entries()) {
        if (entries.length === 0)
            continue;
        tasks.push(() => __awaiter(void 0, void 0, void 0, function* () {
            const sortedEntries = [...entries].sort((left, right) => right.score - left.score);
            const topEntries = sortedEntries.slice(0, REVERSE_MATCH_NOTIFICATION_TOP_JOBS);
            const matchCount = entries.length;
            const message = `🔥 ${matchCount} new job${matchCount === 1 ? '' : 's'} match your profile`;
            const meta = {
                category: 'reverse_job_match',
                matchCount,
                jobs: topEntries.map((entry) => ({
                    jobId: entry.jobId,
                    slug: entry.jobSlug,
                    title: entry.title,
                    companyName: entry.companyName,
                    score: entry.score,
                    matchTier: (0, jobRecommendationService_1.resolveRecommendationMatchTier)(entry.score),
                    reasons: entry.reasons,
                    matchedSkills: entry.matchedSkills,
                })),
            };
            try {
                yield (0, notificationsController_1.createNotificationInDB)(userId, 'job_match_alert', 'system', message, undefined, undefined, meta, undefined, 'user');
            }
            catch (error) {
                console.error('Reverse match notification dispatch error:', error);
            }
        }));
    }
    if (tasks.length === 0)
        return;
    yield runTasksInBatches(tasks, REVERSE_MATCH_NOTIFICATION_BATCH_SIZE);
});
const persistReverseMatchOperations = (params) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield params.db.collection(REVERSE_MATCH_ALERTS_COLLECTION).bulkWrite(params.operations, { ordered: false });
        return true;
    }
    catch (bulkError) {
        console.error('Reverse match bulk write error:', bulkError);
        return false;
    }
});
const groupNotificationEntriesByUser = (entries) => {
    const groupedByUser = new Map();
    entries.forEach((entry) => {
        if (!entry.userId)
            return;
        const bucket = groupedByUser.get(entry.userId) || [];
        bucket.push(entry);
        groupedByUser.set(entry.userId, bucket);
    });
    return groupedByUser;
};
const processReverseJobMatchesForIngestedPayload = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (!params.db || !Array.isArray(params.rawJobs) || params.rawJobs.length === 0)
        return;
    try {
        yield (0, exports.ensureReverseMatchIndexes)(params.db);
    }
    catch (error) {
        console.error('Reverse match index ensure error:', error);
        return;
    }
    const [jobs, userContexts] = yield Promise.all([
        resolveIngestedOpenJobsFromPayload(params.db, params.rawJobs),
        resolveCandidateUsersForReverseMatch(params.db),
    ]);
    if (jobs.length === 0 || userContexts.length === 0)
        return;
    const { operations, records } = yield collectReverseMatchOperations(jobs, userContexts, params.nowIso);
    if (operations.length === 0 || records.length === 0)
        return;
    const existingAlertIds = yield resolveExistingAlertIds({
        db: params.db,
        records,
    });
    const didPersist = yield persistReverseMatchOperations({
        db: params.db,
        operations,
    });
    if (!didPersist)
        return;
    const insertedEntries = records
        .filter((record) => !existingAlertIds.has(record.alertId))
        .map((record) => toNotificationEntry(record));
    if (insertedEntries.length === 0)
        return;
    const groupedByUser = groupNotificationEntriesByUser(insertedEntries);
    void dispatchReverseMatchNotifications(groupedByUser).catch((error) => {
        console.error('Reverse match notification dispatch pipeline error:', error);
    });
});
exports.processReverseJobMatchesForIngestedPayload = processReverseJobMatchesForIngestedPayload;
const listTopJobMatchesForUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const profile = (0, jobRecommendationService_1.buildRecommendationProfile)(params.user);
    const candidateFilter = (0, jobRecommendationService_1.buildRecommendationCandidateFilter)(profile);
    const candidateLimit = Number.isFinite(Number(params.candidateLimit))
        ? Math.max(30, Math.round(Number(params.candidateLimit)))
        : DEFAULT_MATCH_CANDIDATE_LIMIT;
    const limit = Number.isFinite(Number(params.limit))
        ? Math.max(1, Math.round(Number(params.limit)))
        : DEFAULT_PUBLIC_MATCH_LIMIT;
    const preferredConditions = Array.isArray(candidateFilter === null || candidateFilter === void 0 ? void 0 : candidateFilter.$or)
        ? candidateFilter.$or
        : [];
    let candidateJobs = [];
    if (preferredConditions.length === 0) {
        candidateJobs = yield params.db.collection(JOBS_COLLECTION)
            .find({ status: 'open' })
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(candidateLimit)
            .toArray();
    }
    else {
        const coarseLimit = Math.min(600, Math.max(candidateLimit * 2, 160));
        candidateJobs = yield params.db.collection(JOBS_COLLECTION)
            .aggregate([
            { $match: { status: 'open' } },
            { $sort: { publishedAt: -1, createdAt: -1 } },
            { $limit: coarseLimit },
            {
                $addFields: {
                    __recommendationPriority: {
                        $cond: [{ $or: preferredConditions }, 1, 0],
                    },
                },
            },
            { $sort: { __recommendationPriority: -1, publishedAt: -1, createdAt: -1 } },
            { $limit: candidateLimit },
            { $project: { __recommendationPriority: 0 } },
        ])
            .toArray();
    }
    const scored = candidateJobs
        .map((job) => {
        const score = (0, jobRecommendationService_1.buildJobRecommendationScore)(job, profile);
        return Object.assign({ job }, score);
    })
        .sort((left, right) => (right.score - left.score) || (right.publishedTs - left.publishedTs))
        .slice(0, limit);
    return scored.map((entry) => {
        const roundedScore = Math.max(0, Math.round(entry.score));
        return Object.assign(Object.assign({}, entry.job), { recommendationScore: roundedScore, recommendationReasons: entry.reasons.slice(0, 3), matchedSkills: entry.matchedSkills.slice(0, 5), matchTier: (0, jobRecommendationService_1.resolveRecommendationMatchTier)(roundedScore) });
    });
});
exports.listTopJobMatchesForUser = listTopJobMatchesForUser;
