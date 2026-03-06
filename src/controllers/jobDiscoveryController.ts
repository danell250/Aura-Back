import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { buildJobRecommendationScore, resolveRecommendationMatchTier } from '../services/jobRecommendationService';
import { resolveCachedRecommendationProfile } from '../services/jobRecommendationProfileCacheService';
import {
  ALLOWED_JOB_STATUSES,
  JOBS_COLLECTION,
  JOB_DISCOVERED_WINDOW_MINUTES,
  buildDiscoveredCountCacheKey,
  buildDiscoveredWindowFilter,
  buildPublicJobsQuerySpec,
  ensureJobsTextIndex,
  getPagination,
  resolveCachedDiscoveredCount,
} from '../services/jobDiscoveryQueryService';
import { attachHeatFieldsToJobResponses, toJobResponse } from '../services/jobResponseService';
import { readString } from '../utils/inputSanitizers';

const MIN_SALARY_INSIGHTS_SAMPLE_SIZE = 3;

const parsePublicJobsRequestState = (req: Request) => {
  const statusRaw = readString((req.query as any).status, 40).toLowerCase() || 'open';
  return {
    status: statusRaw === 'all' ? 'all' : statusRaw,
    workModelRaw: readString((req.query as any).workModel, 80).toLowerCase(),
    employmentTypeRaw: readString((req.query as any).employmentType, 80).toLowerCase(),
    locationRaw: readString((req.query as any).location, 100),
    companyRaw: readString((req.query as any).company, 100),
    searchRaw: readString((req.query as any).q, 120),
    minSalary: Number((req.query as any).salaryMin),
    maxSalary: Number((req.query as any).salaryMax),
    postedWithinHours: Number((req.query as any).postedWithinHours),
    sortBy: readString((req.query as any).sort, 40).toLowerCase() || 'latest',
    pagination: getPagination(req.query as Record<string, unknown>),
    currentUserId: readString((req.user as any)?.id, 120),
  };
};

const validatePublicJobsRequestState = (state: ReturnType<typeof parsePublicJobsRequestState>): string | null => {
  if (state.status !== 'all' && !ALLOWED_JOB_STATUSES.has(state.status)) {
    return 'Invalid status filter';
  }
  if (
    Number.isFinite(state.minSalary) &&
    Number.isFinite(state.maxSalary) &&
    state.minSalary > 0 &&
    state.maxSalary > 0 &&
    state.maxSalary < state.minSalary
  ) {
    return 'salaryMax cannot be less than salaryMin';
  }
  return null;
};

const resolvePublicJobsQueryContext = async (params: {
  db: any;
  state: ReturnType<typeof parsePublicJobsRequestState>;
}) => {
  const allowTextSearch = await ensureJobsTextIndex(params.db);
  if (params.state.searchRaw && !allowTextSearch) {
    return { error: 'Search index is warming up. Please retry in a moment.' } as const;
  }

  const querySpec = buildPublicJobsQuerySpec({
    status: params.state.status,
    workModelRaw: params.state.workModelRaw,
    employmentTypeRaw: params.state.employmentTypeRaw,
    locationRaw: params.state.locationRaw,
    companyRaw: params.state.companyRaw,
    searchRaw: params.state.searchRaw,
    minSalary: params.state.minSalary,
    maxSalary: params.state.maxSalary,
    postedWithinHours: params.state.postedWithinHours,
    sortBy: params.state.sortBy,
    allowTextSearch,
  });

  const discoveredThresholdIso = new Date(
    Date.now() - (JOB_DISCOVERED_WINDOW_MINUTES * 60 * 1000),
  ).toISOString();

  return {
    querySpec,
    discoveredFilter: buildDiscoveredWindowFilter(querySpec.filter, discoveredThresholdIso),
    discoveredCountCacheKey: buildDiscoveredCountCacheKey({
      status: params.state.status,
      workModelRaw: params.state.workModelRaw,
      employmentTypeRaw: params.state.employmentTypeRaw,
      locationRaw: params.state.locationRaw,
      companyRaw: params.state.companyRaw,
      searchRaw: params.state.searchRaw,
      minSalary: Number.isFinite(params.state.minSalary) ? params.state.minSalary : '',
      maxSalary: Number.isFinite(params.state.maxSalary) ? params.state.maxSalary : '',
      postedWithinHours: Number.isFinite(params.state.postedWithinHours) ? params.state.postedWithinHours : '',
    }),
    recommendationProfilePromise: resolveCachedRecommendationProfile(params.db, params.state.currentUserId),
  } as const;
};

