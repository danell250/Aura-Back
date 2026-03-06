import { createHash } from 'crypto';
import {
  buildJobRecommendationScore,
  buildRecommendationCandidateCriteria,
  buildRecommendationProfile,
  resolveRecommendationMatchTier,
} from './jobRecommendationService';
import { buildRecommendationCandidateMongoFilter } from './jobRecommendationQueryBuilder';
import { fetchPrioritizedRecommendationCandidateJobs } from './jobRecommendationResultService';
import { recordJobPulseEvents, recordJobPulseEventsAsync } from './jobPulseService';
import {
  dispatchGroupedReverseMatchNotifications,
  groupReverseMatchNotificationEntriesByUser,
  type ReverseMatchNotificationEntry,
} from './reverseJobMatchNotificationService';
import {
  scoreReverseMatchCandidatesInWorker,
  type ReverseMatchWorkerCandidate,
  type ReverseMatchWorkerJobPayload,
  type ReverseMatchWorkerJobResultEntry,
} from './reverseJobMatchWorkerService';
import { buildReverseMatchScoreEntry } from './reverseJobMatchScoringUtils';
import { readString } from '../utils/inputSanitizers';
import { yieldToEventLoop } from '../utils/concurrencyUtils';

const USERS_COLLECTION = 'users';
const JOBS_COLLECTION = 'jobs';
const REVERSE_MATCH_ALERTS_COLLECTION = 'job_reverse_match_alerts';

const REVERSE_MATCH_MIN_SCORE = Number.isFinite(Number(process.env.REVERSE_MATCH_MIN_SCORE))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_MIN_SCORE)))
  : 70;
const REVERSE_MATCH_MAX_USER_SCAN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_USER_SCAN))
  ? Math.max(100, Math.round(Number(process.env.REVERSE_MATCH_MAX_USER_SCAN)))
  : 300;
const REVERSE_MATCH_MAX_JOBS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_JOBS_PER_RUN))
  ? Math.max(20, Math.round(Number(process.env.REVERSE_MATCH_MAX_JOBS_PER_RUN)))
  : 60;
const REVERSE_MATCH_MAX_OPS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_OPS_PER_RUN))
  ? Math.max(200, Math.round(Number(process.env.REVERSE_MATCH_MAX_OPS_PER_RUN)))
  : 25000;
const REVERSE_MATCH_MAX_CANDIDATES_PER_JOB = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_CANDIDATES_PER_JOB))
  ? Math.max(40, Math.round(Number(process.env.REVERSE_MATCH_MAX_CANDIDATES_PER_JOB)))
  : 80;
const REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB = Number.isFinite(Number(process.env.REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB))
  ? Math.max(10, Math.round(Number(process.env.REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB)))
  : 30;
const REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN))
  ? Math.max(500, Math.round(Number(process.env.REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN)))
  : 500;
const REVERSE_MATCH_NOTIFICATION_TOP_JOBS = Number.isFinite(Number(process.env.REVERSE_MATCH_NOTIFICATION_TOP_JOBS))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_NOTIFICATION_TOP_JOBS)))
  : 5;
const REVERSE_MATCH_NOTIFICATION_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_NOTIFICATION_BATCH_SIZE))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_NOTIFICATION_BATCH_SIZE)))
  : 25;
const REVERSE_MATCH_YIELD_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_SCORE_YIELD_EVERY))
  ? Math.max(10, Math.round(Number(process.env.REVERSE_MATCH_SCORE_YIELD_EVERY)))
  : 5;
const REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS))
  ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS)))
  : 5 * 60 * 1000;
const REVERSE_MATCH_INDEX_CACHE_TTL_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_INDEX_CACHE_TTL_MS))
  ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_INDEX_CACHE_TTL_MS)))
  : 2 * 60 * 1000;
const REVERSE_MATCH_USER_CONTEXT_CACHE_TTL_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_USER_CONTEXT_CACHE_TTL_MS))
  ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_USER_CONTEXT_CACHE_TTL_MS)))
  : 10 * 60 * 1000;
const DEFAULT_MATCH_CANDIDATE_LIMIT = 180;
const DEFAULT_PUBLIC_MATCH_LIMIT = 20;

