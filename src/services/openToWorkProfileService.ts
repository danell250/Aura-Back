import { Db } from 'mongodb';
import type { IUser } from '../models/User';
import { readString } from '../utils/inputSanitizers';
import { computeDemandSignals, type OpenToWorkDemandSignal } from './openToWorkDemandService';
import { getOpenToWorkMetrics7d } from './openToWorkMetricsService';

const REVERSE_MATCH_ALERTS_COLLECTION = 'job_reverse_match_alerts';
const OPEN_TO_WORK_MATCH_CACHE_TTL_MS = 10 * 60 * 1000;

export type OpenToWorkResponseFields = {
  openToWork?: boolean;
  availability?: string;
  preferredRoles?: string[];
  preferredLocations?: string[];
  preferredWorkModels?: string[];
  salaryExpectation?: string;
  portfolioUrl?: string;
  resumeAvailable?: boolean;
  profileCompleteness?: number;
  topSkills?: string[];
  jobsMatchingNow?: number;
  demandSignals?: OpenToWorkDemandSignal[];
  profileViews7d?: number;
  companyViews7d?: number;
  invitesToApply7d?: number;
};

type OpenToWorkUserRecord = Partial<IUser> & {
  firstName?: string;
  lastName?: string;
  name?: string;
  title?: string;
  bio?: string;
  country?: string;
  profileSkills?: string[];
  skills?: string[];
  openToWork?: boolean;
  availability?: string;
  preferredRoles?: string[];
  preferredLocations?: string[];
  preferredWorkModels?: string[];
  salaryExpectation?: string;
  portfolioUrl?: string;
  resumeKey?: string;
  resumeFileName?: string;
  resumeMimeType?: string;
  resumeSize?: number;
  defaultResumeKey?: string;
  defaultResumeFileName?: string;
  defaultResumeMimeType?: string;
  defaultResumeSize?: number;
  updatedAt?: string;
  createdAt?: string;
};

type ReverseMatchAlertRecord = {
  title?: string;
  createdAt?: string;
  updatedAt?: string;
};

type OpenToWorkJobSignalSnapshot = {
  jobsMatchingNow: number;
  demandSignals: OpenToWorkDemandSignal[];
};

const openToWorkJobSignalCache = new Map<string, {
  expiresAt: number;
  snapshot: OpenToWorkJobSignalSnapshot;
}>();

const normalizeArrayField = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    const normalized = readString(item, maxLength);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
    if (next.length >= maxItems) break;
  }
  return next;
};

const sanitizePortfolioUrl = (value: unknown): string => {
  const normalized = readString(value, 300);
  if (!normalized) return '';
  const prefixed = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
  return /^https?:\/\/.+/i.test(prefixed) ? prefixed : '';
};

export const computeOpenToWorkProfileCompleteness = (user: OpenToWorkUserRecord): number => {
  const checks = [
    readString(user.title, 120).length > 0,
    readString(user.bio, 600).length > 0,
    readString(user.country, 120).length > 0,
    readString(user.availability, 120).length > 0,
    normalizeArrayField(user.preferredRoles, 6, 120).length > 0,
    normalizeArrayField(user.preferredLocations, 6, 120).length > 0,
    normalizeArrayField(user.preferredWorkModels, 4, 40).length > 0,
    readString(user.salaryExpectation, 120).length > 0,
    sanitizePortfolioUrl(user.portfolioUrl).length > 0,
    Boolean(readString(user.resumeKey, 500) || readString(user.defaultResumeKey, 500)),
    normalizeArrayField(user.profileSkills, 10, 80).length > 0 || normalizeArrayField(user.skills, 10, 80).length > 0,
  ];
  const completed = checks.reduce((sum, check) => sum + (check ? 1 : 0), 0);
  return Math.round((completed / checks.length) * 100);
};

const buildJobSignalCacheKey = (user: OpenToWorkUserRecord): string => {
  const userId = readString(user.id, 120);
  const updatedAt = readString(user.updatedAt, 80) || readString(user.createdAt, 80);
  return `${userId}:${updatedAt}`;
};