const loadPublicJobsPageData = async (params: {
  db: any;
  state: ReturnType<typeof parsePublicJobsRequestState>;
  querySpec: ReturnType<typeof buildPublicJobsQuerySpec>;
  discoveredFilter: Record<string, unknown>;
  discoveredCountCacheKey: string;
  recommendationProfilePromise: ReturnType<typeof resolveCachedRecommendationProfile>;
}) => {
  const [items, total, discoveredLast30Minutes, recommendationProfile] = await Promise.all([
    params.db.collection(JOBS_COLLECTION)
      .find(
        params.querySpec.filter,
        params.querySpec.usesTextSearch
          ? {
              projection: { score: { $meta: 'textScore' } },
            }
          : undefined,
      )
      .sort(params.querySpec.sort as any)
      .skip(params.state.pagination.skip)
      .limit(params.state.pagination.limit)
      .toArray(),
    params.db.collection(JOBS_COLLECTION).countDocuments(params.querySpec.filter),
    resolveCachedDiscoveredCount(params.db, params.discoveredFilter, params.discoveredCountCacheKey),
    params.recommendationProfilePromise,
  ]);

  return {
    items,
    total,
    discoveredLast30Minutes,
    recommendationProfile,
  };
};

const enrichPublicJobsRows = async (params: {
  db: any;
  items: any[];
  recommendationProfile: Awaited<ReturnType<typeof resolveCachedRecommendationProfile>>;
}) => {
  const jobsWithRecommendations = params.items.map((item) => {
    const base = toJobResponse(item);
    if (!params.recommendationProfile) return base;

    const recommendation = buildJobRecommendationScore(item, params.recommendationProfile);
    const roundedScore = Math.max(0, Math.round(recommendation.score));
    return {
      ...base,
      recommendationScore: roundedScore,
      recommendationReasons: recommendation.reasons.slice(0, 3),
      matchedSkills: recommendation.matchedSkills.slice(0, 5),
      recommendationBreakdown: recommendation.breakdown,
      matchTier: resolveRecommendationMatchTier(roundedScore),
    };
  });

  return attachHeatFieldsToJobResponses({
    db: params.db,
    jobs: jobsWithRecommendations,
  });
};

