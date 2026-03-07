import { readString } from '../utils/inputSanitizers';
import type { SavedJobState } from './savedJobsService';

const SAVED_JOB_STATE_CACHE_TTL_MS = 30_000;
const SAVED_JOB_STATE_CACHE_MAX_ITEMS = 10_000;
const SAVED_JOB_STATE_CACHE_CLEANUP_INTERVAL_MS = 60_000;

type SavedJobCacheEntry = {
  state: SavedJobState | null;
  expiresAt: number;
};

const savedJobStateCache = new Map<string, SavedJobCacheEntry>();

const buildCacheKey = (currentUserId: string, jobId: string): string => `${currentUserId}:${jobId}`;

const evictSavedJobStateCacheEntries = (): void => {
  while (savedJobStateCache.size > SAVED_JOB_STATE_CACHE_MAX_ITEMS) {
    const oldestKey = savedJobStateCache.keys().next().value;
    if (!oldestKey) break;
    savedJobStateCache.delete(oldestKey);
  }
};

const pruneExpiredSavedJobStateCacheEntries = (): void => {
  if (savedJobStateCache.size === 0) return;
  const now = Date.now();
  for (const [cacheKey, entry] of savedJobStateCache.entries()) {
    if (!entry || entry.expiresAt <= now) {
      savedJobStateCache.delete(cacheKey);
    }
  }
};

const savedJobStateCacheCleanupTimer = setInterval(() => {
  pruneExpiredSavedJobStateCacheEntries();
}, SAVED_JOB_STATE_CACHE_CLEANUP_INTERVAL_MS);

if (typeof (savedJobStateCacheCleanupTimer as any)?.unref === 'function') {
  (savedJobStateCacheCleanupTimer as any).unref();
}

const touchAndReadCacheEntry = (cacheKey: string): SavedJobCacheEntry | null => {
  const cached = savedJobStateCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    savedJobStateCache.delete(cacheKey);
    return null;
  }
  savedJobStateCache.delete(cacheKey);
  savedJobStateCache.set(cacheKey, cached);
  return cached;
};

export const getCachedSavedJobState = (params: {
  currentUserId: string;
  jobId: string;
}): SavedJobState | null | undefined => {
  const currentUserId = readString(params.currentUserId, 120);
  const jobId = readString(params.jobId, 120);
  if (!currentUserId || !jobId) return undefined;

  const cached = touchAndReadCacheEntry(buildCacheKey(currentUserId, jobId));
  if (!cached) return undefined;
  return cached.state;
};

export const setCachedSavedJobState = (params: {
  currentUserId: string;
  jobId: string;
  state: SavedJobState | null;
}): void => {
  const currentUserId = readString(params.currentUserId, 120);
  const jobId = readString(params.jobId, 120);
  if (!currentUserId || !jobId) return;

  const cacheKey = buildCacheKey(currentUserId, jobId);
  savedJobStateCache.delete(cacheKey);
  savedJobStateCache.set(cacheKey, {
    state: params.state,
    expiresAt: Date.now() + SAVED_JOB_STATE_CACHE_TTL_MS,
  });
  evictSavedJobStateCacheEntries();
};

export const getCachedSavedJobStates = (params: {
  currentUserId: string;
  jobIds: string[];
}): {
  statesByJobId: Map<string, SavedJobState>;
  missingJobIds: string[];
} => {
  const currentUserId = readString(params.currentUserId, 120);
  const userKeyPrefix = currentUserId ? `${currentUserId}:` : '';
  const jobIds = Array.from(
    new Set(
      (Array.isArray(params.jobIds) ? params.jobIds : [])
        .map((jobId) => readString(jobId, 120))
        .filter((jobId) => jobId.length > 0),
    ),
  );

  const statesByJobId = new Map<string, SavedJobState>();
  const missingJobIds: string[] = [];
  if (!currentUserId || jobIds.length === 0) {
    return { statesByJobId, missingJobIds };
  }

  jobIds.forEach((jobId) => {
    const cached = touchAndReadCacheEntry(`${userKeyPrefix}${jobId}`);
    if (!cached) {
      missingJobIds.push(jobId);
      return;
    }
    if (cached.state) {
      statesByJobId.set(jobId, cached.state);
    }
  });

  return { statesByJobId, missingJobIds };
};
