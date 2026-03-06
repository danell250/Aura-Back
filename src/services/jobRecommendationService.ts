import { readString } from '../utils/inputSanitizers';

const RECOMMENDATION_WEIGHTS = {
  skillPerMatch: 16,
  skillCap: 48,
  rolePerMatch: 14,
  roleCap: 28,
  remoteBonus: 18,
  workModelPreferenceBonus: 14,
  experienceDirectBonus: 10,
  experienceNearBonus: 5,
  locationBonus: 24,
  industryPerMatch: 6,
  industryCap: 12,
  salarySignalBonus: 2,
  freshnessDay1Bonus: 8,
  freshnessWeekBonus: 6,
  freshnessMonthBonus: 3,
} as const;
const RECOMMENDATION_METADATA_CACHE_MAX_KEYS = 1500;
const RECOMMENDATION_PROFILE_CACHE_MAX_KEYS = 1000;

export const MATCH_TIER_BEST_MIN_SCORE = 70;
export const MATCH_TIER_GOOD_MIN_SCORE = 40;
export type RecommendationMatchTier = 'best' | 'good' | 'other';
const recommendationMetadataCache = new Map<string, JobRecommendationMetadata>();
const recommendationProfileCache = new Map<string, RecommendationProfile>();

export const resolveRecommendationMatchTier = (score: number): RecommendationMatchTier => {
  if (score >= MATCH_TIER_BEST_MIN_SCORE) return 'best';
  if (score >= MATCH_TIER_GOOD_MIN_SCORE) return 'good';
  return 'other';
};

const normalizeRecommendationToken = (value: unknown, maxLength = 100): string => {
  const normalized = readString(String(value || ''), maxLength)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+.#\-/\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
};

const tokenizeRecommendationText = (value: unknown, maxTokens = 120): string[] => {
  const normalized = normalizeRecommendationToken(value, 800);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, maxTokens);
};

const readRecommendationSkillTokens = (value: unknown, maxItems = 80): string[] => {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    const normalized = normalizeRecommendationToken(item, 80);
    if (!normalized || dedupe.has(normalized)) continue;
    dedupe.add(normalized);
    next.push(normalized);
    if (next.length >= maxItems) break;
  }
  return next;
};

const readRecommendationTokenArray = (value: unknown, maxItems = 320): string[] => {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    const normalized = normalizeRecommendationToken(item, 120);
    if (!normalized || dedupe.has(normalized)) continue;
    dedupe.add(normalized);
    next.push(normalized);
    if (next.length >= maxItems) break;
  }
  return next;
};

const readRecommendationSkillLabelMap = (value: unknown): Map<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map<string, string>();
  }
  const next = new Map<string, string>();
  for (const [rawToken, rawLabel] of Object.entries(value as Record<string, unknown>)) {
    const token = normalizeRecommendationToken(rawToken, 120);
    const label = readString(rawLabel, 120);
    if (!token || !label || next.has(token)) continue;
    next.set(token, label);
  }
  return next;
};

export type RecommendationWorkModel = 'onsite' | 'hybrid' | 'remote';
type RecommendationExperienceLevel = 'junior' | 'mid' | 'senior' | 'lead';

const normalizeWorkModelPreference = (value: unknown): RecommendationWorkModel | null => {
  const normalized = readString(value, 40).toLowerCase();
  if (normalized === 'remote') return 'remote';
  if (normalized === 'hybrid') return 'hybrid';
  if (normalized === 'onsite' || normalized === 'on_site' || normalized === 'on-site') return 'onsite';
  return null;
};

const readPreferredWorkModels = (user: any): Set<RecommendationWorkModel> => {
  const candidates: unknown[] = [];
  const listFields = [
    (user as any)?.preferredWorkModels,
    (user as any)?.workPreferences,
    (user as any)?.jobWorkModels,
  ];
  for (const field of listFields) {
    if (!Array.isArray(field)) continue;
    candidates.push(...field);
  }
  candidates.push(
    (user as any)?.preferredWorkModel,
    (user as any)?.workPreference,
    (user as any)?.remotePreference,
  );

  const next = new Set<RecommendationWorkModel>();
  for (const value of candidates) {
    const normalized = normalizeWorkModelPreference(value);
    if (normalized) next.add(normalized);
  }
  return next;
};

const parseFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const normalizeExperienceLevel = (value: unknown): RecommendationExperienceLevel | null => {
  const normalized = readString(value, 60).toLowerCase();
  if (!normalized) return null;
  if (
    normalized.includes('lead')
    || normalized.includes('principal')
    || normalized.includes('staff')
    || normalized.includes('director')
    || normalized.includes('vp')
  ) {
    return 'lead';
  }
  if (normalized.includes('senior') || normalized === 'sr' || normalized.startsWith('sr ')) {
    return 'senior';
  }
  if (normalized.includes('mid') || normalized.includes('intermediate')) {
    return 'mid';
  }
  if (
    normalized.includes('junior')
    || normalized.includes('entry')
    || normalized.includes('graduate')
    || normalized.includes('intern')
  ) {
    return 'junior';
  }
  return null;
};

const inferExperienceLevelFromYears = (years: number | null): RecommendationExperienceLevel | null => {
  if (years == null || years < 0) return null;
  if (years <= 2) return 'junior';
  if (years <= 5) return 'mid';
  if (years <= 9) return 'senior';
  return 'lead';
};

const resolveExperienceLevel = (user: any): RecommendationExperienceLevel | null => {
  const explicit = normalizeExperienceLevel(
    (user as any)?.experienceLevel
      || (user as any)?.seniority
      || (user as any)?.roleLevel
      || (user as any)?.jobSeniorityPreference,
  );
  if (explicit) return explicit;

  const years = parseFiniteNumber(
    (user as any)?.yearsOfExperience
      ?? (user as any)?.experienceYears
      ?? (user as any)?.totalExperienceYears,
  );
  return inferExperienceLevelFromYears(years);
};

const inferJobExperienceLevel = (job: any): RecommendationExperienceLevel | null => {
  const semanticText = normalizeRecommendationToken(
    `${readString(job?.title, 120)} ${readString(job?.summary, 220)} ${readString(job?.description, 1200)}`,
    1800,
  );
  if (!semanticText) return null;

  if (
    /\b(principal|staff|head|director|vp|lead)\b/.test(semanticText)
  ) {
    return 'lead';
  }
  if (/\b(senior|sr)\b/.test(semanticText)) {
    return 'senior';
  }
  if (/\b(mid|intermediate)\b/.test(semanticText)) {
    return 'mid';
  }
  if (/\b(junior|entry level|entry-level|graduate|intern)\b/.test(semanticText)) {
    return 'junior';
  }

  return null;
};

const countSetIntersection = <T>(source: Set<T>, target: Set<T>): number => {
  if (source.size === 0 || target.size === 0) return 0;
  let count = 0;
  for (const token of source) {
    if (target.has(token)) count += 1;
  }
  return count;
};

export type RecommendationProfile = {
  skillTokens: Set<string>;
  roleTokens: Set<string>;
  locationTokens: Set<string>;
  industryTokens: Set<string>;
  preferredWorkModels: Set<RecommendationWorkModel>;
  experienceLevel: RecommendationExperienceLevel | null;
};

export type RecommendationCandidateCriteria = {
  status: 'open';
  skillTokens: string[];
  semanticTokens: string[];
  preferredWorkModels: RecommendationWorkModel[];
};

export type RecommendationScoreBreakdown = {
  skills: number;
  role: number;
  remote: number;
  workModel: number;
  location: number;
  experience: number;
  industry: number;
  salarySignal: number;
  freshness: number;
};

export type RecommendationScoreResult = {
  score: number;
  reasons: string[];
  matchedSkills: string[];
  publishedTs: number;
  breakdown: RecommendationScoreBreakdown;
};

type RecommendationSignalResult = {
  score: number;
  reason?: string;
  matchedSkills?: string[];
};

type RecommendationSignalRun = {
  key: keyof RecommendationScoreBreakdown;
  signal: () => RecommendationSignalResult;
};

type JobRecommendationMetadata = {
  skillLabelByToken: Map<string, string>;
  locationTokens: Set<string>;
  semanticTokens: Set<string>;
  publishedTs: number;
  hasSalarySignal: boolean;
  isRemoteRole: boolean;
  workModel: RecommendationWorkModel;
  inferredExperienceLevel: RecommendationExperienceLevel | null;
};

const buildRecommendationSkillMap = (job: any): Map<string, string> => {
  let skillLabelByToken = readRecommendationSkillLabelMap(job?.recommendationSkillLabelByToken);
  if (skillLabelByToken.size === 0) {
    skillLabelByToken = new Map<string, string>();
    for (const tag of Array.isArray(job?.tags) ? job.tags : []) {
      const label = readString(tag, 80);
      const normalized = normalizeRecommendationToken(label, 80);
      if (!label || !normalized || skillLabelByToken.has(normalized)) continue;
      skillLabelByToken.set(normalized, label);
    }
  }
  return skillLabelByToken;
};

