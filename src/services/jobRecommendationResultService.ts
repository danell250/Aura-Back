import {
  buildJobRecommendationScore,
  buildRecommendationProfile,
  resolveRecommendationMatchTier,
  type RecommendationMatchTier,
  type RecommendationScoreBreakdown,
} from './jobRecommendationService';

const JOBS_COLLECTION = 'jobs';
const RECOMMENDATION_SCORE_BATCH_SIZE = 20;

export type RankedRecommendationEntry = {
  job: any;
  score: number;
  reasons: string[];
  matchedSkills: string[];
  publishedTs: number;
  breakdown: RecommendationScoreBreakdown;
  matchTier: RecommendationMatchTier;
};

const yieldRecommendationScoreTurn = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

export const fetchPrioritizedRecommendationCandidateJobs = async (params: {
  db: any;
  recommendationCandidateFilter: Record<string, unknown>;
  candidateLimit: number;
  hasPrioritySignals: boolean;
}): Promise<any[]> => {
  const preferredConditions = Array.isArray((params.recommendationCandidateFilter as any)?.$or)
    ? ((params.recommendationCandidateFilter as any).$or as Array<Record<string, unknown>>)
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
};

export const buildRankedRecommendationEntries = async (params: {
  candidateJobs: any[];
  recommendationProfile: ReturnType<typeof buildRecommendationProfile>;
  limit: number;
}): Promise<{
  entries: RankedRecommendationEntry[];
  groups: Record<RecommendationMatchTier, number>;
}> => {
  if (params.candidateJobs.length === 0) {
    return {
      entries: [],
      groups: { best: 0, good: 0, other: 0 },
    };
  }

  const scoredJobs: Array<{
    job: any;
    score: number;
    reasons: string[];
    matchedSkills: string[];
    publishedTs: number;
    breakdown: RecommendationScoreBreakdown;
  }> = [];

  for (let index = 0; index < params.candidateJobs.length; index += RECOMMENDATION_SCORE_BATCH_SIZE) {
    const batch = params.candidateJobs.slice(index, index + RECOMMENDATION_SCORE_BATCH_SIZE);
    scoredJobs.push(
      ...batch.map((job) => {
        const scoreResult = buildJobRecommendationScore(job, params.recommendationProfile);
        return {
          job,
          ...scoreResult,
        };
      }),
    );

    if (index + RECOMMENDATION_SCORE_BATCH_SIZE < params.candidateJobs.length) {
      await yieldRecommendationScoreTurn();
    }
  }

  const rankedMatches = scoredJobs
    .filter((entry) => entry.score > 0)
    .sort((left, right) => (right.score - left.score) || (right.publishedTs - left.publishedTs));

  const selectedEntries = (rankedMatches.length > 0 ? rankedMatches : scoredJobs).slice(0, params.limit);
  const orderedEntries = [
    ...selectedEntries
      .filter((entry) => resolveRecommendationMatchTier(entry.score) === 'best')
      .map((entry) => ({ ...entry, matchTier: 'best' as const })),
    ...selectedEntries
      .filter((entry) => resolveRecommendationMatchTier(entry.score) === 'good')
      .map((entry) => ({ ...entry, matchTier: 'good' as const })),
    ...selectedEntries
      .filter((entry) => resolveRecommendationMatchTier(entry.score) === 'other')
      .map((entry) => ({ ...entry, matchTier: 'other' as const })),
  ];

  return {
    entries: orderedEntries,
    groups: {
      best: orderedEntries.filter((entry) => entry.matchTier === 'best').length,
      good: orderedEntries.filter((entry) => entry.matchTier === 'good').length,
      other: orderedEntries.filter((entry) => entry.matchTier === 'other').length,
    },
  };
};
