import { buildJobRecommendationScore } from './jobRecommendationService';

export type ReverseMatchScoreEntry = {
  userId: string;
  score: number;
  reasons: string[];
  matchedSkills: string[];
};

export const buildReverseMatchScoreEntry = (params: {
  job: any;
  userId: string;
  profile: any;
  minScore: number;
}): ReverseMatchScoreEntry | null => {
  if (!params.userId) return null;
  const scoreResult = buildJobRecommendationScore(params.job, params.profile);
  const roundedScore = Math.max(0, Math.round(scoreResult.score));
  if (roundedScore < params.minScore) return null;

  return {
    userId: params.userId,
    score: roundedScore,
    reasons: scoreResult.reasons.slice(0, 4),
    matchedSkills: scoreResult.matchedSkills.slice(0, 6),
  };
};