const buildRecommendationLocationTokens = (job: any): Set<string> => {
  const storedLocationTokens = readRecommendationTokenArray(job?.recommendationLocationTokens, 40);
  return new Set<string>(
    storedLocationTokens.length > 0
      ? storedLocationTokens
      : tokenizeRecommendationText(job?.locationText, 20).filter((token) => token.length >= 3),
  );
};

const buildRecommendationSemanticTokens = (job: any): Set<string> => {
  const storedSemanticTokens = readRecommendationTokenArray(job?.recommendationSemanticTokens, 320);
  return new Set<string>(
    storedSemanticTokens.length > 0
      ? storedSemanticTokens
      : tokenizeRecommendationText(
          `${readString(job?.title, 120)} ${readString(job?.summary, 220)} ${readString(job?.description, 1200)}`,
          260,
        ).filter((token) => token.length >= 3),
  );
};

const resolveRecommendationPublishedTs = (job: any): number => {
  const storedPublishedTs = Number(job?.recommendationPublishedTs);
  const publishedAtRaw = readString(job?.publishedAt, 80) || readString(job?.createdAt, 80);
  const publishedAtTs = publishedAtRaw ? new Date(publishedAtRaw).getTime() : 0;
  return Number.isFinite(storedPublishedTs)
    ? storedPublishedTs
    : (Number.isFinite(publishedAtTs) ? publishedAtTs : 0);
};

const resolveRecommendationHasSalarySignal = (job: any): boolean => {
  const storedHasSalarySignal = (job as any)?.recommendationHasSalarySignal;
  return typeof storedHasSalarySignal === 'boolean'
    ? storedHasSalarySignal
    : (typeof job?.salaryMin === 'number' || typeof job?.salaryMax === 'number');
};

const resolveRecommendationIsRemoteRole = (job: any): boolean => {
  const storedIsRemoteRole = (job as any)?.recommendationIsRemoteRole;
  return typeof storedIsRemoteRole === 'boolean'
    ? storedIsRemoteRole
    : (String(job?.workModel || '').toLowerCase() === 'remote');
};

const buildRecommendationMetadataCacheKey = (job: any): string => {
  const jobId = typeof job?.id === 'string' ? job.id.trim() : '';
  if (!jobId) return '';
  const versionStamp = [
    typeof job?.updatedAt === 'string' ? job.updatedAt.trim() : '',
    typeof job?.publishedAt === 'string' ? job.publishedAt.trim() : '',
    typeof job?.createdAt === 'string' ? job.createdAt.trim() : '',
  ].find((value) => value.length > 0);
  if (!versionStamp) return '';
  return `job-id=${jobId}::version=${versionStamp}`;
};

const buildRecommendationProfileCacheKey = (user: any): string => {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  if (!userId) return '';

  const versionStamp = [
    typeof user?.updatedAt === 'string' ? user.updatedAt.trim() : '',
    typeof user?.createdAt === 'string' ? user.createdAt.trim() : '',
  ].find((value) => value.length > 0) || 'profile-static';

  return `user-id=${userId}::version=${versionStamp}`;
};

const storeRecommendationMetadataCacheEntry = (
  cacheKey: string,
  metadata: JobRecommendationMetadata,
) => {
  if (!cacheKey) return;

  recommendationMetadataCache.delete(cacheKey);
  recommendationMetadataCache.set(cacheKey, metadata);

  if (recommendationMetadataCache.size > RECOMMENDATION_METADATA_CACHE_MAX_KEYS) {
    const oldestCacheKey = recommendationMetadataCache.keys().next().value as string | undefined;
    if (oldestCacheKey) {
      recommendationMetadataCache.delete(oldestCacheKey);
    }
  }
};

const storeRecommendationProfileCacheEntry = (
  cacheKey: string,
  profile: RecommendationProfile,
) => {
  if (!cacheKey) return;

  recommendationProfileCache.delete(cacheKey);
  recommendationProfileCache.set(cacheKey, profile);

  if (recommendationProfileCache.size > RECOMMENDATION_PROFILE_CACHE_MAX_KEYS) {
    const oldestCacheKey = recommendationProfileCache.keys().next().value as string | undefined;
    if (oldestCacheKey) {
      recommendationProfileCache.delete(oldestCacheKey);
    }
  }
};

