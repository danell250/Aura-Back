import crypto from 'crypto';
import {
  buildUserDigestJobsForProfile,
  buildUserDigestRecommendationProfile,
  createUserDigestCandidateIndex,
  listUserDigestCandidateJobs,
  type DigestJobItem,
  type UserDigestCandidateIndex,
} from './jobAlertDigestJobsService';
import { sendJobAlertDigestEmail } from './jobAlertEmailService';
import { readString } from '../utils/inputSanitizers';
import { getPublicWebUrl } from '../utils/publicWebUrl';
import { runSettledBatches, runSettledConcurrentChunks } from '../utils/recurringBatchUtils';

const USERS_COLLECTION = 'users';
const APP_BASE_URL = getPublicWebUrl();
const JOB_ALERT_USER_DIGEST_INTERVAL_MS = Number.isFinite(Number(process.env.JOB_ALERT_USER_DIGEST_INTERVAL_HOURS))
  ? Math.max(24, Math.round(Number(process.env.JOB_ALERT_USER_DIGEST_INTERVAL_HOURS))) * 60 * 60 * 1000
  : 48 * 60 * 60 * 1000;
const JOB_ALERT_USER_BATCH_SIZE = Number.isFinite(Number(process.env.JOB_ALERT_USER_BATCH_SIZE))
  ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_USER_BATCH_SIZE)))
  : 16;
const JOB_ALERT_MAX_USERS_PER_RUN = Number.isFinite(Number(process.env.JOB_ALERT_MAX_USERS_PER_RUN))
  ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_MAX_USERS_PER_RUN)))
  : 150;
const JOB_ALERT_USER_SHARED_CANDIDATE_LIMIT = Number.isFinite(Number(process.env.JOB_ALERT_USER_SHARED_CANDIDATE_LIMIT))
  ? Math.min(420, Math.max(140, Math.round(Number(process.env.JOB_ALERT_USER_SHARED_CANDIDATE_LIMIT))))
  : 420;
const JOB_ALERT_USER_DIGEST_CACHE_LIMIT = Math.min(
  128,
  Math.max(80, Math.ceil(JOB_ALERT_MAX_USERS_PER_RUN * 0.67)),
);
const JOB_ALERT_USER_DIGEST_CACHE_MAX_BYTES = Number.isFinite(Number(process.env.JOB_ALERT_USER_DIGEST_CACHE_MAX_BYTES))
  ? Math.max(64 * 1024, Math.round(Number(process.env.JOB_ALERT_USER_DIGEST_CACHE_MAX_BYTES)))
  : 512 * 1024;
const JOB_ALERT_USER_DIGEST_CACHE_TTL_MS = Math.min(15 * 60 * 1000, JOB_ALERT_USER_DIGEST_INTERVAL_MS);
const JOB_ALERT_USER_DIGEST_WINDOW_BUFFER_MS = Number.isFinite(Number(process.env.JOB_ALERT_USER_DIGEST_WINDOW_BUFFER_HOURS))
  ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_USER_DIGEST_WINDOW_BUFFER_HOURS))) * 60 * 60 * 1000
  : 6 * 60 * 60 * 1000;
const JOB_ALERT_USER_GROUP_CONCURRENCY = Number.isFinite(Number(process.env.JOB_ALERT_USER_GROUP_CONCURRENCY))
  ? Math.max(1, Math.min(4, Math.round(Number(process.env.JOB_ALERT_USER_GROUP_CONCURRENCY))))
  : 2;

type DigestJobsCacheEntry = {
  jobs: DigestJobItem[];
  createdAtMs: number;
  approxBytes: number;
};

const getDefaultDigestWindowStartIso = (): string =>
  new Date(Date.now() - JOB_ALERT_USER_DIGEST_INTERVAL_MS - JOB_ALERT_USER_DIGEST_WINDOW_BUFFER_MS).toISOString();

const normalizeUserDigestWindowStartIso = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return getDefaultDigestWindowStartIso();
  }
  return parsed.toISOString();
};

