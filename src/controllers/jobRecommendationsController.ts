import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import {
  buildJobRecommendationScore,
  buildRecommendationCandidateFilter,
  buildRecommendationProfile,
} from '../services/jobRecommendationService';
import { parsePositiveInt, readString, readStringOrNull } from '../utils/inputSanitizers';

const JOBS_COLLECTION = 'jobs';
const USERS_COLLECTION = 'users';

type RecommendationPayload = {
  data: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

const toRecommendedJobResponse = (job: any) => ({
  id: String(job?.id || ''),
  slug: readString(job?.slug, 220),
  companyId: String(job?.companyId || ''),
  companyName: String(job?.companyName || ''),
  companyHandle: String(job?.companyHandle || ''),
  companyIsVerified: Boolean(job?.companyIsVerified),
  companyWebsite: readStringOrNull(job?.companyWebsite, 600),
  companyEmail: readStringOrNull(job?.companyEmail, 200),
  title: String(job?.title || ''),
  summary: String(job?.summary || ''),
  description: String(job?.description || ''),
  locationText: String(job?.locationText || ''),
  workModel: String(job?.workModel || 'onsite'),
  employmentType: String(job?.employmentType || 'full_time'),
  salaryMin: typeof job?.salaryMin === 'number' ? job.salaryMin : null,
  salaryMax: typeof job?.salaryMax === 'number' ? job.salaryMax : null,
  salaryCurrency: String(job?.salaryCurrency || ''),
  applicationDeadline: job?.applicationDeadline || null,
  status: String(job?.status || 'open'),
  tags: Array.isArray(job?.tags) ? job.tags : [],
  createdByUserId: String(job?.createdByUserId || ''),
  createdAt: job?.createdAt || null,
  updatedAt: job?.updatedAt || null,
  publishedAt: job?.publishedAt || null,
  announcementPostId: job?.announcementPostId || null,
  applicationUrl: readStringOrNull(job?.applicationUrl, 600),
  applicationEmail: readStringOrNull(job?.applicationEmail, 200),
  applicationCount: Number.isFinite(job?.applicationCount) ? Number(job.applicationCount) : 0,
});

const fetchRecommendationCandidateJobs = async (params: {
  db: any;
  recommendationCandidateFilter: Record<string, unknown>;
  candidateLimit: number;
}): Promise<any[]> => {
  const preferredConditions = Array.isArray((params.recommendationCandidateFilter as any)?.$or)
    ? ((params.recommendationCandidateFilter as any).$or as Array<Record<string, unknown>>)
    : [];

  if (preferredConditions.length === 0) {
    return params.db.collection(JOBS_COLLECTION)
      .find({ status: 'open' })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(params.candidateLimit)
      .toArray();
  }

  const coarseLimit = Math.min(1200, Math.max(params.candidateLimit * 4, 480));
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

const buildRecommendationPayload = (params: {
  candidateJobs: any[];
  recommendationProfile: ReturnType<typeof buildRecommendationProfile>;
  limit: number;
}): RecommendationPayload => {
  if (params.candidateJobs.length === 0) {
    return {
      data: [],
      pagination: { page: 1, limit: params.limit, total: 0, pages: 0 },
    };
  }

  const scoredJobs = params.candidateJobs.map((job) => {
    const scoreResult = buildJobRecommendationScore(job, params.recommendationProfile);
    return {
      job,
      ...scoreResult,
    };
  });

  const rankedMatches = scoredJobs
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.publishedTs - a.publishedTs));

  const selectedEntries = (rankedMatches.length > 0 ? rankedMatches : scoredJobs)
    .slice(0, params.limit);

  return {
    data: selectedEntries.map((entry) => ({
      ...toRecommendedJobResponse(entry.job),
      recommendationScore: entry.score,
      recommendationReasons: entry.reasons.slice(0, 3),
      matchedSkills: entry.matchedSkills.slice(0, 5),
    })),
    pagination: {
      page: 1,
      limit: params.limit,
      total: selectedEntries.length,
      pages: 1,
    },
  };
};

export const jobRecommendationsController = {
  // GET /api/jobs/recommended
  listRecommendedJobs: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 20, total: 0, pages: 0 },
        });
      }

      const currentUserId = readString((req.user as any)?.id, 120);
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const db = getDB();
      const limit = parsePositiveInt((req.query as any)?.limit, 20, 1, 40);
      const candidateLimit = parsePositiveInt((req.query as any)?.candidateLimit, 120, 40, 160);
      const user = await db.collection(USERS_COLLECTION).findOne(
        { id: currentUserId },
        {
          projection: {
            id: 1,
            skills: 1,
            profileSkills: 1,
            location: 1,
            country: 1,
            industry: 1,
          },
        },
      );

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const recommendationProfile = buildRecommendationProfile(user);
      const recommendationCandidateFilter = buildRecommendationCandidateFilter(recommendationProfile);
      const candidateJobs = await fetchRecommendationCandidateJobs({
        db,
        recommendationCandidateFilter,
        candidateLimit,
      });

      const payload = buildRecommendationPayload({
        candidateJobs,
        recommendationProfile,
        limit,
      });

      return res.json({
        success: true,
        ...payload,
      });
    } catch (error) {
      console.error('List recommended jobs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch recommended jobs' });
    }
  },
};