const buildJobRecommendationMetadata = (job: any): JobRecommendationMetadata => {
  const cacheKey = buildRecommendationMetadataCacheKey(job);
  const cachedMetadata = cacheKey ? recommendationMetadataCache.get(cacheKey) : undefined;
  if (cachedMetadata) {
    recommendationMetadataCache.delete(cacheKey);
    recommendationMetadataCache.set(cacheKey, cachedMetadata);
    return cachedMetadata;
  }

  const skillLabelByToken = buildRecommendationSkillMap(job);
  const locationTokens = buildRecommendationLocationTokens(job);
  const semanticTokens = buildRecommendationSemanticTokens(job);
  const publishedTs = resolveRecommendationPublishedTs(job);
  const hasSalarySignal = resolveRecommendationHasSalarySignal(job);
  const isRemoteRole = resolveRecommendationIsRemoteRole(job);
  const workModel = normalizeWorkModelPreference(job?.workModel) || (isRemoteRole ? 'remote' : 'onsite');
  const inferredExperienceLevel = inferJobExperienceLevel(job);

  const metadata = {
    skillLabelByToken,
    locationTokens,
    semanticTokens,
    publishedTs,
    hasSalarySignal,
    isRemoteRole,
    workModel,
    inferredExperienceLevel,
  };
  storeRecommendationMetadataCacheEntry(cacheKey, metadata);
  return metadata;
};

type RecommendationPrecomputeSource = {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  description?: unknown;
  locationText?: unknown;
  tags?: unknown;
  workModel?: unknown;
  salaryMin?: unknown;
  salaryMax?: unknown;
  createdAt?: unknown;
  publishedAt?: unknown;
};

export const buildJobRecommendationPrecomputedFields = (
  source: RecommendationPrecomputeSource,
): Record<string, unknown> => {
  const recommendationSkillLabelByToken: Record<string, string> = {};
  for (const tag of Array.isArray(source?.tags) ? source.tags : []) {
    const label = readString(tag, 80);
    const normalized = normalizeRecommendationToken(label, 80);
    if (!label || !normalized || recommendationSkillLabelByToken[normalized]) continue;
    recommendationSkillLabelByToken[normalized] = label;
  }

  const recommendationLocationTokens = tokenizeRecommendationText(source?.locationText, 20)
    .filter((token) => token.length >= 3)
    .slice(0, 40);

  const semanticText = `${readString(source?.title, 120)} ${readString(source?.summary, 220)} ${readString(source?.description, 1200)}`;
  const recommendationSemanticTokens = tokenizeRecommendationText(semanticText, 260)
    .filter((token) => token.length >= 3)
    .slice(0, 320);

  const publishedAtRaw = readString(source?.publishedAt, 80) || readString(source?.createdAt, 80);
  const publishedAtTs = publishedAtRaw ? new Date(publishedAtRaw).getTime() : 0;
  const recommendationPublishedTs = Number.isFinite(publishedAtTs) ? publishedAtTs : 0;

  return {
    recommendationSkillLabelByToken,
    recommendationLocationTokens,
    recommendationSemanticTokens,
    recommendationPublishedTs,
    recommendationHasSalarySignal:
      typeof source?.salaryMin === 'number' || typeof source?.salaryMax === 'number',
    recommendationIsRemoteRole: String(source?.workModel || '').toLowerCase() === 'remote',
  };
};


export const buildRecommendationProfile = (user: any): RecommendationProfile => {
  const cacheKey = buildRecommendationProfileCacheKey(user);
  const cachedProfile = cacheKey ? recommendationProfileCache.get(cacheKey) : undefined;
  if (cachedProfile) {
    recommendationProfileCache.delete(cacheKey);
    recommendationProfileCache.set(cacheKey, cachedProfile);
    return cachedProfile;
  }

  const skillTokens = new Set<string>([
    ...readRecommendationSkillTokens((user as any)?.skills, 80),
    ...readRecommendationSkillTokens((user as any)?.profileSkills, 80),
  ]);
  const roleTokens = new Set<string>(
    tokenizeRecommendationText(
      (user as any)?.title
        || (user as any)?.role
        || (user as any)?.desiredRole
        || (user as any)?.jobTitle,
      20,
    ).filter((token) => token.length >= 3),
  );

  const locationTokens = new Set<string>([
    ...tokenizeRecommendationText((user as any)?.location, 20).filter((token) => token.length >= 3),
    ...tokenizeRecommendationText((user as any)?.country, 8).filter((token) => token.length >= 3),
  ]);

  const industryTokens = new Set<string>(
    tokenizeRecommendationText((user as any)?.industry, 20).filter((token) => token.length >= 3),
  );
  const preferredWorkModels = readPreferredWorkModels(user);
  const experienceLevel = resolveExperienceLevel(user);

  const profile = {
    skillTokens,
    roleTokens,
    locationTokens,
    industryTokens,
    preferredWorkModels,
    experienceLevel,
  };
  storeRecommendationProfileCacheEntry(cacheKey, profile);
  return profile;
};

