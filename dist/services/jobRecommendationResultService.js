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
exports.buildRankedRecommendationEntries = exports.fetchPrioritizedRecommendationCandidateJobs = void 0;
const jobRecommendationService_1 = require("./jobRecommendationService");
const JOBS_COLLECTION = 'jobs';
const RECOMMENDATION_SCORE_BATCH_SIZE = 20;
const yieldRecommendationScoreTurn = () => new Promise((resolve) => {
    setImmediate(resolve);
});
const fetchPrioritizedRecommendationCandidateJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const preferredConditions = Array.isArray((_a = params.recommendationCandidateFilter) === null || _a === void 0 ? void 0 : _a.$or)
        ? params.recommendationCandidateFilter.$or
        : [];
    if (!params.hasPrioritySignals || preferredConditions.length === 0) {
        return params.db.collection(JOBS_COLLECTION)
            .find({ status: 'open' })
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(params.candidateLimit)
            .toArray();
    }
    const coarseLimit = Math.min(600, Math.max(params.candidateLimit * 2, 160));
    return params.db.collection(JOBS_COLLECTION)
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
        { $limit: params.candidateLimit },
        { $project: { __recommendationPriority: 0 } },
    ])
        .toArray();
});
exports.fetchPrioritizedRecommendationCandidateJobs = fetchPrioritizedRecommendationCandidateJobs;
const buildRankedRecommendationEntries = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.candidateJobs.length === 0) {
        return {
            entries: [],
            groups: { best: 0, good: 0, other: 0 },
        };
    }
    const scoredJobs = [];
    for (let index = 0; index < params.candidateJobs.length; index += RECOMMENDATION_SCORE_BATCH_SIZE) {
        const batch = params.candidateJobs.slice(index, index + RECOMMENDATION_SCORE_BATCH_SIZE);
        scoredJobs.push(...batch.map((job) => {
            const scoreResult = (0, jobRecommendationService_1.buildJobRecommendationScore)(job, params.recommendationProfile);
            return Object.assign({ job }, scoreResult);
        }));
        if (index + RECOMMENDATION_SCORE_BATCH_SIZE < params.candidateJobs.length) {
            yield yieldRecommendationScoreTurn();
        }
    }
    const rankedMatches = scoredJobs
        .filter((entry) => entry.score > 0)
        .sort((left, right) => (right.score - left.score) || (right.publishedTs - left.publishedTs));
    const selectedEntries = (rankedMatches.length > 0 ? rankedMatches : scoredJobs).slice(0, params.limit);
    const orderedEntries = [
        ...selectedEntries
            .filter((entry) => (0, jobRecommendationService_1.resolveRecommendationMatchTier)(entry.score) === 'best')
            .map((entry) => (Object.assign(Object.assign({}, entry), { matchTier: 'best' }))),
        ...selectedEntries
            .filter((entry) => (0, jobRecommendationService_1.resolveRecommendationMatchTier)(entry.score) === 'good')
            .map((entry) => (Object.assign(Object.assign({}, entry), { matchTier: 'good' }))),
        ...selectedEntries
            .filter((entry) => (0, jobRecommendationService_1.resolveRecommendationMatchTier)(entry.score) === 'other')
            .map((entry) => (Object.assign(Object.assign({}, entry), { matchTier: 'other' }))),
    ];
    return {
        entries: orderedEntries,
        groups: {
            best: orderedEntries.filter((entry) => entry.matchTier === 'best').length,
            good: orderedEntries.filter((entry) => entry.matchTier === 'good').length,
            other: orderedEntries.filter((entry) => entry.matchTier === 'other').length,
        },
    };
});
exports.buildRankedRecommendationEntries = buildRankedRecommendationEntries;
