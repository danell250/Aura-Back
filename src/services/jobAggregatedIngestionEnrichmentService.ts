import { buildJobRecommendationPrecomputedFields } from './jobRecommendationService';
import { buildJobAlertCategoryFields } from './jobAlertCategoryService';
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
}): Record<string, unknown> => {
  const demandRoleFields = buildDemandRoleFields(params.title) || {};
  const categoryFields = buildJobAlertCategoryFields({
    title: params.title,
    summary: params.summary,
    description: params.description,
    tags: params.tags,
    demandRoleFamily: (demandRoleFields as any)?.demandRoleFamily,
  });

  return {
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
  ...demandRoleFields,
  ...categoryFields,
  ...buildJobMarketDemandPrecomputedFields({
    createdAt: params.createdAt,
    publishedAt: params.publishedAt,
    salaryMin: params.salaryMin,
    salaryMax: params.salaryMax,
  }),
  };
};
