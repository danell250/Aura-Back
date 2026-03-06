"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReverseMatchScoreEntry = void 0;
const jobRecommendationService_1 = require("./jobRecommendationService");
const buildReverseMatchScoreEntry = (params) => {
    if (!params.userId)
        return null;
    const scoreResult = (0, jobRecommendationService_1.buildJobRecommendationScore)(params.job, params.profile);
    const roundedScore = Math.max(0, Math.round(scoreResult.score));
    if (roundedScore < params.minScore)
        return null;
    return {
        userId: params.userId,
        score: roundedScore,
        reasons: scoreResult.reasons.slice(0, 4),
        matchedSkills: scoreResult.matchedSkills.slice(0, 6),
    };
};
exports.buildReverseMatchScoreEntry = buildReverseMatchScoreEntry;
