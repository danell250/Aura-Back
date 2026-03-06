import { buildRecommendationProfile } from './jobRecommendationService';

const USERS_COLLECTION = 'users';
const JOB_RECOMMENDATION_PROFILE_CACHE_TTL_MS = 60_000;
const JOB_RECOMMENDATION_PROFILE_CACHE_MAX_KEYS = 200;
const JOB_RECOMMENDATION_PROFILE_CACHE_CLEANUP_INTERVAL_MS = 60_000;

const recommendationProfileCache = new Map<string, { profile: ReturnType<typeof buildRecommendationProfile>; expiresAt: number }>();

const refreshRecommendationProfileCacheOrder = (
  currentUserId: string,
  entry: { profile: ReturnType<typeof buildRecommendationProfile>; expiresAt: number },
) => {
  recommendationProfileCache.delete(currentUserId);
  recommendationProfileCache.set(currentUserId, entry);
};

const pruneRecommendationProfileCache = (now: number) => {
  for (const [cacheKey, entry] of recommendationProfileCache.entries()) {
    if (entry.expiresAt <= now) {
      recommendationProfileCache.delete(cacheKey);
    }
  }
  while (recommendationProfileCache.size > JOB_RECOMMENDATION_PROFILE_CACHE_MAX_KEYS) {
    const oldestEntry = recommendationProfileCache.keys().next();
    if (oldestEntry.done) break;
    recommendationProfileCache.delete(oldestEntry.value);
  }
};

setInterval(() => {
  pruneRecommendationProfileCache(Date.now());
}, JOB_RECOMMENDATION_PROFILE_CACHE_CLEANUP_INTERVAL_MS).unref?.();

export const resolveCachedRecommendationProfile = async (
  db: any,
  currentUserId: string,
): Promise<ReturnType<typeof buildRecommendationProfile> | null> => {
  if (!currentUserId) return null;
  const now = Date.now();
  const cached = recommendationProfileCache.get(currentUserId);
  if (cached && cached.expiresAt > now) {
    refreshRecommendationProfileCacheOrder(currentUserId, cached);
    return cached.profile;
  }
  pruneRecommendationProfileCache(now);

  const recommendationUser = await db.collection(USERS_COLLECTION).findOne(
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
  if (!recommendationUser) {
    recommendationProfileCache.delete(currentUserId);
    return null;
  }

  const recommendationProfile = buildRecommendationProfile(recommendationUser);
  refreshRecommendationProfileCacheOrder(currentUserId, {
    profile: recommendationProfile,
    expiresAt: now + JOB_RECOMMENDATION_PROFILE_CACHE_TTL_MS,
  });
  pruneRecommendationProfileCache(now);
  return recommendationProfile;
};
