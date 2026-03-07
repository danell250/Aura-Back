import type { RecommendationProfile } from './jobRecommendationService';
import { readString } from '../utils/inputSanitizers';
import { yieldToEventLoop } from '../utils/asyncUtils';

const JOB_ALERT_SCORING_YIELD_INTERVAL = 12;

export type DigestJobScoringMetadata = {
  tagTokens: Set<string>;
  semanticTokens: Set<string>;
  workModel: string;
  discoveredAt: string;
};

export type RankedDigestJobEntry = {
  job: any;
  score: number;
  discoveredAt: string;
};

const normalizeToken = (value: unknown): string =>
  readString(value, 120).trim().toLowerCase();

const getJobCandidateKey = (job: any): string =>
  readString(job?.id, 220) || readString(job?.slug, 220);

const normalizeDiscoveredAt = (job: any): string => (
  readString(job?.discoveredAt, 80)
  || readString(job?.createdAt, 80)
  || new Date().toISOString()
);

const countSetMatches = (profileTokens: Set<string>, jobTokens: Set<string>): number => {
  if (profileTokens.size === 0 || jobTokens.size === 0) return 0;
  const [smaller, larger] = profileTokens.size <= jobTokens.size
    ? [profileTokens, jobTokens]
    : [jobTokens, profileTokens];
  let matches = 0;
  smaller.forEach((token) => {
    if (larger.has(token)) {
      matches += 1;
    }
  });
  return matches;
};

const scoreDigestFreshness = (value: unknown): number => {
  const parsed = new Date(readString(value, 80) || '');
  if (Number.isNaN(parsed.getTime())) return 0;
  const ageHours = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / (60 * 60 * 1000)));
  if (ageHours <= 24) return 12;
  if (ageHours <= 72) return 8;
  if (ageHours <= 168) return 4;
  return 0;
};

const scoreDigestCandidateJob = (params: {
  job: any;
  recommendationProfile: RecommendationProfile;
  semanticProfileTokens: Set<string>;
  candidateMetadataByKey?: Map<string, DigestJobScoringMetadata>;
}): RankedDigestJobEntry => {
  const jobKey = getJobCandidateKey(params.job);
  const metadata = jobKey ? params.candidateMetadataByKey?.get(jobKey) : null;
  const tagTokens = metadata?.tagTokens || new Set(
    (Array.isArray(params.job?.tags) ? params.job.tags : [])
      .map((token: unknown) => normalizeToken(token))
      .filter(Boolean),
  );
  const semanticTokens = metadata?.semanticTokens || new Set(
    (Array.isArray(params.job?.recommendationSemanticTokens) ? params.job.recommendationSemanticTokens : [])
      .map((token: unknown) => normalizeToken(token))
      .filter(Boolean),
  );
  const skillMatches = countSetMatches(params.recommendationProfile.skillTokens, tagTokens);
  const semanticMatches = countSetMatches(params.semanticProfileTokens, semanticTokens);
  const workModel = metadata?.workModel || normalizeToken(params.job?.workModel);
  const workModelMatch = workModel && params.recommendationProfile.preferredWorkModels.has(workModel as any);

  const score = Math.max(
    0,
    Math.min(60, skillMatches * 18)
    + Math.min(24, semanticMatches * 12)
    + (workModelMatch ? 10 : 0)
    + scoreDigestFreshness(params.job?.discoveredAt || params.job?.createdAt),
  );

  return {
    job: params.job,
    score,
    discoveredAt: metadata?.discoveredAt || normalizeDiscoveredAt(params.job),
  };
};

export const rankDigestCandidateJobs = async (params: {
  candidateJobs: any[];
  recommendationProfile: RecommendationProfile;
  candidateMetadataByKey?: Map<string, DigestJobScoringMetadata>;
  maxResults: number;
}): Promise<RankedDigestJobEntry[]> => {
  const semanticProfileTokens = new Set([
    ...Array.from(params.recommendationProfile.roleTokens),
    ...Array.from(params.recommendationProfile.industryTokens),
  ]);
  const entries: RankedDigestJobEntry[] = [];

  for (let index = 0; index < params.candidateJobs.length; index += 1) {
    entries.push(scoreDigestCandidateJob({
      job: params.candidateJobs[index],
      recommendationProfile: params.recommendationProfile,
      semanticProfileTokens,
      candidateMetadataByKey: params.candidateMetadataByKey,
    }));
    if ((index + 1) % JOB_ALERT_SCORING_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }

  return entries
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return new Date(right.discoveredAt).getTime() - new Date(left.discoveredAt).getTime();
    })
    .slice(0, params.maxResults);
};