export const jobDiscoveryController = {
  // GET /api/jobs
  listPublicJobs: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 20, total: 0, pages: 0 },
        });
      }

      const db = getDB();
      const state = parsePublicJobsRequestState(req);
      const validationError = validatePublicJobsRequestState(state);
      if (validationError) {
        return res.status(400).json({ success: false, error: validationError });
      }

      const queryContext = await resolvePublicJobsQueryContext({ db, state });
      if ('error' in queryContext) {
        return res.status(503).json({
          success: false,
          error: queryContext.error,
        });
      }

      const pageData = await loadPublicJobsPageData({
        db,
        state,
        querySpec: queryContext.querySpec,
        discoveredFilter: queryContext.discoveredFilter,
        discoveredCountCacheKey: queryContext.discoveredCountCacheKey,
        recommendationProfilePromise: queryContext.recommendationProfilePromise,
      });

      const jobsWithHeat = await enrichPublicJobsRows({
        db,
        items: pageData.items,
        recommendationProfile: pageData.recommendationProfile,
      });

      return res.json({
        success: true,
        data: jobsWithHeat,
        meta: {
          discoveredLast30Minutes:
            Number.isFinite(pageData.discoveredLast30Minutes) && pageData.discoveredLast30Minutes > 0
              ? Number(pageData.discoveredLast30Minutes)
              : 0,
        },
        pagination: {
          page: state.pagination.page,
          limit: state.pagination.limit,
          total: pageData.total,
          pages: Math.ceil(pageData.total / state.pagination.limit),
        },
      });
    } catch (error) {
      console.error('List public jobs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
    }
  },

  // GET /api/jobs/salary-insights
  getSalaryInsights: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const jobTitle = readString((req.query as any).jobTitle, 140);
      const location = readString((req.query as any).location, 140);
      const currentJobId = readString((req.query as any).currentJobId, 120);
      if (!jobTitle || !location) {
        return res.status(400).json({ success: false, error: 'jobTitle and location are required' });
      }

      const db = getDB();
      const allowTextSearch = await ensureJobsTextIndex(db);
      if (!allowTextSearch) {
        return res.status(503).json({
          success: false,
          error: 'Search index is warming up. Please retry in a moment.',
        });
      }
      const normalizedTitle = jobTitle.toLowerCase();
      const normalizedLocation = location.toLowerCase();
      let safeCurrentJobId = '';
      if (currentJobId) {
        const currentJob = await db.collection(JOBS_COLLECTION).findOne(
          { id: currentJobId, status: 'open' },
          {
            projection: {
              id: 1,
              title: 1,
              locationText: 1,
            },
          },
        );
        const currentJobTitle = readString((currentJob as any)?.title, 140).toLowerCase();
        const currentJobLocation = readString((currentJob as any)?.locationText, 140).toLowerCase();
        if (currentJobTitle === normalizedTitle && currentJobLocation === normalizedLocation) {
          safeCurrentJobId = currentJobId;
        }
      }

      const searchText = `${jobTitle} ${location}`.trim();
      const missingMinSentinel = Number.MAX_SAFE_INTEGER;
      const missingMaxSentinel = -1;

      const [aggregated] = await db.collection(JOBS_COLLECTION)
        .aggregate([
          {
            $match: {
              ...(safeCurrentJobId ? { id: { $ne: safeCurrentJobId } } : {}),
              status: 'open',
              $text: { $search: searchText },
              $or: [
                { salaryMin: { $type: 'number' } },
                { salaryMax: { $type: 'number' } },
              ],
            },
          },
          {
            $group: {
              _id: null,
              sampleSize: { $sum: 1 },
              avgMin: {
                $avg: {
                  $cond: [{ $isNumber: '$salaryMin' }, '$salaryMin', null],
                },
              },
              avgMax: {
                $avg: {
                  $cond: [{ $isNumber: '$salaryMax' }, '$salaryMax', null],
                },
              },
              minSalaryCandidate: {
                $min: {
                  $cond: [{ $isNumber: '$salaryMin' }, '$salaryMin', missingMinSentinel],
                },
              },
              maxSalaryCandidate: {
                $max: {
                  $cond: [{ $isNumber: '$salaryMax' }, '$salaryMax', missingMaxSentinel],
                },
              },
            },
          },
          {
            $project: {
              sampleSize: 1,
              avgMin: 1,
              avgMax: 1,
              minSalary: {
                $cond: [{ $eq: ['$minSalaryCandidate', missingMinSentinel] }, null, '$minSalaryCandidate'],
              },
              maxSalary: {
                $cond: [{ $eq: ['$maxSalaryCandidate', missingMaxSentinel] }, null, '$maxSalaryCandidate'],
              },
            },
          },
        ])
        .toArray();

      const safeSampleSize = Number.isFinite(aggregated?.sampleSize) ? Number(aggregated.sampleSize) : 0;
      if (safeSampleSize < MIN_SALARY_INSIGHTS_SAMPLE_SIZE) {
        return res.json({
          success: true,
          data: {
            sampleSize: 0,
            avgMin: null,
            avgMax: null,
            minSalary: null,
            maxSalary: null,
          },
        });
      }

      return res.json({
        success: true,
        data: {
          sampleSize: safeSampleSize,
          avgMin: Number.isFinite(aggregated?.avgMin) ? Number(aggregated.avgMin) : null,
          avgMax: Number.isFinite(aggregated?.avgMax) ? Number(aggregated.avgMax) : null,
          minSalary: Number.isFinite(aggregated?.minSalary) ? Number(aggregated.minSalary) : null,
          maxSalary: Number.isFinite(aggregated?.maxSalary) ? Number(aggregated.maxSalary) : null,
        },
      });
    } catch (error) {
      console.error('Get salary insights error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch salary insights' });
    }
  },
};
