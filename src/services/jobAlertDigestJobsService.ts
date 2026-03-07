import { normalizeJobAlertCategory, resolveJobAlertCategory, resolveStoredJobAlertCategory, type JobAlertCategory } from './jobAlertCategoryService';
import {
  buildRecommendationCandidateCriteria,
  buildRecommendationProfile,
  type RecommendationProfile,
  resolveRecommendationMatchTier,
} from './jobRecommendationService';
import {
  rankDigestCandidateJobs,
  type DigestJobScoringMetadata,
  type RankedDigestJobEntry,
} from './jobAlertDigestScoringService';
import { buildRecommendationCandidateMongoFilter } from './jobRecommendationQueryBuilder';
import { readString } from '../utils/inputSanitizers';
import { getPublicWebUrl } from '../utils/publicWebUrl';

const JOBS_COLLECTION = 'jobs';
const JOB_ALERT_USER_MAX_JOBS = 10;
const JOB_ALERT_PUBLIC_MAX_JOBS = 10;
const JOB_ALERT_USER_CANDIDATE_LIMIT = 140;
const JOB_ALERT_PUBLIC_CANDIDATE_LIMIT = 100;
const JOB_ALERT_USER_RANKING_CANDIDATE_LIMIT = 48;

const APP_BASE_URL = getPublicWebUrl();

export type DigestJobItem = {
  title: string;
  companyName: string;
  locationText: string;
  url: string;
  discoveredAt: string;
  matchScore?: number;
  matchTier?: 'best' | 'good' | 'other';
};

export type PublicDigestJobGroups = Record<JobAlertCategory, DigestJobItem[]>;

export type UserDigestCandidateIndex = {
  allJobs: any[];
  skillTokenJobs: Map<string, any[]>;
  semanticTokenJobs: Map<string, any[]>;
  workModelJobs: Map<string, any[]>;
  jobPositionByKey: Map<string, number>;
  jobMetadataByKey: Map<string, DigestJobScoringMetadata>;
};

const buildJobUrl = (job: any): string => {
  const slug = readString(job?.slug, 220) || readString(job?.id, 220);
  if (!slug) return `${APP_BASE_URL}/jobs`;
  return `${APP_BASE_URL}/jobs/${encodeURIComponent(slug)}`;
};

const normalizeDiscoveredAt = (job: any): string => (
  readString(job?.discoveredAt, 80)
  || readString(job?.createdAt, 80)
  || new Date().toISOString()
);

const normalizeToken = (value: unknown): string =>
  readString(value, 120).trim().toLowerCase();

const addJobToTokenBuckets = (
  buckets: Map<string, any[]>,
  token: string,
  job: any,
): void => {
  if (!token) return;
  const existing = buckets.get(token);
  if (existing) {
    existing.push(job);
    return;
  }
  buckets.set(token, [job]);
};

const getJobCandidateKey = (job: any): string =>
  readString(job?.id, 220) || readString(job?.slug, 220);

const buildDigestJobItem = (job: any, overrides?: Partial<DigestJobItem>): DigestJobItem => ({
  title: readString(job?.title, 180) || 'New job',
  companyName: readString(job?.companyName, 160) || 'Hiring team',
  locationText: readString(job?.locationText, 160) || 'Flexible',
  url: buildJobUrl(job),
  discoveredAt: normalizeDiscoveredAt(job),
  ...overrides,
});

const buildRecentJobsFilter = (windowStartIso: string): Record<string, unknown> => ({
  status: 'open',
  $or: [
    { discoveredAt: { $gte: windowStartIso } },
    { createdAt: { $gte: windowStartIso } },
  ],
});

const queryRecentDigestCandidateJobs = async (params: {
  db: any;
  windowStartIso: string;
  candidateFilter?: Record<string, unknown>;
  limit: number;
}): Promise<any[]> => {
  const recentFilter = buildRecentJobsFilter(params.windowStartIso);
  const candidateFilter = params.candidateFilter && Object.keys(params.candidateFilter).length > 0
    ? { ...params.candidateFilter }
    : null;

  const mergedFilter = candidateFilter && Array.isArray((candidateFilter as any).$or)
    ? {
        $and: [
          recentFilter,
          {
            $or: (candidateFilter as any).$or,
          },
        ],
      }
    : recentFilter;

  return params.db.collection(JOBS_COLLECTION)
    .find(mergedFilter)
    .sort({ discoveredAt: -1, publishedAt: -1, createdAt: -1 })
    .limit(params.limit)
    .toArray();
};

const createEmptyPublicDigestGroups = (): PublicDigestJobGroups => ({
  all: [],
  engineering: [],
  design: [],
  marketing: [],
  data: [],
  product: [],
  operations: [],
  sales: [],
});

