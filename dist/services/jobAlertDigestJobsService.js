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
exports.resolvePublicDigestCategory = exports.buildPublicDigestJobsForWindow = exports.buildUserDigestJobsForProfile = exports.listUserDigestCandidateJobs = exports.buildUserDigestRecommendationProfile = exports.buildUserDigestJobs = exports.createUserDigestCandidateIndex = void 0;
const jobAlertCategoryService_1 = require("./jobAlertCategoryService");
const jobRecommendationService_1 = require("./jobRecommendationService");
const jobAlertDigestScoringService_1 = require("./jobAlertDigestScoringService");
const jobRecommendationQueryBuilder_1 = require("./jobRecommendationQueryBuilder");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const publicWebUrl_1 = require("../utils/publicWebUrl");
const JOBS_COLLECTION = 'jobs';
const JOB_ALERT_USER_MAX_JOBS = 10;
const JOB_ALERT_PUBLIC_MAX_JOBS = 10;
const JOB_ALERT_USER_CANDIDATE_LIMIT = 140;
const JOB_ALERT_PUBLIC_CANDIDATE_LIMIT = 100;
const JOB_ALERT_USER_RANKING_CANDIDATE_LIMIT = 48;
const APP_BASE_URL = (0, publicWebUrl_1.getPublicWebUrl)();
const buildJobUrl = (job) => {
    const slug = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.slug, 220) || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 220);
    if (!slug)
        return `${APP_BASE_URL}/jobs`;
    return `${APP_BASE_URL}/jobs/${encodeURIComponent(slug)}`;
};
const normalizeDiscoveredAt = (job) => ((0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.discoveredAt, 80)
    || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.createdAt, 80)
    || new Date().toISOString());
