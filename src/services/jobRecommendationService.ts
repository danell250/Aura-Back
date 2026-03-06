import { readString } from '../utils/inputSanitizers';

const RECOMMENDATION_WEIGHTS = {
  skillPerMatch: 16,
  skillCap: 48,
  remoteBonus: 18,
  locationBonus: 24,
  industryPerMatch: 6,
  industryCap: 12,
  salarySignalBonus: 2,
  freshnessDay1Bonus: 8,
  freshnessWeekBonus: 6,
  freshnessMonthBonus: 3,
} as const;

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
  locationTokens: Set<string>;
  industryTokens: Set<string>;
};

export type RecommendationScoreResult = {
  score: number;
  reasons: string[];
  matchedSkills: string[];
  publishedTs: number;
};

type JobRecommendationMetadata = {
  skillLabelByToken: Map<string, string>;
  locationTokens: Set<string>;
  semanticTokens: Set<string>;
  publishedTs: number;
  hasSalarySignal: boolean;
  isRemoteRole: boolean;
};

const buildJobRecommendationMetadata = (job: any): JobRecommendationMetadata => {
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

  const storedLocationTokens = readRecommendationTokenArray(job?.recommendationLocationTokens, 40);
  const locationTokens = new Set<string>(
    storedLocationTokens.length > 0
      ? storedLocationTokens
      : tokenizeRecommendationText(job?.locationText, 20).filter((token) => token.length >= 3),
  );

  const storedSemanticTokens = readRecommendationTokenArray(job?.recommendationSemanticTokens, 320);
  const semanticTokens = new Set<string>(
    storedSemanticTokens.length > 0
      ? storedSemanticTokens
      : tokenizeRecommendationText(
          `${readString(job?.title, 120)} ${readString(job?.summary, 220)} ${readString(job?.description, 1200)}`,
          260,
        ).filter((token) => token.length >= 3),
  );

  const storedPublishedTs = Number(job?.recommendationPublishedTs);
  const publishedAtRaw = readString(job?.publishedAt, 80) || readString(job?.createdAt, 80);
  const publishedAtTs = publishedAtRaw ? new Date(publishedAtRaw).getTime() : 0;
  const publishedTs = Number.isFinite(storedPublishedTs)
    ? storedPublishedTs
    : (Number.isFinite(publishedAtTs) ? publishedAtTs : 0);

  const storedHasSalarySignal = (job as any)?.recommendationHasSalarySignal;
  const hasSalarySignal =
    typeof storedHasSalarySignal === 'boolean'
      ? storedHasSalarySignal
      : (typeof job?.salaryMin === 'number' || typeof job?.salaryMax === 'number');

  const storedIsRemoteRole = (job as any)?.recommendationIsRemoteRole;
  const isRemoteRole =
    typeof storedIsRemoteRole === 'boolean'
      ? storedIsRemoteRole
      : (String(job?.workModel || '').toLowerCase() === 'remote');

  return {
    skillLabelByToken,
    locationTokens,
    semanticTokens,
    publishedTs,
    hasSalarySignal,
    isRemoteRole,
  };
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
  const skillTokens = new Set<string>([
    ...readRecommendationSkillTokens((user as any)?.skills, 80),
    ...readRecommendationSkillTokens((user as any)?.profileSkills, 80),
  ]);

  const locationTokens = new Set<string>([
    ...tokenizeRecommendationText((user as any)?.location, 20).filter((token) => token.length >= 3),
    ...tokenizeRecommendationText((user as any)?.country, 8).filter((token) => token.length >= 3),
  ]);

  const industryTokens = new Set<string>(
    tokenizeRecommendationText((user as any)?.industry, 20).filter((token) => token.length >= 3),
  );

  return {
    skillTokens,
    locationTokens,
    industryTokens,
  };
};

export const buildRecommendationCandidateFilter = (
  profile: RecommendationProfile,
): Record<string, unknown> => {
  const skillTokens = Array.from(profile.skillTokens).slice(0, 20);
  const orFilters: Array<Record<string, unknown>> = [];

  if (skillTokens.length > 0) {
    orFilters.push({ tags: { $in: skillTokens } });
  }

  if (orFilters.length === 0) {
    return { status: 'open' };
  }

  return {
    status: 'open',
    $or: orFilters,
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

const scoreRemoteRole = (metadata: JobRecommendationMetadata): { score: number; reason?: string } => {
  if (!metadata.isRemoteRole) return { score: 0 };
  return {
    score: RECOMMENDATION_WEIGHTS.remoteBonus,
    reason: 'Remote role',
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

export const buildJobRecommendationScore = (
  job: any,
  profile: RecommendationProfile,
): RecommendationScoreResult => {
  const reasons: string[] = [];
  let score = 0;
  const metadata = buildJobRecommendationMetadata(job);
  const skillSignal = scoreSkillMatch(metadata, profile);
  if (skillSignal.score > 0) {
    score += skillSignal.score;
    if (skillSignal.reason) reasons.push(skillSignal.reason);
  }

  const remoteSignal = scoreRemoteRole(metadata);
  if (remoteSignal.score > 0) {
    score += remoteSignal.score;
    if (remoteSignal.reason) reasons.push(remoteSignal.reason);
  }

  const locationSignal = scoreLocationAlignment(metadata, profile);
  if (locationSignal.score > 0) {
    score += locationSignal.score;
    if (locationSignal.reason) reasons.push(locationSignal.reason);
  }

  const industrySignal = scoreIndustryAlignment(metadata, profile);
  if (industrySignal.score > 0) {
    score += industrySignal.score;
    if (industrySignal.reason) reasons.push(industrySignal.reason);
  }

  score += scoreSalarySignal(metadata);

  const publishedTs = metadata.publishedTs;
  score += scoreFreshness(publishedTs);

  return {
    score,
    reasons,
    matchedSkills: skillSignal.matchedSkills,
    publishedTs,
  };
};
