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
exports.listTopJobMatchesForUser = exports.processReverseJobMatchesForIngestedPayload = exports.warmReverseMatchIndexes = exports.ensureReverseMatchIndexes = void 0;
const crypto_1 = require("crypto");
const jobRecommendationService_1 = require("./jobRecommendationService");
const jobRecommendationQueryBuilder_1 = require("./jobRecommendationQueryBuilder");
const jobRecommendationResultService_1 = require("./jobRecommendationResultService");
const jobPulseService_1 = require("./jobPulseService");
const reverseJobMatchNotificationService_1 = require("./reverseJobMatchNotificationService");
const reverseJobMatchWorkerService_1 = require("./reverseJobMatchWorkerService");
const reverseJobMatchScoringUtils_1 = require("./reverseJobMatchScoringUtils");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const concurrencyUtils_1 = require("../utils/concurrencyUtils");
const USERS_COLLECTION = 'users';
const JOBS_COLLECTION = 'jobs';
const REVERSE_MATCH_ALERTS_COLLECTION = 'job_reverse_match_alerts';
const REVERSE_MATCH_MIN_SCORE = Number.isFinite(Number(process.env.REVERSE_MATCH_MIN_SCORE))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_MIN_SCORE)))
    : 70;
const REVERSE_MATCH_MAX_USER_SCAN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_USER_SCAN))
    ? Math.max(100, Math.round(Number(process.env.REVERSE_MATCH_MAX_USER_SCAN)))
    : 300;
const REVERSE_MATCH_MAX_JOBS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_JOBS_PER_RUN))
    ? Math.max(20, Math.round(Number(process.env.REVERSE_MATCH_MAX_JOBS_PER_RUN)))
    : 60;
const REVERSE_MATCH_MAX_OPS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_OPS_PER_RUN))
    ? Math.max(200, Math.round(Number(process.env.REVERSE_MATCH_MAX_OPS_PER_RUN)))
    : 25000;
const REVERSE_MATCH_MAX_CANDIDATES_PER_JOB = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_CANDIDATES_PER_JOB))
    ? Math.max(40, Math.round(Number(process.env.REVERSE_MATCH_MAX_CANDIDATES_PER_JOB)))
    : 80;
const REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB = Number.isFinite(Number(process.env.REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB))
    ? Math.max(10, Math.round(Number(process.env.REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB)))
    : 30;
const REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN))
    ? Math.max(500, Math.round(Number(process.env.REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN)))
    : 500;
const REVERSE_MATCH_NOTIFICATION_TOP_JOBS = Number.isFinite(Number(process.env.REVERSE_MATCH_NOTIFICATION_TOP_JOBS))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_NOTIFICATION_TOP_JOBS)))
    : 5;
const REVERSE_MATCH_NOTIFICATION_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_NOTIFICATION_BATCH_SIZE))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_NOTIFICATION_BATCH_SIZE)))
    : 25;