let reverseMatchIndexesPromise: Promise<void> | null = null;
let reverseMatchIndexesLastFailureAtMs = 0;
let reverseMatchIndexesEnsured = false;
let reverseMatchUserScanIndexesPromise: Promise<void> | null = null;
let reverseMatchUserScanIndexesLastFailureAtMs = 0;
let reverseMatchUserScanIndexesEnsured = false;
let matchIndexBundleCache: {
  key: string;
  expiresAt: number;
  bundle: MatchIndexBundle;
} | null = null;
let candidateUserContextCache: {
  expiresAt: number;
  contexts: MatchUserContext[];
} | null = null;

type MatchUserContext = {
  user: any;
  userId: string;
  profile: ReturnType<typeof buildRecommendationProfile>;
  skillTokens: Set<string>;
  locationTokens: Set<string>;
  industryTokens: Set<string>;
  preferredWorkModels: Set<string>;
};

type MatchIndexBundle = {
  allIndexes: number[];
  bySkillToken: Map<string, number[]>;
  byLocationToken: Map<string, number[]>;
  byIndustryToken: Map<string, number[]>;
  byWorkModel: Map<string, number[]>;
};

type JobSignalBundle = {
  skillTokens: string[];
  skillTokenSet: Set<string>;
  locationTokens: string[];
  locationTokenSet: Set<string>;
  industryTokens: string[];
  industryTokenSet: Set<string>;
  semanticTokens: string[];
  semanticTokenSet: Set<string>;
  workModel: string;
  isRemoteRole: boolean;
  hasSignals: boolean;
};

type ReverseMatchRecord = {
  alertId: string;
  userId: string;
  jobId: string;
  jobSlug: string;
  title: string;
  companyName: string;
  locationText: string;
  score: number;
  reasons: string[];
  matchedSkills: string[];
};