const hasUserJobDigestSignals = (user: any): boolean => {
  if (Boolean(user?.openToWork)) return true;
  if (readString(user?.title, 120)) return true;
  if (Array.isArray(user?.skills) && user.skills.length > 0) return true;
  if (Array.isArray(user?.profileSkills) && user.profileSkills.length > 0) return true;
  if (Array.isArray(user?.preferredRoles) && user.preferredRoles.length > 0) return true;
  return false;
};

const buildDigestWindowStartIso = (lastDigestAtRaw: string): string => {
  const configuredWindowStartIso = getDefaultDigestWindowStartIso();
  const configuredWindowStartTs = new Date(configuredWindowStartIso).getTime();
  const normalized = normalizeUserDigestWindowStartIso(lastDigestAtRaw || configuredWindowStartIso);
  return new Date(normalized).getTime() < configuredWindowStartTs
    ? configuredWindowStartIso
    : normalized;
};

const normalizeDigestCacheList = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => readString(value, 120).trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();

const DIGEST_CACHE_KEY_SEPARATOR = '\u001f';

const buildUserDigestCacheKey = (user: any, windowStartIso: string): string =>
  crypto.createHash('sha1').update(
    [
      windowStartIso,
      readString(user?.title, 160).trim().toLowerCase(),
      readString(user?.location, 160).trim().toLowerCase(),
      readString(user?.country, 120).trim().toLowerCase(),
      readString(user?.industry, 160).trim().toLowerCase(),
      readString(user?.remotePreference, 80).trim().toLowerCase(),
      readString(user?.workPreference, 80).trim().toLowerCase(),
      readString(user?.experienceLevel, 80).trim().toLowerCase(),
      readString(user?.seniority, 80).trim().toLowerCase(),
      normalizeDigestCacheList(Array.isArray(user?.skills) ? user.skills : []).join(','),
      normalizeDigestCacheList(Array.isArray(user?.profileSkills) ? user.profileSkills : []).join(','),
      normalizeDigestCacheList(Array.isArray(user?.preferredRoles) ? user.preferredRoles : []).join(','),
      normalizeDigestCacheList(Array.isArray(user?.preferredLocations) ? user.preferredLocations : []).join(','),
      normalizeDigestCacheList(Array.isArray(user?.preferredWorkModels) ? user.preferredWorkModels : []).join(','),
    ].join(DIGEST_CACHE_KEY_SEPARATOR),
  ).digest('hex');

const resolveUserDigestRecipientName = (user: any): string =>
  readString(user?.firstName, 120) || readString(user?.name, 160) || 'there';

const estimateDigestJobsCacheEntryBytes = (cacheKey: string, jobs: DigestJobItem[]): number =>
  (cacheKey.length * 2) + jobs.reduce((sum, job) =>
    sum
    + (job.title?.length || 0) * 2
    + (job.companyName?.length || 0) * 2
    + (job.locationText?.length || 0) * 2
    + (job.url?.length || 0) * 2
    + 64,
  0);

const getDigestJobsCacheSizeBytes = (cache: Map<string, DigestJobsCacheEntry>): number =>
  Array.from(cache.values()).reduce((sum, entry) => sum + entry.approxBytes, 0);

const updateUserDigestTimestamp = async (params: {
  db: any;
  userId: string;
  nowIso: string;
}): Promise<void> => {
  await params.db.collection(USERS_COLLECTION).updateOne(
    { id: params.userId },
    {
      $set: {
        lastJobDigestAt: params.nowIso,
      },
    },
  );
};

