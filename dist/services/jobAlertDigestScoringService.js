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
exports.rankDigestCandidateJobs = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const asyncUtils_1 = require("../utils/asyncUtils");
const JOB_ALERT_SCORING_YIELD_INTERVAL = 12;
const normalizeToken = (value) => (0, inputSanitizers_1.readString)(value, 120).trim().toLowerCase();
const getJobCandidateKey = (job) => (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 220) || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.slug, 220);
const normalizeDiscoveredAt = (job) => ((0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.discoveredAt, 80)
    || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.createdAt, 80)
    || new Date().toISOString());
const countSetMatches = (profileTokens, jobTokens) => {
    if (profileTokens.size === 0 || jobTokens.size === 0)
        return 0;
    const [smaller, larger] = profileTokens.size <= jobTokens.size
        ? [profileTokens, jobTokens]
        : [jobTokens, profileTokens];
    let matches = 0;
    smaller.forEach((token) => {
        if (larger.has(token)) {
            matches += 1;
        }
    });
    return matches;
};
const scoreDigestFreshness = (value) => {
    const parsed = new Date((0, inputSanitizers_1.readString)(value, 80) || '');
    if (Number.isNaN(parsed.getTime()))
        return 0;
    const ageHours = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / (60 * 60 * 1000)));
    if (ageHours <= 24)
        return 12;
    if (ageHours <= 72)
        return 8;
    if (ageHours <= 168)
        return 4;
    return 0;
};
const scoreDigestCandidateJob = (params) => {
    var _a, _b, _c, _d, _e, _f;
    const jobKey = getJobCandidateKey(params.job);
    const metadata = jobKey ? (_a = params.candidateMetadataByKey) === null || _a === void 0 ? void 0 : _a.get(jobKey) : null;
    const tagTokens = (metadata === null || metadata === void 0 ? void 0 : metadata.tagTokens) || new Set((Array.isArray((_b = params.job) === null || _b === void 0 ? void 0 : _b.tags) ? params.job.tags : [])
        .map((token) => normalizeToken(token))
        .filter(Boolean));
    const semanticTokens = (metadata === null || metadata === void 0 ? void 0 : metadata.semanticTokens) || new Set((Array.isArray((_c = params.job) === null || _c === void 0 ? void 0 : _c.recommendationSemanticTokens) ? params.job.recommendationSemanticTokens : [])
        .map((token) => normalizeToken(token))
        .filter(Boolean));
    const skillMatches = countSetMatches(params.recommendationProfile.skillTokens, tagTokens);
    const semanticMatches = countSetMatches(params.semanticProfileTokens, semanticTokens);
    const workModel = (metadata === null || metadata === void 0 ? void 0 : metadata.workModel) || normalizeToken((_d = params.job) === null || _d === void 0 ? void 0 : _d.workModel);
    const workModelMatch = workModel && params.recommendationProfile.preferredWorkModels.has(workModel);
    const score = Math.max(0, Math.min(60, skillMatches * 18)
        + Math.min(24, semanticMatches * 12)
        + (workModelMatch ? 10 : 0)
        + scoreDigestFreshness(((_e = params.job) === null || _e === void 0 ? void 0 : _e.discoveredAt) || ((_f = params.job) === null || _f === void 0 ? void 0 : _f.createdAt)));
    return {
        job: params.job,
        score,
        discoveredAt: (metadata === null || metadata === void 0 ? void 0 : metadata.discoveredAt) || normalizeDiscoveredAt(params.job),
    };
};
const rankDigestCandidateJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const semanticProfileTokens = new Set([
        ...Array.from(params.recommendationProfile.roleTokens),
        ...Array.from(params.recommendationProfile.industryTokens),
    ]);
    const entries = [];
    for (let index = 0; index < params.candidateJobs.length; index += 1) {
        entries.push(scoreDigestCandidateJob({
            job: params.candidateJobs[index],
            recommendationProfile: params.recommendationProfile,
            semanticProfileTokens,
            candidateMetadataByKey: params.candidateMetadataByKey,
        }));
        if ((index + 1) % JOB_ALERT_SCORING_YIELD_INTERVAL === 0) {
            yield (0, asyncUtils_1.yieldToEventLoop)();
        }
    }
    return entries
        .sort((left, right) => {
        if (right.score !== left.score)
            return right.score - left.score;
        return new Date(right.discoveredAt).getTime() - new Date(left.discoveredAt).getTime();
    })
        .slice(0, params.maxResults);
});
exports.rankDigestCandidateJobs = rankDigestCandidateJobs;