const normalizeSkillToken = (value: unknown): string =>
  readString(String(value || ''), 120)
    .toLowerCase()
    .replace(/[^a-z0-9+.#\-/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const uniqueStrings = (items: unknown[], max = 40): string[] => {
  const dedupe = new Set<string>();
  const next: string[] = [];
  for (const item of items) {
    const normalized = normalizeSkillToken(item);
    if (!normalized || dedupe.has(normalized)) continue;
    dedupe.add(normalized);
    next.push(normalized);
    if (next.length >= max) break;
  }
  return next;
};

const normalizeWorkModelToken = (value: unknown): string => {
  const normalized = readString(String(value ?? ''), 40).toLowerCase();
  if (normalized === 'remote') return 'remote';
  if (normalized === 'hybrid') return 'hybrid';
  if (normalized === 'onsite' || normalized === 'on_site' || normalized === 'on-site') return 'onsite';
  return '';
};

const appendIndexedContextEntries = (
  index: Map<string, number[]>,
  tokens: Iterable<string>,
  ctxIndex: number,
): void => {
  for (const token of tokens) {
    const normalized = normalizeSkillToken(token);
    if (!normalized) continue;
    const bucket = index.get(normalized);
    if (bucket) {
      bucket.push(ctxIndex);
      continue;
    }
    index.set(normalized, [ctxIndex]);
  }
};

const collectIndexedCandidates = (
  index: Map<string, number[]>,
  tokens: string[],
  target: Set<number>,
): void => {
  for (const token of tokens) {
    const normalized = normalizeSkillToken(token);
    if (!normalized) continue;
    const indexes = index.get(normalized);
    if (!indexes) continue;
    indexes.forEach((ctxIndex) => target.add(ctxIndex));
  }
};

const resolveOpenJobsForReverseMatch = async (db: any, jobIds: string[]): Promise<any[]> => {
  const normalizedJobIds = Array.from(
    new Set(
      jobIds
        .map((jobId) => readString(jobId, 120))
        .filter((jobId) => jobId.length > 0),
    ),
  ).slice(0, REVERSE_MATCH_MAX_JOBS_PER_RUN);
  if (normalizedJobIds.length === 0) return [];

  return db.collection(JOBS_COLLECTION)
    .find(
      {
        status: 'open',
        id: { $in: normalizedJobIds },
      },
      {
        projection: {
          id: 1,
          slug: 1,
          source: 1,
          originalId: 1,
          originalUrl: 1,
          title: 1,
          companyName: 1,
          summary: 1,
          description: 1,
          locationText: 1,
          workModel: 1,
          salaryMin: 1,
          salaryMax: 1,
          tags: 1,
          publishedAt: 1,
          createdAt: 1,
          recommendationSkillLabelByToken: 1,
          recommendationLocationTokens: 1,
          recommendationSemanticTokens: 1,
          recommendationPublishedTs: 1,
          recommendationHasSalarySignal: 1,
          recommendationIsRemoteRole: 1,
        },
      },
    )
    .sort({ publishedAt: -1, createdAt: -1 })
    .limit(REVERSE_MATCH_MAX_JOBS_PER_RUN)
    .toArray();
};

export const ensureReverseMatchIndexes = async (db: any): Promise<void> => {
  if (reverseMatchIndexesEnsured) return;
  if (
    reverseMatchIndexesLastFailureAtMs > 0
    && (Date.now() - reverseMatchIndexesLastFailureAtMs) < REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS
  ) {
    return;
  }
  if (!reverseMatchIndexesPromise) {
    reverseMatchIndexesPromise = (async () => {
      try {
        await Promise.all([
          db.collection(REVERSE_MATCH_ALERTS_COLLECTION).createIndex(
            { id: 1 },
            { name: 'reverse_match_alert_id_unique', unique: true },
          ),
          db.collection(REVERSE_MATCH_ALERTS_COLLECTION).createIndex(
            { userId: 1, createdAt: -1 },
            { name: 'reverse_match_alert_user_created_idx' },
          ),
          db.collection(REVERSE_MATCH_ALERTS_COLLECTION).createIndex(
            { emailDigestSentAt: 1, createdAt: -1 },
            { name: 'reverse_match_alert_digest_idx' },
          ),
        ]);
        reverseMatchIndexesEnsured = true;
        reverseMatchIndexesLastFailureAtMs = 0;
      } catch (error) {
        reverseMatchIndexesLastFailureAtMs = Date.now();
        throw error;
      } finally {
        if (!reverseMatchIndexesEnsured) {
          reverseMatchIndexesPromise = null;
        }
      }
    })();
  }
  return reverseMatchIndexesPromise;
};

const ensureReverseMatchUserScanIndexes = async (db: any): Promise<void> => {
  if (reverseMatchUserScanIndexesEnsured) return;
  if (reverseMatchUserScanIndexesPromise) return reverseMatchUserScanIndexesPromise;
  if (
    reverseMatchUserScanIndexesLastFailureAtMs > 0
    && (Date.now() - reverseMatchUserScanIndexesLastFailureAtMs) < REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS
  ) {
    return;
  }
  reverseMatchUserScanIndexesPromise = (async () => {
    try {
      await db.collection(USERS_COLLECTION).createIndex(
        { reverseJobMatchEnabled: 1, updatedAt: -1 },
        {
          name: 'reverse_match_user_scan_idx',
          partialFilterExpression: {
            reverseJobMatchEnabled: { $ne: false },
          },
        },
      );
      reverseMatchUserScanIndexesEnsured = true;
      reverseMatchUserScanIndexesLastFailureAtMs = 0;
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (
        message.includes('already exists')
        || message.includes('index with name')
        || message.includes('equivalent index already exists')
      ) {
        reverseMatchUserScanIndexesEnsured = true;
        reverseMatchUserScanIndexesLastFailureAtMs = 0;
        return;
      }
      reverseMatchUserScanIndexesLastFailureAtMs = Date.now();
      throw error;
    } finally {
      reverseMatchUserScanIndexesPromise = null;
    }
  })();
  return reverseMatchUserScanIndexesPromise;
};

export const warmReverseMatchIndexes = async (db: any): Promise<void> => {
  await Promise.allSettled([
    ensureReverseMatchIndexes(db),
    ensureReverseMatchUserScanIndexes(db),
  ]);
};

const resolveCandidateUsersForReverseMatch = async (db: any): Promise<MatchUserContext[]> => {
  if (candidateUserContextCache && candidateUserContextCache.expiresAt > Date.now()) {
    return candidateUserContextCache.contexts;
  }
  try {
    await ensureReverseMatchUserScanIndexes(db);
  } catch (error) {
    console.warn('Reverse match user scan index ensure error:', error);
  }

  const users = await db.collection(USERS_COLLECTION).find(
    {
      reverseJobMatchEnabled: { $ne: false },
      $or: [
        { skills: { $exists: true, $ne: [] } },
        { profileSkills: { $exists: true, $ne: [] } },
        { location: { $exists: true, $ne: '' } },
        { industry: { $exists: true, $ne: '' } },
        { preferredWorkModel: { $exists: true, $ne: '' } },
      ],
    },
    {
      projection: {
        id: 1,
        handle: 1,
        name: 1,
        firstName: 1,
        email: 1,
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
        jobMatchShareEnabled: 1,
        lastReverseJobDigestAt: 1,
      },
    },
  ).limit(REVERSE_MATCH_MAX_USER_SCAN).toArray();

  const contexts: MatchUserContext[] = [];
  for (const user of users) {
    const userId = readString((user as any)?.id, 120);
    if (!userId) continue;
    const profile = buildRecommendationProfile(user);
    const hasSignal = (
      profile.skillTokens.size > 0
      || profile.locationTokens.size > 0
      || profile.industryTokens.size > 0
      || profile.preferredWorkModels.size > 0
      || profile.experienceLevel !== null
    );
    if (!hasSignal) continue;
    contexts.push({
      user,
      userId,
      profile,
      skillTokens: profile.skillTokens,
      locationTokens: profile.locationTokens,
      industryTokens: profile.industryTokens,
      preferredWorkModels: new Set<string>(Array.from(profile.preferredWorkModels.values())),
    });
  }
  candidateUserContextCache = {
    expiresAt: Date.now() + REVERSE_MATCH_USER_CONTEXT_CACHE_TTL_MS,
    contexts,
  };
  return contexts;
};

const extractJobSkillTokens = (job: any): string[] => {
  const tokenSources: unknown[] = [];
  if ((job as any)?.recommendationSkillLabelByToken && typeof (job as any).recommendationSkillLabelByToken === 'object') {
    tokenSources.push(...Object.keys((job as any).recommendationSkillLabelByToken as Record<string, unknown>));
  }
  if (Array.isArray(job?.tags)) {
    tokenSources.push(...job.tags);
  }
  return uniqueStrings(tokenSources, 50);
};

const extractJobLocationTokens = (job: any): string[] => {
  const tokenSources: unknown[] = [];
  if (Array.isArray((job as any)?.recommendationLocationTokens)) {
    tokenSources.push(...(job as any).recommendationLocationTokens);
  }
  tokenSources.push(...readString(job?.locationText, 220).split(/\s+/g));
  return uniqueStrings(tokenSources, 30);
};

const extractJobSemanticTokens = (job: any): string[] => {
  const tokenSources: unknown[] = [];
  if (Array.isArray((job as any)?.recommendationSemanticTokens)) {
    tokenSources.push(...(job as any).recommendationSemanticTokens);
  }
  const titleTokens = readString(job?.title, 140).split(/\s+/g);
  const summaryTokens = readString(job?.summary, 260).split(/\s+/g);
  tokenSources.push(...titleTokens, ...summaryTokens);
  return uniqueStrings(tokenSources, 120);
};

const extractJobIndustryTokens = (job: any): string[] => {
  const tokenSources: unknown[] = [];
  if (Array.isArray(job?.tags)) {
    tokenSources.push(...job.tags);
  }
  tokenSources.push(readString((job as any)?.industry, 120));
  return uniqueStrings(tokenSources, 30);
};

const buildJobSignalBundle = (job: any): JobSignalBundle => {
  const skillTokens = extractJobSkillTokens(job);
  const locationTokens = extractJobLocationTokens(job);
  const industryTokens = extractJobIndustryTokens(job);
  const semanticTokens = extractJobSemanticTokens(job);
  const explicitWorkModel = normalizeWorkModelToken((job as any)?.workModel);
  const remoteHintText = [
    readString((job as any)?.locationText, 220),
    readString((job as any)?.title, 140),
    readString((job as any)?.summary, 260),
  ].join(' ').toLowerCase();
  const hasRemoteHint = /\b(remote|work from home|wfh|anywhere|distributed)\b/.test(remoteHintText);
  const isRemoteRole =
    typeof (job as any)?.recommendationIsRemoteRole === 'boolean'
      ? Boolean((job as any).recommendationIsRemoteRole)
      : (explicitWorkModel === 'remote' || hasRemoteHint);
  const workModel = explicitWorkModel || (isRemoteRole ? 'remote' : '');
  return {
    skillTokens,
    skillTokenSet: new Set(skillTokens),
    locationTokens,
    locationTokenSet: new Set(locationTokens),
    industryTokens,
    industryTokenSet: new Set(industryTokens),
    semanticTokens,
    semanticTokenSet: new Set(semanticTokens),
    workModel,
    isRemoteRole,
    hasSignals:
      skillTokens.length > 0
      || locationTokens.length > 0
      || industryTokens.length > 0
      || semanticTokens.length > 0
      || Boolean(workModel)
      || isRemoteRole,
  };
};

const buildMatchIndexBundle = (contexts: MatchUserContext[]): MatchIndexBundle => {
  const bySkillToken = new Map<string, number[]>();
  const byLocationToken = new Map<string, number[]>();
  const byIndustryToken = new Map<string, number[]>();
  const byWorkModel = new Map<string, number[]>();

  contexts.forEach((context, ctxIndex) => {
    appendIndexedContextEntries(bySkillToken, context.skillTokens, ctxIndex);
    appendIndexedContextEntries(byLocationToken, context.locationTokens, ctxIndex);
    appendIndexedContextEntries(byIndustryToken, context.industryTokens, ctxIndex);
    appendIndexedContextEntries(byWorkModel, context.preferredWorkModels, ctxIndex);
  });

  return {
    allIndexes: contexts.map((_, index) => index),
    bySkillToken,
    byLocationToken,
    byIndustryToken,
    byWorkModel,
  };
};

const buildMatchIndexCacheKey = (contexts: MatchUserContext[]): string => {
  const total = contexts.length;
  if (total === 0) return '0';
  const first = readString(contexts[0]?.userId, 120);
  const middle = readString(contexts[Math.floor(total / 2)]?.userId, 120);
  const last = readString(contexts[total - 1]?.userId, 120);
  return `${total}:${first}:${middle}:${last}`;
};

const resolveMatchIndexBundle = (contexts: MatchUserContext[]): MatchIndexBundle => {
  const nowMs = Date.now();
  const cacheKey = buildMatchIndexCacheKey(contexts);
  if (
    matchIndexBundleCache
    && matchIndexBundleCache.key === cacheKey
    && matchIndexBundleCache.expiresAt > nowMs
  ) {
    return matchIndexBundleCache.bundle;
  }

  const bundle = buildMatchIndexBundle(contexts);
  matchIndexBundleCache = {
    key: cacheKey,
    expiresAt: nowMs + REVERSE_MATCH_INDEX_CACHE_TTL_MS,
    bundle,
  };
  return bundle;
};

const resolveCandidateContextIndexesForJob = (
  indexBundle: MatchIndexBundle,
  jobSignals: JobSignalBundle,
): number[] => {
  const prioritized = new Set<number>();
  const secondary = new Set<number>();

  collectIndexedCandidates(indexBundle.bySkillToken, jobSignals.skillTokens, prioritized);
  collectIndexedCandidates(indexBundle.byLocationToken, jobSignals.locationTokens, secondary);
  collectIndexedCandidates(indexBundle.byIndustryToken, jobSignals.industryTokens, secondary);

  const workModelTokens: string[] = [];
  if (jobSignals.workModel) workModelTokens.push(jobSignals.workModel);
  if (jobSignals.isRemoteRole) workModelTokens.push('remote');
  collectIndexedCandidates(indexBundle.byWorkModel, workModelTokens, secondary);

  const candidateOrder: number[] = [];
  prioritized.forEach((ctxIndex) => {
    candidateOrder.push(ctxIndex);
  });
  secondary.forEach((ctxIndex) => {
    if (!prioritized.has(ctxIndex)) {
      candidateOrder.push(ctxIndex);
    }
  });

  if (candidateOrder.length === 0) {
    const fallbackPool = jobSignals.hasSignals
      ? indexBundle.allIndexes.slice(0, REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB)
      : indexBundle.allIndexes;
    for (const ctxIndex of fallbackPool) {
      candidateOrder.push(ctxIndex);
      if (candidateOrder.length >= REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB) break;
    }
  }

  if (candidateOrder.length > REVERSE_MATCH_MAX_CANDIDATES_PER_JOB) {
    return candidateOrder.slice(0, REVERSE_MATCH_MAX_CANDIDATES_PER_JOB);
  }
  return candidateOrder;
};

const buildReverseMatchAlertId = (userId: string, jobId: string): string =>
  createHash('sha256').update(`${userId}:${jobId}`).digest('hex');

const buildFeedMatchPulseEventId = (userId: string, jobId: string, bucketIso: string): string =>
  createHash('sha256').update(`feed-match:${userId}:${jobId}:${bucketIso}`).digest('hex');

const buildReverseMatchRecord = (
  context: MatchUserContext,
  job: any,
  roundedScore: number,
  reasons: string[],
  matchedSkills: string[],
): ReverseMatchRecord => {
  const jobId = readString(job?.id, 120);
  return {
    alertId: buildReverseMatchAlertId(context.userId, jobId),
    userId: context.userId,
    jobId,
    jobSlug: readString(job?.slug, 220),
    title: readString(job?.title, 140),
    companyName: readString(job?.companyName, 160),
    locationText: readString(job?.locationText, 180),
    score: roundedScore,
    reasons: reasons.slice(0, 4),
    matchedSkills: matchedSkills.slice(0, 6),
  };
};

const toReverseMatchUpsertOperation = (
  record: ReverseMatchRecord,
  nowIso: string,
): Record<string, unknown> => ({
  updateOne: {
    filter: { id: record.alertId },
    update: {
      $set: {
        score: record.score,
        reasons: record.reasons,
        matchedSkills: record.matchedSkills,
        updatedAt: nowIso,
      },
      $setOnInsert: {
        id: record.alertId,
        userId: record.userId,
        jobId: record.jobId,
        jobSlug: record.jobSlug,
        title: record.title,
        companyName: record.companyName,
        locationText: record.locationText,
        score: record.score,
        reasons: record.reasons,
        matchedSkills: record.matchedSkills,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    upsert: true,
  },
});

const toNotificationEntry = (record: ReverseMatchRecord): ReverseMatchNotificationEntry => ({
  userId: record.userId,
  jobId: record.jobId,
  jobSlug: record.jobSlug,
  title: record.title,
  companyName: record.companyName,
  score: record.score,
  reasons: record.reasons,
  matchedSkills: record.matchedSkills,
});

const resolvePerJobEvaluationCap = (totalEvalBudget: number, totalJobs: number): number =>
  Math.max(
    1,
    Math.min(
      REVERSE_MATCH_MAX_CANDIDATES_PER_JOB,
      Math.floor(totalEvalBudget / Math.max(1, totalJobs)),
    ),
  );

const collectWorkerCandidatesForJob = async (params: {
  contexts: MatchUserContext[];
  candidateContextIndexes: number[];
  perJobEvaluationCap: number;
  remainingGlobalBudget: number;
}): Promise<{ candidates: ReverseMatchWorkerCandidate[]; evaluationsUsed: number }> => {
  if (params.remainingGlobalBudget <= 0) {
    return { candidates: [], evaluationsUsed: 0 };
  }
  const candidates: ReverseMatchWorkerCandidate[] = [];
  let evaluationsUsed = 0;
  const cappedCandidateIndexes = params.candidateContextIndexes.slice(0, params.perJobEvaluationCap);

  for (const ctxIndex of cappedCandidateIndexes) {
    const context = params.contexts[ctxIndex];
    if (!context) continue;

    evaluationsUsed += 1;
    candidates.push({
      userId: context.userId,
      profile: context.profile,
    });
    if (evaluationsUsed % REVERSE_MATCH_YIELD_BATCH_SIZE === 0) {
      await yieldToEventLoop();
    }
  }

  return { candidates, evaluationsUsed };
};

const collectJobMatchCandidates = async (params: {
  job: any;
  contexts: MatchUserContext[];
  indexBundle: MatchIndexBundle;
  perJobEvaluationCap: number;
  remainingEvalBudget: number;
}): Promise<{ payload: ReverseMatchWorkerJobPayload | null; evaluationsUsed: number }> => {
  const jobId = readString(params.job?.id, 120);
  if (!jobId || params.remainingEvalBudget <= 0) {
    return { payload: null, evaluationsUsed: 0 };
  }

  const jobSignals = buildJobSignalBundle(params.job);
  const candidateContextIndexes = resolveCandidateContextIndexesForJob(params.indexBundle, jobSignals);
  if (candidateContextIndexes.length === 0) {
    return { payload: null, evaluationsUsed: 0 };
  }

  const { candidates, evaluationsUsed } = await collectWorkerCandidatesForJob({
    contexts: params.contexts,
    candidateContextIndexes,
    perJobEvaluationCap: params.perJobEvaluationCap,
    remainingGlobalBudget: params.remainingEvalBudget,
  });
  if (candidates.length === 0) {
    return { payload: null, evaluationsUsed };
  }

  return {
    payload: {
      jobId,
      job: params.job,
      candidates,
    },
    evaluationsUsed,
  };
};

const scoreCandidatesInProcess = async (
  payloads: ReverseMatchWorkerJobPayload[],
): Promise<Map<string, ReverseMatchWorkerJobResultEntry[]>> => {
  const scoredByJobId = new Map<string, ReverseMatchWorkerJobResultEntry[]>();

  for (const payload of payloads) {
    const entries: ReverseMatchWorkerJobResultEntry[] = [];
    for (let index = 0; index < payload.candidates.length; index += 1) {
      const candidate = payload.candidates[index];
      const entry = buildReverseMatchScoreEntry({
        job: payload.job,
        userId: candidate.userId,
        profile: candidate.profile,
        minScore: REVERSE_MATCH_MIN_SCORE,
      });
      if (entry) {
        entries.push(entry);
      }
      if ((index + 1) % REVERSE_MATCH_YIELD_BATCH_SIZE === 0) {
        await yieldToEventLoop();
      }
    }
    scoredByJobId.set(payload.jobId, entries);
  }

  return scoredByJobId;
};

const collectReverseMatchOperations = async (
  jobs: any[],
  contexts: MatchUserContext[],
  nowIso: string,
): Promise<{ operations: any[]; records: ReverseMatchRecord[] }> => {
  const operations: any[] = [];
  const records: ReverseMatchRecord[] = [];
  const indexBundle = resolveMatchIndexBundle(contexts);
  const contextByUserId = new Map<string, MatchUserContext>(
    contexts.map((context) => [context.userId, context] as const),
  );
  const jobsById = new Map<string, any>();
  const workerPayloads: ReverseMatchWorkerJobPayload[] = [];
  const perJobEvaluationCap = resolvePerJobEvaluationCap(
    REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN,
    jobs.length,
  );
  let scoreEvaluations = 0;

  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex];
    if (workerPayloads.length >= REVERSE_MATCH_MAX_JOBS_PER_RUN) break;

    const remainingEvalBudget = REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN - scoreEvaluations;
    if (remainingEvalBudget <= 0) break;

    const { payload, evaluationsUsed } = await collectJobMatchCandidates({
      job,
      contexts,
      indexBundle,
      perJobEvaluationCap,
      remainingEvalBudget,
    });
    scoreEvaluations += evaluationsUsed;
    if (!payload) continue;
    workerPayloads.push(payload);
    jobsById.set(payload.jobId, job);
  }

  if (workerPayloads.length === 0) {
    return { operations, records };
  }

  let scoredByJobId: Map<string, ReverseMatchWorkerJobResultEntry[]>;
  try {
    scoredByJobId = await scoreReverseMatchCandidatesInWorker({
      jobs: workerPayloads,
      minScore: REVERSE_MATCH_MIN_SCORE,
    });
  } catch (workerError) {
    console.warn('Reverse match scoring worker unavailable; falling back to in-process scoring.', workerError);
    scoredByJobId = await scoreCandidatesInProcess(workerPayloads);
  }

  for (const payload of workerPayloads) {
    const job = jobsById.get(payload.jobId);
    if (!job) continue;
    const scoredEntries = scoredByJobId.get(payload.jobId) || [];
    for (const entry of scoredEntries) {
      if (operations.length >= REVERSE_MATCH_MAX_OPS_PER_RUN) {
        return { operations, records };
      }
      const context = contextByUserId.get(entry.userId);
      if (!context) continue;
      const record = buildReverseMatchRecord(
        context,
        job,
        entry.score,
        entry.reasons,
        entry.matchedSkills,
      );
      operations.push(toReverseMatchUpsertOperation(record, nowIso));
      records.push(record);
    }
  }

  return { operations, records };
};

const resolveExistingAlertIds = async (params: {
  db: any;
  records: ReverseMatchRecord[];
}): Promise<Set<string>> => {
  const alertIds = Array.from(
    new Set(
      params.records
        .map((record) => readString(record.alertId, 160))
        .filter((id) => id.length > 0),
    ),
  ).slice(0, REVERSE_MATCH_MAX_OPS_PER_RUN);
  if (alertIds.length === 0) return new Set<string>();

  const existing = await params.db.collection(REVERSE_MATCH_ALERTS_COLLECTION)
    .find(
      { id: { $in: alertIds } },
      { projection: { id: 1 } },
    )
    .toArray();
  return new Set<string>(
    existing
      .map((entry: any) => readString((entry as any)?.id, 160))
      .filter((id: string) => id.length > 0),
  );
};

const persistReverseMatchOperations = async (params: {
  db: any;
  operations: any[];
}): Promise<boolean> => {
  try {
    await params.db.collection(REVERSE_MATCH_ALERTS_COLLECTION).bulkWrite(params.operations, { ordered: false });
    return true;
  } catch (bulkError: any) {
    console.error('Reverse match bulk write error:', bulkError);
    return false;
  }
};

export const processReverseJobMatchesForIngestedPayload = async (params: {
  db: any;
  jobIds: string[];
  nowIso: string;
}): Promise<void> => {
  if (!params.db || !Array.isArray(params.jobIds) || params.jobIds.length === 0) return;
  try {
    await ensureReverseMatchIndexes(params.db);
  } catch (error) {
    console.error('Reverse match index ensure error:', error);
    return;
  }

  const [jobs, userContexts] = await Promise.all([
    resolveOpenJobsForReverseMatch(params.db, params.jobIds),
    resolveCandidateUsersForReverseMatch(params.db),
  ]);
  if (jobs.length === 0 || userContexts.length === 0) return;

  const { operations, records } = await collectReverseMatchOperations(jobs, userContexts, params.nowIso);
  if (operations.length === 0 || records.length === 0) return;

  const existingAlertIds = await resolveExistingAlertIds({
    db: params.db,
    records,
  });

  const didPersist = await persistReverseMatchOperations({
    db: params.db,
    operations,
  });
  if (!didPersist) return;

  const insertedEntries = records
    .filter((record) => !existingAlertIds.has(record.alertId))
    .map((record) => toNotificationEntry(record));
  if (insertedEntries.length === 0) return;

  await recordJobPulseEvents(
    params.db,
    insertedEntries.map((entry) => ({
      jobId: entry.jobId,
      type: 'job_matched' as const,
      userId: entry.userId,
      createdAt: params.nowIso,
      metadata: {
        score: entry.score,
      },
    })),
  );

  const groupedByUser = groupReverseMatchNotificationEntriesByUser(insertedEntries);
  void dispatchGroupedReverseMatchNotifications({
    groupedByUser,
    notificationTopJobs: REVERSE_MATCH_NOTIFICATION_TOP_JOBS,
    notificationBatchSize: REVERSE_MATCH_NOTIFICATION_BATCH_SIZE,
  }).catch((error) => {
    console.error('Reverse match notification dispatch pipeline error:', error);
  });
};

export const listTopJobMatchesForUser = async (params: {
  db: any;
  user: any;
  limit?: number;
  candidateLimit?: number;
  recordPulse?: boolean;
}): Promise<any[]> => {
  const profile = buildRecommendationProfile(params.user);
  const candidateCriteria = buildRecommendationCandidateCriteria(profile);
  const candidateFilter = buildRecommendationCandidateMongoFilter(candidateCriteria);
  const candidateLimit = Number.isFinite(Number(params.candidateLimit))
    ? Math.max(30, Math.round(Number(params.candidateLimit)))
    : DEFAULT_MATCH_CANDIDATE_LIMIT;
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Math.round(Number(params.limit)))
    : DEFAULT_PUBLIC_MATCH_LIMIT;

  const candidateJobs = await fetchPrioritizedRecommendationCandidateJobs({
    db: params.db,
    recommendationCandidateFilter: candidateFilter,
    candidateLimit,
    hasPrioritySignals:
      candidateCriteria.skillTokens.length > 0
      || candidateCriteria.semanticTokens.length > 0
      || candidateCriteria.preferredWorkModels.length > 0,
  });

  const scored = candidateJobs
    .map((job) => {
      const score = buildJobRecommendationScore(job, profile);
      return { job, ...score };
    })
    .sort((left, right) => (right.score - left.score) || (right.publishedTs - left.publishedTs))
    .slice(0, limit);

  const results = scored.map((entry) => {
    const roundedScore = Math.max(0, Math.round(entry.score));
    return {
      ...entry.job,
      recommendationScore: roundedScore,
      recommendationReasons: entry.reasons.slice(0, 3),
      matchedSkills: entry.matchedSkills.slice(0, 5),
      matchTier: resolveRecommendationMatchTier(roundedScore),
    };
  });

  const userId = readString((params.user as any)?.id, 120);
  if ((params.recordPulse ?? true) && userId && results.length > 0) {
    const now = new Date();
    const bucketStartMs = Math.floor(now.getTime() / (10 * 60 * 1000)) * 10 * 60 * 1000;
    const bucketIso = new Date(bucketStartMs).toISOString();
    recordJobPulseEventsAsync(
      params.db,
      results.map((entry: any) => ({
        id: buildFeedMatchPulseEventId(userId, readString((entry as any)?.id, 120), bucketIso),
        jobId: readString((entry as any)?.id, 120),
        type: 'job_matched' as const,
        userId,
        createdAt: bucketIso,
        metadata: {
          source: 'live_match_feed',
          score: Number((entry as any)?.recommendationScore || 0),
        },
      })),
    );
  }

  return results;
};