export const createUserDigestCandidateIndex = (candidateJobs: any[]): UserDigestCandidateIndex => {
  const index: UserDigestCandidateIndex = {
    allJobs: Array.isArray(candidateJobs) ? candidateJobs : [],
    skillTokenJobs: new Map(),
    semanticTokenJobs: new Map(),
    workModelJobs: new Map(),
    jobPositionByKey: new Map(),
    jobMetadataByKey: new Map(),
  };

  index.allJobs.forEach((job, position) => {
    const jobKey = getJobCandidateKey(job);
    if (jobKey) {
      index.jobPositionByKey.set(jobKey, position);
    }

    const workModel = normalizeToken((job as any)?.workModel);
    if (workModel) {
      addJobToTokenBuckets(index.workModelJobs, workModel, job);
    }

    const tags = Array.isArray((job as any)?.tags) ? (job as any).tags : [];
    const semanticTokens = Array.isArray((job as any)?.recommendationSemanticTokens)
      ? (job as any).recommendationSemanticTokens
      : [];

    const normalizedTags = new Set<string>(
      tags
        .map((token: unknown) => normalizeToken(token))
        .filter((token: string): token is string => token.length > 0),
    );
    const normalizedSemanticTokens = new Set<string>(
      semanticTokens
        .map((token: unknown) => normalizeToken(token))
        .filter((token: string): token is string => token.length > 0),
    );
    if (jobKey) {
      index.jobMetadataByKey.set(jobKey, {
        tagTokens: normalizedTags,
        semanticTokens: normalizedSemanticTokens,
        workModel,
        discoveredAt: normalizeDiscoveredAt(job),
      });
    }

    normalizedTags.forEach((token) => addJobToTokenBuckets(index.skillTokenJobs, token, job));
    normalizedSemanticTokens.forEach((token) => addJobToTokenBuckets(index.semanticTokenJobs, token, job));
  });

  return index;
};

const filterIndexedCandidateJobs = (params: {
  candidateIndex: UserDigestCandidateIndex;
  recommendationCriteria: ReturnType<typeof buildRecommendationCandidateCriteria>;
  windowStartIso: string;
}): any[] => {
  const dedupedJobs = new Map<string, any>();
  const windowStartTs = new Date(params.windowStartIso).getTime();

  const addJobs = (jobs: any[] | undefined) => {
    if (!Array.isArray(jobs) || jobs.length === 0) return;
    for (const job of jobs) {
      const discoveredAtTs = new Date(normalizeDiscoveredAt(job)).getTime();
      if (Number.isFinite(windowStartTs) && Number.isFinite(discoveredAtTs) && discoveredAtTs < windowStartTs) {
        continue;
      }
      const jobKey = getJobCandidateKey(job);
      if (!jobKey || dedupedJobs.has(jobKey)) continue;
      dedupedJobs.set(jobKey, job);
    }
  };

  params.recommendationCriteria.skillTokens.forEach((token) =>
    addJobs(params.candidateIndex.skillTokenJobs.get(normalizeToken(token))));
  params.recommendationCriteria.semanticTokens.forEach((token) =>
    addJobs(params.candidateIndex.semanticTokenJobs.get(normalizeToken(token))));
  params.recommendationCriteria.preferredWorkModels.forEach((workModel) =>
    addJobs(params.candidateIndex.workModelJobs.get(normalizeToken(workModel))));

  return Array.from(dedupedJobs.values())
    .sort((left, right) => {
      const leftKey = getJobCandidateKey(left);
      const rightKey = getJobCandidateKey(right);
      const leftPosition = leftKey ? params.candidateIndex.jobPositionByKey.get(leftKey) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const rightPosition = rightKey ? params.candidateIndex.jobPositionByKey.get(rightKey) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition;
    })
    .slice(0, JOB_ALERT_USER_RANKING_CANDIDATE_LIMIT);
};

const selectRecentCandidateJobs = (params: {
  candidateJobs: any[];
  windowStartIso: string;
  limit: number;
}): any[] => {
  const selected: any[] = [];
  const windowStartTs = new Date(params.windowStartIso).getTime();
  for (const job of params.candidateJobs) {
    const discoveredAtTs = new Date(normalizeDiscoveredAt(job)).getTime();
    if (Number.isFinite(windowStartTs) && Number.isFinite(discoveredAtTs) && discoveredAtTs < windowStartTs) {
      continue;
    }
    selected.push(job);
    if (selected.length >= params.limit) break;
  }
  return selected;
};

const mapRankedDigestEntriesToItems = (entries: RankedDigestJobEntry[]): DigestJobItem[] => {
  const selected = entries.filter((entry) => entry.score > 0);
  if (selected.length === 0) return [];

  return selected.map((entry) => ({
    ...buildDigestJobItem(entry.job),
    matchScore: Math.max(0, Math.round(entry.score)),
    matchTier: resolveRecommendationMatchTier(Math.max(0, Math.round(entry.score))),
  }));
};

