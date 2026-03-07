import { buildJobRecommendationPrecomputedFields } from './jobRecommendationService';
import { buildDemandRoleFields, buildJobMarketDemandPrecomputedFields } from './openToWorkDemandService';

export const buildAggregatedJobDerivedFields = (params: {
  title: string;
  summary: string;
  description: string;
  locationText: string;
  tags: string[];
  workModel: string;
  salaryMin: number | null;
  salaryMax: number | null;
  createdAt: string;
  publishedAt: string;
}): Record<string, unknown> => ({
  ...buildJobRecommendationPrecomputedFields({
    title: params.title,
    summary: params.summary,
    description: params.description,
    locationText: params.locationText,
    tags: params.tags,
    workModel: params.workModel,
    salaryMin: params.salaryMin,
    salaryMax: params.salaryMax,
    createdAt: params.createdAt,
    publishedAt: params.publishedAt,
  }),
  ...(buildDemandRoleFields(params.title) || {}),
  ...buildJobMarketDemandPrecomputedFields({
    createdAt: params.createdAt,
    publishedAt: params.publishedAt,
    salaryMin: params.salaryMin,
    salaryMax: params.salaryMax,
  }),
});