const normalizeToken = (value) => (0, inputSanitizers_1.readString)(value, 120).trim().toLowerCase();
const addJobToTokenBuckets = (buckets, token, job) => {
    if (!token)
        return;
    const existing = buckets.get(token);
    if (existing) {
        existing.push(job);
        return;
    }
    buckets.set(token, [job]);
};
const getJobCandidateKey = (job) => (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 220) || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.slug, 220);
const buildDigestJobItem = (job, overrides) => (Object.assign({ title: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 180) || 'New job', companyName: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.companyName, 160) || 'Hiring team', locationText: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.locationText, 160) || 'Flexible', url: buildJobUrl(job), discoveredAt: normalizeDiscoveredAt(job) }, overrides));
const buildRecentJobsFilter = (windowStartIso) => ({
    status: 'open',
    $or: [
        { discoveredAt: { $gte: windowStartIso } },
        { createdAt: { $gte: windowStartIso } },
    ],
});
const queryRecentDigestCandidateJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const recentFilter = buildRecentJobsFilter(params.windowStartIso);
    const candidateFilter = params.candidateFilter && Object.keys(params.candidateFilter).length > 0
        ? Object.assign({}, params.candidateFilter) : null;
    const mergedFilter = candidateFilter && Array.isArray(candidateFilter.$or)
        ? {
            $and: [
                recentFilter,
                {
                    $or: candidateFilter.$or,
                },
            ],
        }
        : recentFilter;
    return params.db.collection(JOBS_COLLECTION)
        .find(mergedFilter)
        .sort({ discoveredAt: -1, publishedAt: -1, createdAt: -1 })
        .limit(params.limit)
        .toArray();
});
const createEmptyPublicDigestGroups = () => ({
    all: [],
    engineering: [],
    design: [],
    marketing: [],
    data: [],
    product: [],
    operations: [],
    sales: [],
});
const createUserDigestCandidateIndex = (candidateJobs) => {
    const index = {
        allJobs: Array.isArray(candidateJobs) ? candidateJobs : [],
        skillTokenJobs: new Map(),
        semanticTokenJobs: new Map(),
        workModelJobs: new Map(),
        jobPositionByKey: new Map(),
        jobMetadataByKey: new Map(),
    };
    index.allJobs.forEach((job, position) => {
        const jobKey = getJobCandidateKey(job);
        if (jobKey) {
            index.jobPositionByKey.set(jobKey, position);
        }
        const workModel = normalizeToken(job === null || job === void 0 ? void 0 : job.workModel);
        if (workModel) {
            addJobToTokenBuckets(index.workModelJobs, workModel, job);
        }
        const tags = Array.isArray(job === null || job === void 0 ? void 0 : job.tags) ? job.tags : [];
        const semanticTokens = Array.isArray(job === null || job === void 0 ? void 0 : job.recommendationSemanticTokens)
            ? job.recommendationSemanticTokens
            : [];
        const normalizedTags = new Set(tags
            .map((token) => normalizeToken(token))
            .filter((token) => token.length > 0));
        const normalizedSemanticTokens = new Set(semanticTokens
            .map((token) => normalizeToken(token))
            .filter((token) => token.length > 0));
        if (jobKey) {
            index.jobMetadataByKey.set(jobKey, {
                tagTokens: normalizedTags,
                semanticTokens: normalizedSemanticTokens,
                workModel,
                discoveredAt: normalizeDiscoveredAt(job),
            });
        }
        normalizedTags.forEach((token) => addJobToTokenBuckets(index.skillTokenJobs, token, job));
        normalizedSemanticTokens.forEach((token) => addJobToTokenBuckets(index.semanticTokenJobs, token, job));
    });
    return index;
};
exports.createUserDigestCandidateIndex = createUserDigestCandidateIndex;
const filterIndexedCandidateJobs = (params) => {
    const dedupedJobs = new Map();
    const windowStartTs = new Date(params.windowStartIso).getTime();
    const addJobs = (jobs) => {
        if (!Array.isArray(jobs) || jobs.length === 0)
            return;
        for (const job of jobs) {
            const discoveredAtTs = new Date(normalizeDiscoveredAt(job)).getTime();
            if (Number.isFinite(windowStartTs) && Number.isFinite(discoveredAtTs) && discoveredAtTs < windowStartTs) {
                continue;
            }
            const jobKey = getJobCandidateKey(job);
            if (!jobKey || dedupedJobs.has(jobKey))
                continue;
            dedupedJobs.set(jobKey, job);
        }
    };
    params.recommendationCriteria.skillTokens.forEach((token) => addJobs(params.candidateIndex.skillTokenJobs.get(normalizeToken(token))));
    params.recommendationCriteria.semanticTokens.forEach((token) => addJobs(params.candidateIndex.semanticTokenJobs.get(normalizeToken(token))));
    params.recommendationCriteria.preferredWorkModels.forEach((workModel) => addJobs(params.candidateIndex.workModelJobs.get(normalizeToken(workModel))));
    return Array.from(dedupedJobs.values())
        .sort((left, right) => {
        var _a, _b;
        const leftKey = getJobCandidateKey(left);
        const rightKey = getJobCandidateKey(right);
        const leftPosition = leftKey ? (_a = params.candidateIndex.jobPositionByKey.get(leftKey)) !== null && _a !== void 0 ? _a : Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        const rightPosition = rightKey ? (_b = params.candidateIndex.jobPositionByKey.get(rightKey)) !== null && _b !== void 0 ? _b : Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        return leftPosition - rightPosition;
    })
        .slice(0, JOB_ALERT_USER_RANKING_CANDIDATE_LIMIT);
};
const selectRecentCandidateJobs = (params) => {
    const selected = [];
    const windowStartTs = new Date(params.windowStartIso).getTime();
    for (const job of params.candidateJobs) {
        const discoveredAtTs = new Date(normalizeDiscoveredAt(job)).getTime();
        if (Number.isFinite(windowStartTs) && Number.isFinite(discoveredAtTs) && discoveredAtTs < windowStartTs) {
            continue;
        }
        selected.push(job);
        if (selected.length >= params.limit)
            break;
    }
    return selected;
};
const mapRankedDigestEntriesToItems = (entries) => {
    const selected = entries.filter((entry) => entry.score > 0);
    if (selected.length === 0)
        return [];
    return selected.map((entry) => (Object.assign(Object.assign({}, buildDigestJobItem(entry.job)), { matchScore: Math.max(0, Math.round(entry.score)), matchTier: (0, jobRecommendationService_1.resolveRecommendationMatchTier)(Math.max(0, Math.round(entry.score))) })));
};
const loadUserDigestCandidateJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const recommendationFilter = (0, jobRecommendationQueryBuilder_1.buildRecommendationCandidateMongoFilter)(params.recommendationCriteria);
    let candidateJobs = Array.isArray(params.candidateJobs) ? params.candidateJobs : [];
    if (candidateJobs.length === 0 && ((_a = params.candidateIndex) === null || _a === void 0 ? void 0 : _a.allJobs.length)) {
        candidateJobs = params.candidateIndex.allJobs;
    }
    if (candidateJobs.length === 0) {
        if (!params.db)
            return [];
        return queryRecentDigestCandidateJobs({
            db: params.db,
            windowStartIso: params.windowStartIso,
            candidateFilter: recommendationFilter,
            limit: JOB_ALERT_USER_CANDIDATE_LIMIT,
        });
    }
    if (Array.isArray(recommendationFilter.$or)) {
        const candidateIndex = params.candidateIndex || (0, exports.createUserDigestCandidateIndex)(candidateJobs);
        return filterIndexedCandidateJobs({
            candidateIndex,
            recommendationCriteria: params.recommendationCriteria,
            windowStartIso: params.windowStartIso,
        });
    }
    return selectRecentCandidateJobs({
        candidateJobs: ((_b = params.candidateIndex) === null || _b === void 0 ? void 0 : _b.allJobs) || candidateJobs,
        windowStartIso: params.windowStartIso,
        limit: JOB_ALERT_USER_MAX_JOBS,
    });
});
const buildUserDigestJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const recommendationProfile = (0, jobRecommendationService_1.buildRecommendationProfile)(params.user);
    return (0, exports.buildUserDigestJobsForProfile)({
        db: params.db,
        recommendationProfile,
        windowStartIso: params.windowStartIso,
    });
});
exports.buildUserDigestJobs = buildUserDigestJobs;
const buildUserDigestRecommendationProfile = (user) => (0, jobRecommendationService_1.buildRecommendationProfile)(user);
exports.buildUserDigestRecommendationProfile = buildUserDigestRecommendationProfile;
const listUserDigestCandidateJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    return queryRecentDigestCandidateJobs({
        db: params.db,
        windowStartIso: params.windowStartIso,
        limit: typeof params.limit === 'number' && Number.isFinite(params.limit)
            ? Math.max(JOB_ALERT_USER_CANDIDATE_LIMIT, Math.floor(params.limit))
            : JOB_ALERT_USER_CANDIDATE_LIMIT,
    });
});
exports.listUserDigestCandidateJobs = listUserDigestCandidateJobs;
const buildUserDigestJobsForProfile = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const recommendationCriteria = (0, jobRecommendationService_1.buildRecommendationCandidateCriteria)(params.recommendationProfile);
    const candidateJobs = yield loadUserDigestCandidateJobs({
        db: params.db,
        recommendationCriteria,
        windowStartIso: params.windowStartIso,
        candidateJobs: params.candidateJobs,
        candidateIndex: params.candidateIndex,
    });
    if (candidateJobs.length === 0)
        return [];
    const rankedEntries = yield (0, jobAlertDigestScoringService_1.rankDigestCandidateJobs)({
        candidateJobs,
        recommendationProfile: params.recommendationProfile,
        candidateMetadataByKey: (_a = params.candidateIndex) === null || _a === void 0 ? void 0 : _a.jobMetadataByKey,
        maxResults: JOB_ALERT_USER_MAX_JOBS,
    });
    const rankedItems = mapRankedDigestEntriesToItems(rankedEntries);
    if (rankedItems.length > 0)
        return rankedItems;
    return candidateJobs.slice(0, JOB_ALERT_USER_MAX_JOBS).map((job) => buildDigestJobItem(job));
});
exports.buildUserDigestJobsForProfile = buildUserDigestJobsForProfile;
const buildPublicDigestJobsForWindow = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const candidateJobs = yield queryRecentDigestCandidateJobs({
        db: params.db,
        windowStartIso: params.windowStartIso,
        limit: JOB_ALERT_PUBLIC_CANDIDATE_LIMIT,
    });
    const groupedJobs = createEmptyPublicDigestGroups();
    if (candidateJobs.length === 0)
        return groupedJobs;
    for (const job of candidateJobs) {
        const item = buildDigestJobItem(job);
        if (groupedJobs.all.length < JOB_ALERT_PUBLIC_MAX_JOBS) {
            groupedJobs.all.push(item);
        }
        const category = (0, jobAlertCategoryService_1.resolveStoredJobAlertCategory)(job);
        if (groupedJobs[category].length < JOB_ALERT_PUBLIC_MAX_JOBS) {
            groupedJobs[category].push(item);
        }
    }
    return groupedJobs;
});
exports.buildPublicDigestJobsForWindow = buildPublicDigestJobsForWindow;
const resolvePublicDigestCategory = (value) => (0, jobAlertCategoryService_1.normalizeJobAlertCategory)(value);
exports.resolvePublicDigestCategory = resolvePublicDigestCategory;