const loadUserDigestCandidateJobs = async (params: {
  db?: any;
  recommendationCriteria: ReturnType<typeof buildRecommendationCandidateCriteria>;
  windowStartIso: string;
  candidateJobs?: any[];
  candidateIndex?: UserDigestCandidateIndex;
}): Promise<any[]> => {
  const recommendationFilter = buildRecommendationCandidateMongoFilter(params.recommendationCriteria);
  let candidateJobs = Array.isArray(params.candidateJobs) ? params.candidateJobs : [];
  if (candidateJobs.length === 0 && params.candidateIndex?.allJobs.length) {
    candidateJobs = params.candidateIndex.allJobs;
  }

  if (candidateJobs.length === 0) {
    if (!params.db) return [];
    return queryRecentDigestCandidateJobs({
      db: params.db,
      windowStartIso: params.windowStartIso,
      candidateFilter: recommendationFilter,
      limit: JOB_ALERT_USER_CANDIDATE_LIMIT,
    });
  }

  if (Array.isArray((recommendationFilter as any).$or)) {
    const candidateIndex = params.candidateIndex || createUserDigestCandidateIndex(candidateJobs);
    return filterIndexedCandidateJobs({
      candidateIndex,
      recommendationCriteria: params.recommendationCriteria,
      windowStartIso: params.windowStartIso,
    });
  }

  return selectRecentCandidateJobs({
    candidateJobs: params.candidateIndex?.allJobs || candidateJobs,
    windowStartIso: params.windowStartIso,
    limit: JOB_ALERT_USER_MAX_JOBS,
  });
};

export const buildUserDigestJobs = async (params: {
  db: any;
  user: any;
  windowStartIso: string;
}): Promise<DigestJobItem[]> => {
  const recommendationProfile = buildRecommendationProfile(params.user);
  return buildUserDigestJobsForProfile({
    db: params.db,
    recommendationProfile,
    windowStartIso: params.windowStartIso,
  });
};

export const buildUserDigestRecommendationProfile = (user: any): RecommendationProfile =>
  buildRecommendationProfile(user);

export const listUserDigestCandidateJobs = async (params: {
  db: any;
  windowStartIso: string;
  limit?: number;
}): Promise<any[]> =>
  queryRecentDigestCandidateJobs({
    db: params.db,
    windowStartIso: params.windowStartIso,
    limit: typeof params.limit === 'number' && Number.isFinite(params.limit)
      ? Math.max(JOB_ALERT_USER_CANDIDATE_LIMIT, Math.floor(params.limit))
      : JOB_ALERT_USER_CANDIDATE_LIMIT,
  });

export const buildUserDigestJobsForProfile = async (params: {
  db?: any;
  recommendationProfile: RecommendationProfile;
  windowStartIso: string;
  candidateJobs?: any[];
  candidateIndex?: UserDigestCandidateIndex;
}): Promise<DigestJobItem[]> => {
  const recommendationCriteria = buildRecommendationCandidateCriteria(params.recommendationProfile);
  const candidateJobs = await loadUserDigestCandidateJobs({
    db: params.db,
    recommendationCriteria,
    windowStartIso: params.windowStartIso,
    candidateJobs: params.candidateJobs,
    candidateIndex: params.candidateIndex,
  });

  if (candidateJobs.length === 0) return [];

  const rankedEntries = await rankDigestCandidateJobs({
    candidateJobs,
    recommendationProfile: params.recommendationProfile,
    candidateMetadataByKey: params.candidateIndex?.jobMetadataByKey,
    maxResults: JOB_ALERT_USER_MAX_JOBS,
  });
  const rankedItems = mapRankedDigestEntriesToItems(rankedEntries);
  if (rankedItems.length > 0) return rankedItems;

  return candidateJobs.slice(0, JOB_ALERT_USER_MAX_JOBS).map((job) => buildDigestJobItem(job));
};

export const buildPublicDigestJobsForWindow = async (params: {
  db: any;
  windowStartIso: string;
}): Promise<PublicDigestJobGroups> => {
  const candidateJobs = await queryRecentDigestCandidateJobs({
    db: params.db,
    windowStartIso: params.windowStartIso,
    limit: JOB_ALERT_PUBLIC_CANDIDATE_LIMIT,
  });
  const groupedJobs = createEmptyPublicDigestGroups();
  if (candidateJobs.length === 0) return groupedJobs;

  for (const job of candidateJobs) {
    const item = buildDigestJobItem(job);
    if (groupedJobs.all.length < JOB_ALERT_PUBLIC_MAX_JOBS) {
      groupedJobs.all.push(item);
    }

    const category = resolveStoredJobAlertCategory(job);
    if (groupedJobs[category].length < JOB_ALERT_PUBLIC_MAX_JOBS) {
      groupedJobs[category].push(item);
    }
  }

  return groupedJobs;
};

export const resolvePublicDigestCategory = (value: unknown): JobAlertCategory =>
  normalizeJobAlertCategory(value);
