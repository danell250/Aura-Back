import { createHash } from 'crypto';
import { createNotificationInDB } from '../controllers/notificationsController';
import {
  buildJobRecommendationScore,
  buildRecommendationCandidateFilter,
  buildRecommendationProfile,
  resolveRecommendationMatchTier,
} from './jobRecommendationService';
import { readString } from '../utils/inputSanitizers';

const USERS_COLLECTION = 'users';
const JOBS_COLLECTION = 'jobs';
const REVERSE_MATCH_ALERTS_COLLECTION = 'job_reverse_match_alerts';

const REVERSE_MATCH_MIN_SCORE = Number.isFinite(Number(process.env.REVERSE_MATCH_MIN_SCORE))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_MIN_SCORE)))
  : 70;
const REVERSE_MATCH_MAX_USER_SCAN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_USER_SCAN))
  ? Math.max(100, Math.round(Number(process.env.REVERSE_MATCH_MAX_USER_SCAN)))
  : 3000;
const REVERSE_MATCH_MAX_JOBS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_JOBS_PER_RUN))
  ? Math.max(20, Math.round(Number(process.env.REVERSE_MATCH_MAX_JOBS_PER_RUN)))
  : 400;
const REVERSE_MATCH_MAX_OPS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_OPS_PER_RUN))
  ? Math.max(200, Math.round(Number(process.env.REVERSE_MATCH_MAX_OPS_PER_RUN)))
  : 25000;
const REVERSE_MATCH_MAX_CANDIDATES_PER_JOB = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_CANDIDATES_PER_JOB))
  ? Math.max(60, Math.round(Number(process.env.REVERSE_MATCH_MAX_CANDIDATES_PER_JOB)))
  : 180;
const REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB = Number.isFinite(Number(process.env.REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB))
  ? Math.max(20, Math.round(Number(process.env.REVERSE_MATCH_FALLBACK_CANDIDATES_PER_JOB)))
  : 80;
const REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN))
  ? Math.max(2000, Math.round(Number(process.env.REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN)))
  : 18000;
const REVERSE_MATCH_NOTIFICATION_TOP_JOBS = Number.isFinite(Number(process.env.REVERSE_MATCH_NOTIFICATION_TOP_JOBS))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_NOTIFICATION_TOP_JOBS)))
  : 5;
const REVERSE_MATCH_NOTIFICATION_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_NOTIFICATION_BATCH_SIZE))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_NOTIFICATION_BATCH_SIZE)))
  : 25;
const REVERSE_MATCH_SCORE_YIELD_EVERY = Number.isFinite(Number(process.env.REVERSE_MATCH_SCORE_YIELD_EVERY))
  ? Math.max(20, Math.round(Number(process.env.REVERSE_MATCH_SCORE_YIELD_EVERY)))
  : 120;
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