const setDigestJobsCacheEntry = (params: {
  cache: Map<string, DigestJobsCacheEntry>;
  cacheKey: string;
  jobs: DigestJobItem[];
}): void => {
  const nowMs = Date.now();
  for (const [entryKey, entry] of params.cache.entries()) {
    if (nowMs - entry.createdAtMs > JOB_ALERT_USER_DIGEST_CACHE_TTL_MS) {
      params.cache.delete(entryKey);
    }
  }

  if (params.cache.has(params.cacheKey)) {
    params.cache.delete(params.cacheKey);
  }

  const nextApproxBytes = estimateDigestJobsCacheEntryBytes(params.cacheKey, params.jobs);
  while (
    params.cache.size >= JOB_ALERT_USER_DIGEST_CACHE_LIMIT
    || (params.cache.size > 0 && getDigestJobsCacheSizeBytes(params.cache) + nextApproxBytes > JOB_ALERT_USER_DIGEST_CACHE_MAX_BYTES)
  ) {
    const oldestKey = params.cache.keys().next().value;
    if (typeof oldestKey === 'string') {
      params.cache.delete(oldestKey);
      continue;
    }
    break;
  }

  params.cache.set(params.cacheKey, {
    jobs: params.jobs,
    createdAtMs: nowMs,
    approxBytes: nextApproxBytes,
  });
};

const resolveUserDigestJobs = async (params: {
  db: any;
  user: any;
  candidateIndex?: UserDigestCandidateIndex;
  digestJobsCache: Map<string, DigestJobsCacheEntry>;
}): Promise<{ windowStartIso: string; jobs: DigestJobItem[] }> => {
  const lastDigestAt = readString(params.user?.lastJobDigestAt, 80);
  const windowStartIso = buildDigestWindowStartIso(lastDigestAt);
  const cacheKey = buildUserDigestCacheKey(params.user, windowStartIso);
  const cachedEntry = params.digestJobsCache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.createdAtMs <= JOB_ALERT_USER_DIGEST_CACHE_TTL_MS) {
    params.digestJobsCache.delete(cacheKey);
    params.digestJobsCache.set(cacheKey, cachedEntry);
    return {
      windowStartIso,
      jobs: cachedEntry.jobs,
    };
  }
  if (cachedEntry) {
    params.digestJobsCache.delete(cacheKey);
  }

  const recommendationProfile = buildUserDigestRecommendationProfile(params.user);
  const jobs = await buildUserDigestJobsForProfile({
    db: params.db,
    recommendationProfile,
    windowStartIso,
    candidateIndex: params.candidateIndex,
  });
  setDigestJobsCacheEntry({
    cache: params.digestJobsCache,
    cacheKey,
    jobs,
  });
  return {
    windowStartIso,
    jobs,
  };
};

const listUsersDueForJobDigests = async (params: {
  db: any;
  cutoffIso: string;
}): Promise<any[]> =>
  params.db.collection(USERS_COLLECTION)
    .find(
      {
        email: { $type: 'string', $ne: '' },
        $and: [
          {
            $or: [
              { 'privacySettings.emailNotifications': { $exists: false } },
              { 'privacySettings.emailNotifications': true },
            ],
          },
          {
            $or: [
              { lastJobDigestAt: { $exists: false } },
              { lastJobDigestAt: null },
              { lastJobDigestAt: { $lt: params.cutoffIso } },
            ],
          },
        ],
      },
      {
        projection: {
          id: 1,
          email: 1,
          firstName: 1,
          name: 1,
          handle: 1,
          title: 1,
          openToWork: 1,
          skills: 1,
          profileSkills: 1,
          preferredRoles: 1,
          preferredLocations: 1,
          preferredWorkModels: 1,
          location: 1,
          country: 1,
          remotePreference: 1,
          workPreference: 1,
          experienceLevel: 1,
          seniority: 1,
          jobSeniorityPreference: 1,
          yearsOfExperience: 1,
          experienceYears: 1,
          totalExperienceYears: 1,
          industry: 1,
          lastJobDigestAt: 1,
          privacySettings: 1,
        },
      },
    )
    .limit(JOB_ALERT_MAX_USERS_PER_RUN)
    .toArray();