const REVERSE_MATCH_YIELD_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_SCORE_YIELD_EVERY))
    ? Math.max(10, Math.round(Number(process.env.REVERSE_MATCH_SCORE_YIELD_EVERY)))
    : 5;
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
const resolveOpenJobsForReverseMatch = (db, jobIds) => __awaiter(void 0, void 0, void 0, function* () {
    const normalizedJobIds = Array.from(new Set(jobIds
        .map((jobId) => (0, inputSanitizers_1.readString)(jobId, 120))
        .filter((jobId) => jobId.length > 0))).slice(0, REVERSE_MATCH_MAX_JOBS_PER_RUN);
    if (normalizedJobIds.length === 0)
        return [];
    return db.collection(JOBS_COLLECTION)
        .find({
        status: 'open',
        id: { $in: normalizedJobIds },
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
    if (reverseMatchIndexesLastFailureAtMs > 0
        && (Date.now() - reverseMatchIndexesLastFailureAtMs) < REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS) {
        return;
    }
    if (!reverseMatchIndexesPromise) {
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
                throw error;
            }
            finally {
                if (!reverseMatchIndexesEnsured) {
                    reverseMatchIndexesPromise = null;
                }
            }
        }))();
    }
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
const warmReverseMatchIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    yield Promise.allSettled([
        (0, exports.ensureReverseMatchIndexes)(db),
        ensureReverseMatchUserScanIndexes(db),
    ]);
});
exports.warmReverseMatchIndexes = warmReverseMatchIndexes;
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
const extractJobIndustryTokens = (job) => {
    const tokenSources = [];
    if (Array.isArray(job === null || job === void 0 ? void 0 : job.tags)) {
        tokenSources.push(...job.tags);
    }
    tokenSources.push((0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.industry, 120));
    return uniqueStrings(tokenSources, 30);
};
const buildJobSignalBundle = (job) => {
    const skillTokens = extractJobSkillTokens(job);
    const locationTokens = extractJobLocationTokens(job);
    const industryTokens = extractJobIndustryTokens(job);
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
        skillTokenSet: new Set(skillTokens),
        locationTokens,
        locationTokenSet: new Set(locationTokens),
        industryTokens,
        industryTokenSet: new Set(industryTokens),
        semanticTokens,
        semanticTokenSet: new Set(semanticTokens),
        workModel,
        isRemoteRole,
        hasSignals: skillTokens.length > 0
            || locationTokens.length > 0
            || industryTokens.length > 0
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
    collectIndexedCandidates(indexBundle.byIndustryToken, jobSignals.industryTokens, secondary);
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
const buildFeedMatchPulseEventId = (userId, jobId, bucketIso) => (0, crypto_1.createHash)('sha256').update(`feed-match:${userId}:${jobId}:${bucketIso}`).digest('hex');
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
const resolvePerJobEvaluationCap = (totalEvalBudget, totalJobs) => Math.max(1, Math.min(REVERSE_MATCH_MAX_CANDIDATES_PER_JOB, Math.floor(totalEvalBudget / Math.max(1, totalJobs))));
const collectWorkerCandidatesForJob = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.remainingGlobalBudget <= 0) {
        return { candidates: [], evaluationsUsed: 0 };
    }
    const candidates = [];
    let evaluationsUsed = 0;
    const cappedCandidateIndexes = params.candidateContextIndexes.slice(0, params.perJobEvaluationCap);
    for (const ctxIndex of cappedCandidateIndexes) {
        const context = params.contexts[ctxIndex];
        if (!context)
            continue;
        evaluationsUsed += 1;
        candidates.push({
            userId: context.userId,
            profile: context.profile,
        });
        if (evaluationsUsed % REVERSE_MATCH_YIELD_BATCH_SIZE === 0) {
            yield (0, concurrencyUtils_1.yieldToEventLoop)();
        }
    }
    return { candidates, evaluationsUsed };
});
const collectJobMatchCandidates = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const jobId = (0, inputSanitizers_1.readString)((_a = params.job) === null || _a === void 0 ? void 0 : _a.id, 120);
    if (!jobId || params.remainingEvalBudget <= 0) {
        return { payload: null, evaluationsUsed: 0 };
    }
    const jobSignals = buildJobSignalBundle(params.job);
    const candidateContextIndexes = resolveCandidateContextIndexesForJob(params.indexBundle, jobSignals);
    if (candidateContextIndexes.length === 0) {
        return { payload: null, evaluationsUsed: 0 };
    }
    const { candidates, evaluationsUsed } = yield collectWorkerCandidatesForJob({
        contexts: params.contexts,
        candidateContextIndexes,
        perJobEvaluationCap: params.perJobEvaluationCap,
        remainingGlobalBudget: params.remainingEvalBudget,
    });
    if (candidates.length === 0) {
        return { payload: null, evaluationsUsed };
    }
    return {
        payload: {
            jobId,
            job: params.job,
            candidates,
        },
        evaluationsUsed,
    };
});
const scoreCandidatesInProcess = (payloads) => __awaiter(void 0, void 0, void 0, function* () {
    const scoredByJobId = new Map();
    for (const payload of payloads) {
        const entries = [];
        for (let index = 0; index < payload.candidates.length; index += 1) {
            const candidate = payload.candidates[index];
            const entry = (0, reverseJobMatchScoringUtils_1.buildReverseMatchScoreEntry)({
                job: payload.job,
                userId: candidate.userId,
                profile: candidate.profile,
                minScore: REVERSE_MATCH_MIN_SCORE,
            });
            if (entry) {
                entries.push(entry);
            }
            if ((index + 1) % REVERSE_MATCH_YIELD_BATCH_SIZE === 0) {
                yield (0, concurrencyUtils_1.yieldToEventLoop)();
            }
        }
        scoredByJobId.set(payload.jobId, entries);
    }
    return scoredByJobId;
});
const collectReverseMatchOperations = (jobs, contexts, nowIso) => __awaiter(void 0, void 0, void 0, function* () {
    const operations = [];
    const records = [];
    const indexBundle = resolveMatchIndexBundle(contexts);
    const contextByUserId = new Map(contexts.map((context) => [context.userId, context]));
    const jobsById = new Map();
    const workerPayloads = [];
    const perJobEvaluationCap = resolvePerJobEvaluationCap(REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN, jobs.length);
    let scoreEvaluations = 0;
    for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
        const job = jobs[jobIndex];
        if (workerPayloads.length >= REVERSE_MATCH_MAX_JOBS_PER_RUN)
            break;
        const remainingEvalBudget = REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN - scoreEvaluations;
        if (remainingEvalBudget <= 0)
            break;
        const { payload, evaluationsUsed } = yield collectJobMatchCandidates({
            job,
            contexts,
            indexBundle,
            perJobEvaluationCap,
            remainingEvalBudget,
        });
        scoreEvaluations += evaluationsUsed;
        if (!payload)
            continue;
        workerPayloads.push(payload);
        jobsById.set(payload.jobId, job);
    }
    if (workerPayloads.length === 0) {
        return { operations, records };
    }
    let scoredByJobId;
    try {
        scoredByJobId = yield (0, reverseJobMatchWorkerService_1.scoreReverseMatchCandidatesInWorker)({
            jobs: workerPayloads,
            minScore: REVERSE_MATCH_MIN_SCORE,
        });
    }
    catch (workerError) {
        console.warn('Reverse match scoring worker unavailable; falling back to in-process scoring.', workerError);
        scoredByJobId = yield scoreCandidatesInProcess(workerPayloads);
    }
    for (const payload of workerPayloads) {
        const job = jobsById.get(payload.jobId);
        if (!job)
            continue;
        const scoredEntries = scoredByJobId.get(payload.jobId) || [];
        for (const entry of scoredEntries) {
            if (operations.length >= REVERSE_MATCH_MAX_OPS_PER_RUN) {
                return { operations, records };
            }
            const context = contextByUserId.get(entry.userId);
            if (!context)
                continue;
            const record = buildReverseMatchRecord(context, job, entry.score, entry.reasons, entry.matchedSkills);
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
const processReverseJobMatchesForIngestedPayload = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (!params.db || !Array.isArray(params.jobIds) || params.jobIds.length === 0)
        return;
    try {
        yield (0, exports.ensureReverseMatchIndexes)(params.db);
    }
    catch (error) {
        console.error('Reverse match index ensure error:', error);
        return;
    }
    const [jobs, userContexts] = yield Promise.all([
        resolveOpenJobsForReverseMatch(params.db, params.jobIds),
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
    yield (0, jobPulseService_1.recordJobPulseEvents)(params.db, insertedEntries.map((entry) => ({
        jobId: entry.jobId,
        type: 'job_matched',
        userId: entry.userId,
        createdAt: params.nowIso,
        metadata: {
            score: entry.score,
        },
    })));
    const groupedByUser = (0, reverseJobMatchNotificationService_1.groupReverseMatchNotificationEntriesByUser)(insertedEntries);
    void (0, reverseJobMatchNotificationService_1.dispatchGroupedReverseMatchNotifications)({
        groupedByUser,
        notificationTopJobs: REVERSE_MATCH_NOTIFICATION_TOP_JOBS,
        notificationBatchSize: REVERSE_MATCH_NOTIFICATION_BATCH_SIZE,
    }).catch((error) => {
        console.error('Reverse match notification dispatch pipeline error:', error);
    });
});
exports.processReverseJobMatchesForIngestedPayload = processReverseJobMatchesForIngestedPayload;
const listTopJobMatchesForUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const profile = (0, jobRecommendationService_1.buildRecommendationProfile)(params.user);
    const candidateCriteria = (0, jobRecommendationService_1.buildRecommendationCandidateCriteria)(profile);
    const candidateFilter = (0, jobRecommendationQueryBuilder_1.buildRecommendationCandidateMongoFilter)(candidateCriteria);
    const candidateLimit = Number.isFinite(Number(params.candidateLimit))
        ? Math.max(30, Math.round(Number(params.candidateLimit)))
        : DEFAULT_MATCH_CANDIDATE_LIMIT;
    const limit = Number.isFinite(Number(params.limit))
        ? Math.max(1, Math.round(Number(params.limit)))
        : DEFAULT_PUBLIC_MATCH_LIMIT;
    const candidateJobs = yield (0, jobRecommendationResultService_1.fetchPrioritizedRecommendationCandidateJobs)({
        db: params.db,
        recommendationCandidateFilter: candidateFilter,
        candidateLimit,
        hasPrioritySignals: candidateCriteria.skillTokens.length > 0
            || candidateCriteria.semanticTokens.length > 0
            || candidateCriteria.preferredWorkModels.length > 0,
    });
    const scored = candidateJobs
        .map((job) => {
        const score = (0, jobRecommendationService_1.buildJobRecommendationScore)(job, profile);
        return Object.assign({ job }, score);
    })
        .sort((left, right) => (right.score - left.score) || (right.publishedTs - left.publishedTs))
        .slice(0, limit);
    const results = scored.map((entry) => {
        const roundedScore = Math.max(0, Math.round(entry.score));
        return Object.assign(Object.assign({}, entry.job), { recommendationScore: roundedScore, recommendationReasons: entry.reasons.slice(0, 3), matchedSkills: entry.matchedSkills.slice(0, 5), matchTier: (0, jobRecommendationService_1.resolveRecommendationMatchTier)(roundedScore) });
    });
    const userId = (0, inputSanitizers_1.readString)((_a = params.user) === null || _a === void 0 ? void 0 : _a.id, 120);
    if (((_b = params.recordPulse) !== null && _b !== void 0 ? _b : true) && userId && results.length > 0) {
        const now = new Date();
        const bucketStartMs = Math.floor(now.getTime() / (10 * 60 * 1000)) * 10 * 60 * 1000;
        const bucketIso = new Date(bucketStartMs).toISOString();
        (0, jobPulseService_1.recordJobPulseEventsAsync)(params.db, results.map((entry) => ({
            id: buildFeedMatchPulseEventId(userId, (0, inputSanitizers_1.readString)(entry === null || entry === void 0 ? void 0 : entry.id, 120), bucketIso),
            jobId: (0, inputSanitizers_1.readString)(entry === null || entry === void 0 ? void 0 : entry.id, 120),
            type: 'job_matched',
            userId,
            createdAt: bucketIso,
            metadata: {
                source: 'live_match_feed',
                score: Number((entry === null || entry === void 0 ? void 0 : entry.recommendationScore) || 0),
            },
        })));
    }
    return results;
});
exports.listTopJobMatchesForUser = listTopJobMatchesForUser;
