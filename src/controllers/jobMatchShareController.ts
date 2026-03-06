import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { attachHeatFieldsToJobResponses, toJobResponse } from '../services/jobResponseService';
import { listTopJobMatchesForUser } from '../services/reverseJobMatchService';
import { parsePositiveInt, readString } from '../utils/inputSanitizers';

const USERS_COLLECTION = 'users';
const AURA_PUBLIC_WEB_BASE_URL = (
  readString(process.env.AURA_PUBLIC_WEB_URL, 320)
  || readString(process.env.FRONTEND_URL, 320)
  || readString(process.env.VITE_FRONTEND_URL, 320)
  || 'https://aura.social'
).replace(/\/+$/, '');
const PUBLIC_MATCH_PROFILE_CACHE_TTL_MS = 5 * 60_000;
const PUBLIC_MATCH_PROFILE_CACHE_MAX_KEYS = 500;

const publicMatchProfileCache = new Map<string, {
  expiresAt: number;
  profile: ReturnType<typeof buildPublicMatchProfile>;
}>();

const buildPublicMatchProfile = (user: any) => ({
  id: readString(user?.id, 120),
  handle: readString(user?.handle, 120),
  firstName: readString(user?.firstName, 120),
  name: readString(user?.name, 160),
  title: readString(user?.title, 160),
  skills: Array.isArray(user?.skills) ? user.skills.slice(0, 80) : [],
  profileSkills: Array.isArray(user?.profileSkills) ? user.profileSkills.slice(0, 80) : [],
  location: readString(user?.location, 160),
  country: readString(user?.country, 120),
  industry: readString(user?.industry, 120),
  remotePreference: readString(user?.remotePreference, 60),
  workPreference: readString(user?.workPreference, 60),
  preferredWorkModel: readString(user?.preferredWorkModel, 60),
  preferredWorkModels: Array.isArray(user?.preferredWorkModels) ? user.preferredWorkModels.slice(0, 8) : [],
  workPreferences: Array.isArray(user?.workPreferences) ? user.workPreferences.slice(0, 8) : [],
  experienceLevel: readString(user?.experienceLevel, 60),
  seniority: readString(user?.seniority, 60),
  roleLevel: readString(user?.roleLevel, 60),
  jobSeniorityPreference: readString(user?.jobSeniorityPreference, 60),
  yearsOfExperience: Number.isFinite(Number(user?.yearsOfExperience)) ? Number(user.yearsOfExperience) : undefined,
  experienceYears: Number.isFinite(Number(user?.experienceYears)) ? Number(user.experienceYears) : undefined,
  totalExperienceYears: Number.isFinite(Number(user?.totalExperienceYears)) ? Number(user.totalExperienceYears) : undefined,
});

const prunePublicMatchProfileCache = (now: number): void => {
  const expiredKeys: string[] = [];
  for (const [key, entry] of publicMatchProfileCache.entries()) {
    if (entry.expiresAt <= now) {
      expiredKeys.push(key);
    }
  }
  for (const key of expiredKeys) {
    publicMatchProfileCache.delete(key);
  }

  const overflowCount = publicMatchProfileCache.size - PUBLIC_MATCH_PROFILE_CACHE_MAX_KEYS;
  if (overflowCount <= 0) {
    return;
  }

  let trimmedCount = 0;
  while (trimmedCount < overflowCount) {
    const oldestKey = publicMatchProfileCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    publicMatchProfileCache.delete(oldestKey);
    trimmedCount += 1;
  }
};

const getCachedPublicMatchProfile = (user: any): ReturnType<typeof buildPublicMatchProfile> => {
  const cacheUserId = readString(user?.id, 120);
  const cacheUpdatedAt = readString(user?.updatedAt, 80) || '0';
  const cacheKey = `${cacheUserId}:${cacheUpdatedAt}`;
  const now = Date.now();
  prunePublicMatchProfileCache(now);
  const cached = publicMatchProfileCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.profile;
  }

  const profile = buildPublicMatchProfile(user);
  if (cacheUserId) {
    publicMatchProfileCache.set(cacheKey, {
      expiresAt: now + PUBLIC_MATCH_PROFILE_CACHE_TTL_MS,
      profile,
    });
    prunePublicMatchProfileCache(now);
  }
  return profile;
};

export const jobMatchShareController = {
  // GET /api/jobs/matches/:handle
  getPublicJobMatchesByHandle: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const rawHandle = readString(req.params.handle, 120).replace(/^@+/, '');
      if (!rawHandle) {
        return res.status(400).json({ success: false, error: 'Handle is required' });
      }

      const db = getDB();
      const requestedHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
      const sharedUser = await db.collection(USERS_COLLECTION).findOne(
        {
          handle: { $in: [rawHandle, requestedHandle] },
          jobMatchShareEnabled: true,
        },
        {
          collation: { locale: 'en', strength: 2 },
          projection: {
            id: 1,
            handle: 1,
            firstName: 1,
            name: 1,
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
            updatedAt: 1,
          },
        },
      );

      if (!sharedUser) {
        return res.status(404).json({ success: false, error: 'User not found or public matches are disabled' });
      }

      const publicMatchProfile = getCachedPublicMatchProfile(sharedUser);
      if (!publicMatchProfile.id) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const limit = parsePositiveInt((req.query as any)?.limit, 20, 1, 40);
      const matchedJobs = await listTopJobMatchesForUser({
        db,
        user: publicMatchProfile,
        limit,
        recordPulse: false,
      });

      const normalizedHandle = publicMatchProfile.handle || `@${rawHandle.toLowerCase()}`;
      const matchedJobsWithHeat = await attachHeatFieldsToJobResponses({
        db,
        jobs: matchedJobs.map((job) => ({
          ...toJobResponse(job),
          recommendationScore:
            Number.isFinite((job as any)?.recommendationScore) && Number((job as any)?.recommendationScore) > 0
              ? Number((job as any).recommendationScore)
              : 0,
          recommendationReasons: Array.isArray((job as any)?.recommendationReasons)
            ? (job as any).recommendationReasons.slice(0, 3)
            : [],
          matchedSkills: Array.isArray((job as any)?.matchedSkills)
            ? (job as any).matchedSkills.slice(0, 5)
            : [],
          recommendationBreakdown:
            (job as any)?.recommendationBreakdown && typeof (job as any)?.recommendationBreakdown === 'object'
              ? (job as any).recommendationBreakdown
              : undefined,
          matchTier:
            (job as any)?.matchTier === 'best' || (job as any)?.matchTier === 'good' || (job as any)?.matchTier === 'other'
              ? (job as any).matchTier
              : 'other',
        })),
      });

      return res.json({
        success: true,
        data: matchedJobsWithHeat,
        meta: {
          user: {
            id: publicMatchProfile.id,
            handle: normalizedHandle,
            name: publicMatchProfile.name || publicMatchProfile.firstName || normalizedHandle,
          },
          shareUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs/${encodeURIComponent(normalizedHandle)}`,
        },
      });
    } catch (error) {
      console.error('Get public job matches by handle error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch public job matches' });
    }
  },
};