const pruneOpenToWorkJobSignalCache = (now: number): void => {
  for (const [key, entry] of openToWorkJobSignalCache.entries()) {
    if (entry.expiresAt <= now) {
      openToWorkJobSignalCache.delete(key);
    }
  }
  while (openToWorkJobSignalCache.size > 500) {
    const oldest = openToWorkJobSignalCache.keys().next();
    if (oldest.done) break;
    openToWorkJobSignalCache.delete(oldest.value);
  }
};

const buildOpenToWorkJobSignalSnapshot = async (params: {
  db: Db;
  user: OpenToWorkUserRecord;
}): Promise<OpenToWorkJobSignalSnapshot> => {
  const userId = readString(params.user.id, 120);
  if (!userId) {
    return { jobsMatchingNow: 0, demandSignals: [] };
  }

  const matchedJobs = await params.db.collection<ReverseMatchAlertRecord>(REVERSE_MATCH_ALERTS_COLLECTION)
    .find(
      { userId },
      {
        projection: {
          title: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        sort: {
          updatedAt: -1,
          createdAt: -1,
        },
        limit: 60,
      },
    )
    .toArray();

  const signalJobs = matchedJobs.map((job) => ({
    title: readString(job.title, 140),
    discoveredAt: job.updatedAt,
    publishedAt: job.createdAt,
  }));

  return {
    jobsMatchingNow: signalJobs.length,
    demandSignals: computeDemandSignals(signalJobs),
  };
};

const getCachedOpenToWorkJobSignalSnapshot = async (params: {
  db: Db;
  user: OpenToWorkUserRecord;
}): Promise<OpenToWorkJobSignalSnapshot> => {
  const cacheKey = buildJobSignalCacheKey(params.user);
  const now = Date.now();
  pruneOpenToWorkJobSignalCache(now);
  const cached = openToWorkJobSignalCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.snapshot;
  }

  const snapshot = await buildOpenToWorkJobSignalSnapshot(params);
  openToWorkJobSignalCache.set(cacheKey, {
    snapshot,
    expiresAt: now + OPEN_TO_WORK_MATCH_CACHE_TTL_MS,
  });
  return snapshot;
};

export const buildOpenToWorkProfileResponse = async (params: {
  db: Db;
  user: OpenToWorkUserRecord;
  isSelf: boolean;
}): Promise<OpenToWorkResponseFields> => {
  const { db, user, isSelf } = params;
  const openToWork = user.openToWork === true;
  const topSkills = normalizeArrayField(
    Array.isArray(user.profileSkills) && user.profileSkills.length > 0
      ? user.profileSkills
      : user.skills,
    8,
    80,
  );
  const resumeAvailable = Boolean(readString(user.resumeKey, 500) || readString(user.defaultResumeKey, 500));
  const response: OpenToWorkResponseFields = {
    openToWork,
    profileCompleteness: computeOpenToWorkProfileCompleteness(user),
  };

  if (openToWork || isSelf) {
    response.availability = readString(user.availability, 120);
    response.preferredRoles = normalizeArrayField(user.preferredRoles, 6, 120);
    response.preferredLocations = normalizeArrayField(user.preferredLocations, 6, 120);
    response.preferredWorkModels = normalizeArrayField(user.preferredWorkModels, 4, 40);
    response.salaryExpectation = readString(user.salaryExpectation, 120);
    response.portfolioUrl = sanitizePortfolioUrl(user.portfolioUrl);
    response.resumeAvailable = resumeAvailable;
    response.topSkills = topSkills;

    const jobSignals = await getCachedOpenToWorkJobSignalSnapshot({ db, user });
    response.jobsMatchingNow = jobSignals.jobsMatchingNow;
    response.demandSignals = jobSignals.demandSignals;
  }

  if (isSelf) {
    const metrics = await getOpenToWorkMetrics7d({
      db,
      userId: readString(user.id, 120),
    });
    response.profileViews7d = metrics.profileViews7d;
    response.companyViews7d = metrics.companyViews7d;
    response.invitesToApply7d = metrics.invitesToApply7d;
  }

  if (!openToWork && !isSelf) {
    return {
      openToWork: false,
      profileCompleteness: response.profileCompleteness,
    };
  }

  return response;
};