export const buildRecommendationCandidateCriteria = (
  profile: RecommendationProfile,
): RecommendationCandidateCriteria => {
  const skillTokens = Array.from(profile.skillTokens).slice(0, 20);
  const semanticTokens = Array.from(
    new Set([
      ...Array.from(profile.roleTokens),
      ...Array.from(profile.industryTokens),
    ]),
  ).slice(0, 16);
  const preferredWorkModels = Array.from(profile.preferredWorkModels);

  return {
    status: 'open',
    skillTokens,
    semanticTokens,
    preferredWorkModels,
  };
};

const scoreSkillMatch = (
  metadata: JobRecommendationMetadata,
  profile: RecommendationProfile,
): { score: number; matchedSkills: string[]; reason?: string } => {
  const matchedSkills: string[] = [];
  for (const [token, label] of metadata.skillLabelByToken.entries()) {
    if (profile.skillTokens.has(token)) matchedSkills.push(label);
  }
  if (matchedSkills.length === 0) {
    return { score: 0, matchedSkills };
  }

  return {
    score: Math.min(
      RECOMMENDATION_WEIGHTS.skillCap,
      matchedSkills.length * RECOMMENDATION_WEIGHTS.skillPerMatch,
    ),
    matchedSkills,
    reason: `${matchedSkills.length} skill match${matchedSkills.length === 1 ? '' : 'es'}`,
  };
};

const scoreRoleAlignment = (
  metadata: JobRecommendationMetadata,
  profile: RecommendationProfile,
): { score: number; reason?: string } => {
  if (profile.roleTokens.size === 0) return { score: 0 };

  const roleMatchCount = countSetIntersection(profile.roleTokens, metadata.semanticTokens);
  if (roleMatchCount === 0) return { score: 0 };

  return {
    score: Math.min(
      RECOMMENDATION_WEIGHTS.roleCap,
      roleMatchCount * RECOMMENDATION_WEIGHTS.rolePerMatch,
    ),
    reason: 'Role fit aligned',
  };
};

const scoreRemoteRole = (
  metadata: JobRecommendationMetadata,
  profile: RecommendationProfile,
): { score: number; reason?: string } => {
  if (!metadata.isRemoteRole) return { score: 0 };
  if (
    profile.preferredWorkModels.size > 0
    && !profile.preferredWorkModels.has('remote')
  ) {
    return { score: 0 };
  }
  return {
    score: RECOMMENDATION_WEIGHTS.remoteBonus,
    reason: 'Remote role',
  };
};

const scoreWorkModelPreference = (
  metadata: JobRecommendationMetadata,
  profile: RecommendationProfile,
): { score: number; reason?: string } => {
  if (profile.preferredWorkModels.size === 0) return { score: 0 };
  if (!profile.preferredWorkModels.has(metadata.workModel)) return { score: 0 };
  return {
    score: RECOMMENDATION_WEIGHTS.workModelPreferenceBonus,
    reason: 'Work model preference matched',
  };
};

const scoreLocationAlignment = (
  metadata: JobRecommendationMetadata,
  profile: RecommendationProfile,
): { score: number; reason?: string } => {
  const locationMatchCount = countSetIntersection(profile.locationTokens, metadata.locationTokens);
  if (locationMatchCount === 0) return { score: 0 };
  return {
    score: RECOMMENDATION_WEIGHTS.locationBonus,
    reason: 'Location aligned',
  };
};

const scoreIndustryAlignment = (
  metadata: JobRecommendationMetadata,
  profile: RecommendationProfile,
): { score: number; reason?: string } => {
  if (profile.industryTokens.size === 0) return { score: 0 };
  const industryMatchCount = countSetIntersection(profile.industryTokens, metadata.semanticTokens);
  if (industryMatchCount === 0) return { score: 0 };
  return {
    score: Math.min(
      RECOMMENDATION_WEIGHTS.industryCap,
      industryMatchCount * RECOMMENDATION_WEIGHTS.industryPerMatch,
    ),
    reason: 'Industry aligned',
  };
};

