import type { RecommendationCandidateCriteria } from './jobRecommendationService';

export const buildRecommendationCandidateMongoFilter = (
  criteria: RecommendationCandidateCriteria,
): Record<string, unknown> => {
  const orFilters: Array<Record<string, unknown>> = [];

  if (criteria.skillTokens.length > 0) {
    orFilters.push({ tags: { $in: criteria.skillTokens } });
  }
  if (criteria.semanticTokens.length > 0) {
    orFilters.push({ recommendationSemanticTokens: { $in: criteria.semanticTokens } });
  }
  if (criteria.preferredWorkModels.length > 0) {
    orFilters.push({ workModel: { $in: criteria.preferredWorkModels } });
  }

  if (orFilters.length === 0) {
    return { status: criteria.status };
  }

  return {
    status: criteria.status,
    $or: orFilters,
  };
};