const groupUsersByDigestWindow = (users: any[]): Array<{ windowStartIso: string; users: any[] }> => {
  const groups = new Map<string, any[]>();

  users.forEach((user) => {
    const windowStartIso = buildDigestWindowStartIso(readString(user?.lastJobDigestAt, 80));
    const bucket = groups.get(windowStartIso);
    if (bucket) {
      bucket.push(user);
      return;
    }
    groups.set(windowStartIso, [user]);
  });

  return Array.from(groups.entries()).map(([windowStartIso, groupedUsers]) => ({
    windowStartIso,
    users: groupedUsers,
  }));
};

const deliverEveryOtherDayUserDigest = async (params: {
  db: any;
  user: any;
  nowIso: string;
  candidateIndex?: UserDigestCandidateIndex;
  digestJobsCache: Map<string, DigestJobsCacheEntry>;
}): Promise<void> => {
  const { db, user, nowIso, candidateIndex, digestJobsCache } = params;
  if (!hasUserJobDigestSignals(user)) return;

  const email = readString(user?.email, 220).toLowerCase();
  if (!email) return;

  const { jobs } = await resolveUserDigestJobs({
    db,
    user,
    candidateIndex,
    digestJobsCache,
  });
  if (jobs.length === 0) return;

  await sendJobAlertDigestEmail(email, {
    recipientName: resolveUserDigestRecipientName(user),
    headline: 'New jobs for you on Aura',
    subheadline: 'Fresh roles discovered since your last Aura job alert.',
    jobs,
    ctaUrl: `${APP_BASE_URL}/jobs/recommended`,
    ctaLabel: 'Open my job board',
    manageUrl: `${APP_BASE_URL}/settings?tab=privacy`,
  });

  await updateUserDigestTimestamp({
    db,
    userId: user.id,
    nowIso,
  });
};

const processEveryOtherDayUserDigestGroup = async (params: {
  db: any;
  group: { windowStartIso: string; users: any[] };
  nowIso: string;
  sharedCandidateIndex: UserDigestCandidateIndex;
  digestJobsCache: Map<string, DigestJobsCacheEntry>;
}): Promise<void> => {
  await runSettledBatches({
    items: params.group.users,
    batchSize: JOB_ALERT_USER_BATCH_SIZE,
    worker: (user) =>
      deliverEveryOtherDayUserDigest({
        db: params.db,
        user,
        nowIso: params.nowIso,
        candidateIndex: params.sharedCandidateIndex,
        digestJobsCache: params.digestJobsCache,
      }),
    onRejected: (reason) => {
      console.error('User job digest dispatch error:', reason);
    },
  });
};

export const sendEveryOtherDayUserJobAlertDigests = async (db: any): Promise<void> => {
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - JOB_ALERT_USER_DIGEST_INTERVAL_MS).toISOString();
  const dueUsers = await listUsersDueForJobDigests({
    db,
    cutoffIso,
  });
  if (dueUsers.length === 0) return;

  const groupedUsers = groupUsersByDigestWindow(dueUsers);
  const oldestWindowStartIso = groupedUsers.reduce((oldest, group) => {
    if (!oldest) return group.windowStartIso;
    return new Date(group.windowStartIso).getTime() < new Date(oldest).getTime() ? group.windowStartIso : oldest;
  }, '');
  const sharedCandidateJobs = await listUserDigestCandidateJobs({
    db,
    windowStartIso: oldestWindowStartIso || getDefaultDigestWindowStartIso(),
    limit: JOB_ALERT_USER_SHARED_CANDIDATE_LIMIT,
  });
  const sharedCandidateIndex = createUserDigestCandidateIndex(sharedCandidateJobs);
  const digestJobsCache = new Map<string, DigestJobsCacheEntry>();

  await runSettledConcurrentChunks({
    items: groupedUsers,
    concurrency: JOB_ALERT_USER_GROUP_CONCURRENCY,
    worker: (group) =>
        processEveryOtherDayUserDigestGroup({
          db,
          group,
          nowIso,
          sharedCandidateIndex,
          digestJobsCache,
        }),
    onRejected: (reason) => {
      console.error('User job digest group error:', reason);
    },
  });
};