const EXPERIENCE_LEVEL_INDEX: Record<RecommendationExperienceLevel, number> = {
  junior: 0,
  mid: 1,
  senior: 2,
  lead: 3,
};

const toExperienceLevelIndex = (value: unknown): number | null => {
  const normalized = normalizeExperienceLevel(value);
  if (!normalized) return null;
  return EXPERIENCE_LEVEL_INDEX[normalized];
};

const scoreExperienceAlignment = (
  metadata: JobRecommendationMetadata,
  profile: RecommendationProfile,
): { score: number; reason?: string } => {
  const profileIndex = toExperienceLevelIndex(profile.experienceLevel);
  const jobIndex = toExperienceLevelIndex(metadata.inferredExperienceLevel);
  if (profileIndex == null || jobIndex == null) return { score: 0 };

  const distance = Math.abs(profileIndex - jobIndex);
  if (distance === 0) {
    return {
      score: RECOMMENDATION_WEIGHTS.experienceDirectBonus,
      reason: 'Experience level aligned',
    };
  }
  if (distance === 1) {
    return {
      score: RECOMMENDATION_WEIGHTS.experienceNearBonus,
      reason: 'Experience level near match',
    };
  }
  return { score: 0 };
};

const scoreSalarySignal = (metadata: JobRecommendationMetadata): number =>
  metadata.hasSalarySignal ? RECOMMENDATION_WEIGHTS.salarySignalBonus : 0;

const scoreFreshness = (publishedTs: number): number => {
  if (publishedTs <= 0) return 0;
  const ageDays = Math.max(0, (Date.now() - publishedTs) / (24 * 60 * 60 * 1000));
  if (ageDays <= 1) return RECOMMENDATION_WEIGHTS.freshnessDay1Bonus;
  if (ageDays <= 7) return RECOMMENDATION_WEIGHTS.freshnessWeekBonus;
  if (ageDays <= 30) return RECOMMENDATION_WEIGHTS.freshnessMonthBonus;
  return 0;
};

const runRecommendationSignals = (
  signalRuns: RecommendationSignalRun[],
): {
  score: number;
  reasons: string[];
  matchedSkills: string[];
  breakdown: RecommendationScoreBreakdown;
} => {
  const reasons: string[] = [];
  let matchedSkills: string[] = [];
  const breakdown: RecommendationScoreBreakdown = {
    skills: 0,
    role: 0,
    remote: 0,
    workModel: 0,
    location: 0,
    experience: 0,
    industry: 0,
    salarySignal: 0,
    freshness: 0,
  };

  for (const signalRun of signalRuns) {
    const result = signalRun.signal();
    breakdown[signalRun.key] = result.score;
    if (result.reason) reasons.push(result.reason);
    if (result.matchedSkills && result.matchedSkills.length > 0) {
      matchedSkills = result.matchedSkills;
    }
  }

  return {
    score: Object.values(breakdown).reduce((total, value) => total + value, 0),
    reasons,
    matchedSkills,
    breakdown,
  };
};

export const buildJobRecommendationScore = (
  job: any,
  profile: RecommendationProfile,
): RecommendationScoreResult => {
  const metadata = buildJobRecommendationMetadata(job);
  const publishedTs = metadata.publishedTs;
  const scoredSignals = runRecommendationSignals([
    {
      key: 'skills',
      signal: () => scoreSkillMatch(metadata, profile),
    },
    {
      key: 'role',
      signal: () => scoreRoleAlignment(metadata, profile),
    },
    {
      key: 'remote',
      signal: () => scoreRemoteRole(metadata, profile),
    },
    {
      key: 'workModel',
      signal: () => scoreWorkModelPreference(metadata, profile),
    },
    {
      key: 'location',
      signal: () => scoreLocationAlignment(metadata, profile),
    },
    {
      key: 'experience',
      signal: () => scoreExperienceAlignment(metadata, profile),
    },
    {
      key: 'industry',
      signal: () => scoreIndustryAlignment(metadata, profile),
    },
    {
      key: 'salarySignal',
      signal: () => ({ score: scoreSalarySignal(metadata) }),
    },
    {
      key: 'freshness',
      signal: () => ({ score: scoreFreshness(publishedTs) }),
    },
  ]);

  return {
    score: scoredSignals.score,
    reasons: scoredSignals.reasons,
    matchedSkills: scoredSignals.matchedSkills,
    publishedTs,
    breakdown: scoredSignals.breakdown,
  };
};