type ReverseMatchNotificationEntry = {
  userId: string;
  jobId: string;
  jobSlug: string;
  title: string;
  companyName: string;
  score: number;
  reasons: string[];
  matchedSkills: string[];
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
  locationTokens: string[];
  semanticTokens: string[];
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

const hasIntersection = (left: Set<string>, rightTokens: string[]): boolean => {
  if (left.size === 0 || rightTokens.length === 0) return false;
  for (const token of rightTokens) {
    if (left.has(token)) return true;
  }
  return false;
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

const yieldToEventLoop = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

const runTasksInBatches = async (
  tasks: Array<() => Promise<void>>,
  batchSize: number,
): Promise<void> => {
  for (let index = 0; index < tasks.length; index += batchSize) {
    const batch = tasks.slice(index, index + batchSize);
    await Promise.allSettled(batch.map((task) => task()));
    await yieldToEventLoop();
  }
};

const normalizeExternalUrl = (value: unknown): string => {
  const raw = readString(String(value || ''), 700);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const buildIngestFilterKey = (source: string, originalId: string, originalUrl: string): string => {
  if (source && originalId) return `s:${source}|i:${originalId}`;
  if (source && originalUrl) return `s:${source}|u:${originalUrl}`;
  return '';
};

const resolveIngestedOpenJobsFromPayload = async (db: any, rawJobs: unknown[]): Promise<any[]> => {
  const filters: Array<Record<string, unknown>> = [];
  const dedupe = new Set<string>();

  for (const raw of rawJobs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const payload = raw as Record<string, unknown>;
    const source = readString(payload.source, 80).toLowerCase();
    const originalId = readString(payload.originalId, 240);
    const originalUrl = normalizeExternalUrl(payload.originalUrl);
    const key = buildIngestFilterKey(source, originalId, originalUrl);
    if (!key || dedupe.has(key)) continue;
    dedupe.add(key);
    if (source && originalId) {
      filters.push({ source, originalId });
      continue;
    }
    if (source && originalUrl) {
      filters.push({ source, originalUrl });
    }
  }

  if (filters.length === 0) return [];

  return db.collection(JOBS_COLLECTION)
    .find(
      {
        status: 'open',
        $or: filters,
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
  if (reverseMatchIndexesPromise) return reverseMatchIndexesPromise;
  if (
    reverseMatchIndexesLastFailureAtMs > 0
    && (Date.now() - reverseMatchIndexesLastFailureAtMs) < REVERSE_MATCH_INDEX_RETRY_BACKOFF_MS
  ) {
    return;
  }
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
      reverseMatchIndexesPromise = null;
      throw error;
    }
  })();
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

const buildJobSignalBundle = (job: any): JobSignalBundle => {
  const skillTokens = extractJobSkillTokens(job);
  const locationTokens = extractJobLocationTokens(job);
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
    locationTokens,
    semanticTokens,
    workModel,
    isRemoteRole,
    hasSignals:
      skillTokens.length > 0
      || locationTokens.length > 0
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
  collectIndexedCandidates(indexBundle.byIndustryToken, jobSignals.semanticTokens, secondary);

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

const passesReverseMatchCoarseFilter = (
  context: MatchUserContext,
  jobSignals: JobSignalBundle,
): boolean => {
  const userHasWorkPreference = context.preferredWorkModels.size > 0;
  const hasWorkModelMatch =
    !userHasWorkPreference
    || (jobSignals.workModel ? context.preferredWorkModels.has(jobSignals.workModel) : false)
    || (jobSignals.isRemoteRole && context.preferredWorkModels.has('remote'));
  if (!hasWorkModelMatch) return false;

  const hasSkillMatch = hasIntersection(context.skillTokens, jobSignals.skillTokens);
  const hasLocationMatch = hasIntersection(context.locationTokens, jobSignals.locationTokens);
  const hasIndustryMatch = hasIntersection(context.industryTokens, jobSignals.semanticTokens);

  if (hasSkillMatch || hasLocationMatch || hasIndustryMatch) return true;
  if (!jobSignals.hasSignals) return true;

  const userHasSignal =
    context.skillTokens.size > 0
    || context.locationTokens.size > 0
    || context.industryTokens.size > 0
    || context.preferredWorkModels.size > 0;

  if (!userHasSignal) return true;
  if (userHasWorkPreference && hasWorkModelMatch) return true;

  return false;
};

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

const resolvePerJobEvaluationCap = (remainingEvalBudget: number, jobsRemaining: number): number =>
  Math.max(
    40,
    Math.min(
      REVERSE_MATCH_MAX_CANDIDATES_PER_JOB,
      Math.floor(remainingEvalBudget / Math.max(1, jobsRemaining)),
    ),
  );

const collectScoredRecordsForJob = async (params: {
  job: any;
  jobSignals: JobSignalBundle;
  candidateContextIndexes: number[];
  contexts: MatchUserContext[];
  perJobEvaluationCap: number;
  remainingGlobalBudget: number;
}): Promise<{ records: ReverseMatchRecord[]; evaluationsUsed: number }> => {
  const records: ReverseMatchRecord[] = [];
  let evaluatedForJob = 0;
  let evaluationsUsed = 0;

  for (const ctxIndex of params.candidateContextIndexes) {
    if (evaluatedForJob >= params.perJobEvaluationCap || evaluationsUsed >= params.remainingGlobalBudget) {
      break;
    }
    const context = params.contexts[ctxIndex];
    if (!context) continue;
    if (!passesReverseMatchCoarseFilter(context, params.jobSignals)) continue;

    evaluatedForJob += 1;
    evaluationsUsed += 1;
    const scoreResult = buildJobRecommendationScore(params.job, context.profile);
    if (evaluationsUsed % REVERSE_MATCH_SCORE_YIELD_EVERY === 0) {
      await yieldToEventLoop();
    }
    const roundedScore = Math.max(0, Math.round(scoreResult.score));
    if (roundedScore < REVERSE_MATCH_MIN_SCORE) continue;

    records.push(buildReverseMatchRecord(
      context,
      params.job,
      roundedScore,
      scoreResult.reasons,
      scoreResult.matchedSkills,
    ));
  }

  return { records, evaluationsUsed };
};

const collectJobMatchRecords = async (params: {
  job: any;
  jobIndex: number;
  totalJobs: number;
  contexts: MatchUserContext[];
  indexBundle: MatchIndexBundle;
  remainingEvalBudget: number;
}): Promise<{ records: ReverseMatchRecord[]; evaluationsUsed: number }> => {
  const jobId = readString(params.job?.id, 120);
  if (!jobId || params.remainingEvalBudget <= 0) {
    return { records: [], evaluationsUsed: 0 };
  }

  const jobSignals = buildJobSignalBundle(params.job);
  const candidateContextIndexes = resolveCandidateContextIndexesForJob(params.indexBundle, jobSignals);
  if (candidateContextIndexes.length === 0) {
    return { records: [], evaluationsUsed: 0 };
  }

  const perJobEvaluationCap = resolvePerJobEvaluationCap(
    params.remainingEvalBudget,
    params.totalJobs - params.jobIndex,
  );

  return collectScoredRecordsForJob({
    job: params.job,
    jobSignals,
    candidateContextIndexes,
    contexts: params.contexts,
    perJobEvaluationCap,
    remainingGlobalBudget: params.remainingEvalBudget,
  });
};

const collectReverseMatchOperations = async (
  jobs: any[],
  contexts: MatchUserContext[],
  nowIso: string,
): Promise<{ operations: any[]; records: ReverseMatchRecord[] }> => {
  const operations: any[] = [];
  const records: ReverseMatchRecord[] = [];
  const indexBundle = resolveMatchIndexBundle(contexts);
  let scoreEvaluations = 0;

  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex];
    if (operations.length >= REVERSE_MATCH_MAX_OPS_PER_RUN) break;

    const remainingEvalBudget = REVERSE_MATCH_MAX_SCORE_EVALUATIONS_PER_RUN - scoreEvaluations;
    if (remainingEvalBudget <= 0) break;

    const { records: scoredRecords, evaluationsUsed } = await collectJobMatchRecords({
      job,
      jobIndex,
      totalJobs: jobs.length,
      contexts,
      indexBundle,
      remainingEvalBudget,
    });
    scoreEvaluations += evaluationsUsed;
    if (scoredRecords.length === 0) continue;

    for (const record of scoredRecords) {
      if (operations.length >= REVERSE_MATCH_MAX_OPS_PER_RUN) break;
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

const dispatchReverseMatchNotifications = async (
  groupedByUser: Map<string, ReverseMatchNotificationEntry[]>,
): Promise<void> => {
  const tasks: Array<() => Promise<void>> = [];
  for (const [userId, entries] of groupedByUser.entries()) {
    if (entries.length === 0) continue;
    tasks.push(async () => {
      const sortedEntries = [...entries].sort((left, right) => right.score - left.score);
      const topEntries = sortedEntries.slice(0, REVERSE_MATCH_NOTIFICATION_TOP_JOBS);
      const matchCount = entries.length;
      const message = `🔥 ${matchCount} new job${matchCount === 1 ? '' : 's'} match your profile`;
      const meta = {
        category: 'reverse_job_match',
        matchCount,
        jobs: topEntries.map((entry) => ({
          jobId: entry.jobId,
          slug: entry.jobSlug,
          title: entry.title,
          companyName: entry.companyName,
          score: entry.score,
          matchTier: resolveRecommendationMatchTier(entry.score),
          reasons: entry.reasons,
          matchedSkills: entry.matchedSkills,
        })),
      };

      try {
        await createNotificationInDB(
          userId,
          'job_match_alert',
          'system',
          message,
          undefined,
          undefined,
          meta,
          undefined,
          'user',
        );
      } catch (error) {
        console.error('Reverse match notification dispatch error:', error);
      }
    });
  }

  if (tasks.length === 0) return;
  await runTasksInBatches(tasks, REVERSE_MATCH_NOTIFICATION_BATCH_SIZE);
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

const groupNotificationEntriesByUser = (
  entries: ReverseMatchNotificationEntry[],
): Map<string, ReverseMatchNotificationEntry[]> => {
  const groupedByUser = new Map<string, ReverseMatchNotificationEntry[]>();
  entries.forEach((entry) => {
    if (!entry.userId) return;
    const bucket = groupedByUser.get(entry.userId) || [];
    bucket.push(entry);
    groupedByUser.set(entry.userId, bucket);
  });
  return groupedByUser;
};

export const processReverseJobMatchesForIngestedPayload = async (params: {
  db: any;
  rawJobs: unknown[];
  nowIso: string;
}): Promise<void> => {
  if (!params.db || !Array.isArray(params.rawJobs) || params.rawJobs.length === 0) return;
  try {
    await ensureReverseMatchIndexes(params.db);
  } catch (error) {
    console.error('Reverse match index ensure error:', error);
    return;
  }

  const [jobs, userContexts] = await Promise.all([
    resolveIngestedOpenJobsFromPayload(params.db, params.rawJobs),
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

  const groupedByUser = groupNotificationEntriesByUser(insertedEntries);
  void dispatchReverseMatchNotifications(groupedByUser).catch((error) => {
    console.error('Reverse match notification dispatch pipeline error:', error);
  });
};

export const listTopJobMatchesForUser = async (params: {
  db: any;
  user: any;
  limit?: number;
  candidateLimit?: number;
}): Promise<any[]> => {
  const profile = buildRecommendationProfile(params.user);
  const candidateFilter = buildRecommendationCandidateFilter(profile);
  const candidateLimit = Number.isFinite(Number(params.candidateLimit))
    ? Math.max(30, Math.round(Number(params.candidateLimit)))
    : DEFAULT_MATCH_CANDIDATE_LIMIT;
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Math.round(Number(params.limit)))
    : DEFAULT_PUBLIC_MATCH_LIMIT;

  const preferredConditions = Array.isArray((candidateFilter as any)?.$or)
    ? ((candidateFilter as any).$or as Array<Record<string, unknown>>)
    : [];

  let candidateJobs: any[] = [];
  if (preferredConditions.length === 0) {
    candidateJobs = await params.db.collection(JOBS_COLLECTION)
      .find({ status: 'open' })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(candidateLimit)
      .toArray();
  } else {
    const coarseLimit = Math.min(600, Math.max(candidateLimit * 2, 160));
    candidateJobs = await params.db.collection(JOBS_COLLECTION)
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
        { $limit: candidateLimit },
        { $project: { __recommendationPriority: 0 } },
      ])
      .toArray();
  }

  const scored = candidateJobs
    .map((job) => {
      const score = buildJobRecommendationScore(job, profile);
      return { job, ...score };
    })
    .sort((left, right) => (right.score - left.score) || (right.publishedTs - left.publishedTs))
    .slice(0, limit);

  return scored.map((entry) => {
    const roundedScore = Math.max(0, Math.round(entry.score));
    return {
      ...entry.job,
      recommendationScore: roundedScore,
      recommendationReasons: entry.reasons.slice(0, 3),
      matchedSkills: entry.matchedSkills.slice(0, 5),
      matchTier: resolveRecommendationMatchTier(roundedScore),
    };
  });
};
