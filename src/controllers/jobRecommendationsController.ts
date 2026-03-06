import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import {
  buildRecommendationCandidateCriteria,
  buildRecommendationProfile,
  type RecommendationScoreBreakdown,
  type RecommendationMatchTier,
} from '../services/jobRecommendationService';
import { buildRecommendationCandidateMongoFilter } from '../services/jobRecommendationQueryBuilder';
import {
  buildRankedRecommendationEntries,
  fetchPrioritizedRecommendationCandidateJobs,
} from '../services/jobRecommendationResultService';
import { buildJobHeatResponseFields, listJobPulseSnapshots } from '../services/jobPulseSnapshotService';
import { toJobResponse } from '../services/jobResponseService';
import { parsePositiveInt, readString } from '../utils/inputSanitizers';

const USERS_COLLECTION = 'users';

type RecommendationPayload = {
  data: any[];
  groups: Record<RecommendationMatchTier, number>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

const normalizePreviewSkills = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item || '').split(','))
      .map((item) => readString(item, 80))
      .filter((item) => item.length > 0)
      .slice(0, 20);
  }

  return readString(value, 400)
    .split(',')
    .map((item) => readString(item, 80))
    .filter((item) => item.length > 0)
    .slice(0, 20);
};

const toRecommendationResponseEntry = (
  job: any,
  recommendation: {
    score: number;
    reasons: string[];
    matchedSkills: string[];
    breakdown: RecommendationScoreBreakdown;
    matchTier: RecommendationMatchTier;
  },
) => ({
  ...toJobResponse(job),
  recommendationScore: recommendation.score,
  recommendationReasons: recommendation.reasons.slice(0, 3),
  matchedSkills: recommendation.matchedSkills.slice(0, 5),
  recommendationBreakdown: recommendation.breakdown,
  matchTier: recommendation.matchTier,
});

const buildRecommendationPayload = async (params: {
  db: any;
  candidateJobs: any[];
  recommendationProfile: ReturnType<typeof buildRecommendationProfile>;
  limit: number;
}): Promise<RecommendationPayload> => {
  if (params.candidateJobs.length === 0) {
    return {
      data: [],
      groups: { best: 0, good: 0, other: 0 },
      pagination: { page: 1, limit: params.limit, total: 0, pages: 0 },
    };
  }

  const { entries, groups } = await buildRankedRecommendationEntries({
    candidateJobs: params.candidateJobs,
    recommendationProfile: params.recommendationProfile,
    limit: params.limit,
  });
  const pulseSnapshotsByJobId = new Map(
    (
      await listJobPulseSnapshots({
        db: params.db,
        requestedJobIds: entries.map((entry) => readString(entry?.job?.id, 120)).filter((jobId) => jobId.length > 0),
        limit: entries.length,
      })
    ).map((snapshot) => [readString(snapshot?.jobId, 120), snapshot] as const),
  );

  return {
    data: entries.map((entry) => {
      const score = Math.max(0, Math.round(entry.score));
      return {
        ...toRecommendationResponseEntry(entry.job, {
          score,
          reasons: entry.reasons,
          matchedSkills: entry.matchedSkills,
          breakdown: entry.breakdown,
          matchTier: entry.matchTier,
        }),
        ...buildJobHeatResponseFields({ snapshot: pulseSnapshotsByJobId.get(readString(entry?.job?.id, 120)) }),
      };
    }),
    groups,
    pagination: {
      page: 1,
      limit: params.limit,
      total: entries.length,
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
      const candidateLimit = parsePositiveInt((req.query as any)?.candidateLimit, 80, 30, 90);
      const user = await db.collection(USERS_COLLECTION).findOne(
        { id: currentUserId },
        {
          projection: {
            id: 1,
            title: 1,
            skills: 1,
            profileSkills: 1,
            location: 1,
            country: 1,
            industry: 1,
            remotePreference: 1,
            workPreference: 1,
            preferredWorkModel: 1,
            preferredWorkModels: 1,
            workPreferences: 1,
            experienceLevel: 1,
            seniority: 1,
            roleLevel: 1,
            jobSeniorityPreference: 1,
            yearsOfExperience: 1,
            experienceYears: 1,
            totalExperienceYears: 1,
          },
        },
      );

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const recommendationProfile = buildRecommendationProfile(user);
      const recommendationCandidateCriteria = buildRecommendationCandidateCriteria(recommendationProfile);
      const recommendationCandidateFilter = buildRecommendationCandidateMongoFilter(recommendationCandidateCriteria);
      const candidateJobs = await fetchPrioritizedRecommendationCandidateJobs({
        db,
        recommendationCandidateFilter,
        candidateLimit,
        hasPrioritySignals:
          recommendationCandidateCriteria.skillTokens.length > 0
          || recommendationCandidateCriteria.semanticTokens.length > 0
          || recommendationCandidateCriteria.preferredWorkModels.length > 0,
      });

      const payload = await buildRecommendationPayload({
        db,
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

  // GET /api/jobs/for-you
  listPreviewJobs: async (req: Request, res: Response) => {
    try {
      const role = readString((req.query as any)?.role, 120);
      const location = readString((req.query as any)?.location, 120);
      const workModel = readString((req.query as any)?.workModel, 40).toLowerCase();
      const skills = normalizePreviewSkills((req.query as any)?.skills);
      const limit = parsePositiveInt((req.query as any)?.limit, 20, 1, 30);
      const candidateLimit = parsePositiveInt((req.query as any)?.candidateLimit, 80, 30, 90);

      if (!role && !location && !workModel && skills.length === 0) {
        return res.status(400).json({ success: false, error: 'At least one preview signal is required' });
      }

      if (!isDBConnected()) {
        return res.status(503).json({
          success: false,
          error: 'Preview recommendations are temporarily unavailable',
        });
      }

      const db = getDB();
      const recommendationProfile = buildRecommendationProfile({
        title: role,
        skills,
        location,
        preferredWorkModels: workModel ? [workModel] : [],
      });
      const recommendationCandidateCriteria = buildRecommendationCandidateCriteria(recommendationProfile);
      const recommendationCandidateFilter = buildRecommendationCandidateMongoFilter(recommendationCandidateCriteria);
      const candidateJobs = await fetchPrioritizedRecommendationCandidateJobs({
        db,
        recommendationCandidateFilter,
        candidateLimit,
        hasPrioritySignals:
          recommendationCandidateCriteria.skillTokens.length > 0
          || recommendationCandidateCriteria.semanticTokens.length > 0
          || recommendationCandidateCriteria.preferredWorkModels.length > 0,
      });
      const payload = await buildRecommendationPayload({
        db,
        candidateJobs,
        recommendationProfile,
        limit,
      });

      return res.json({
        success: true,
        ...payload,
        meta: {
          preview: {
            role,
            location,
            workModel: workModel || null,
            skills,
            requiresSignupForSaveAndApply: true,
          },
        },
      });
    } catch (error) {
      console.error('List preview jobs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch preview jobs' });
    }
  },
};
