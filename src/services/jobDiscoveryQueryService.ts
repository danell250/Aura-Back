import crypto from 'crypto';
import { parsePositiveInt, readString } from '../utils/inputSanitizers';

export const JOBS_COLLECTION = 'jobs';
export const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
export const JOB_DISCOVERED_WINDOW_MINUTES = 30;
const JOB_DISCOVERED_COUNT_CACHE_TTL_MS = 60_000;
const JOB_DISCOVERED_COUNT_CACHE_MAX_KEYS = 100;

export type Pagination = {
  page: number;
  limit: number;
  skip: number;
};

type PublicJobsSortOption = 'latest' | 'salary_desc' | 'salary_asc';

export type PublicJobsQuerySpec = {
  filter: Record<string, unknown>;
  sort: Record<string, unknown>;
  usesTextSearch: boolean;
  searchText: string;
};

const discoveredCountCache = new Map<string, { count: number; expiresAt: number }>();
let jobsTextIndexEnsured = false;

const escapeRegexPattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sanitizeSearchRegex = (raw: string): RegExp | null => {
  const trimmed = readString(raw, 100);
  if (!trimmed) return null;
  const escaped = escapeRegexPattern(trimmed);
  return new RegExp(escaped, 'i');
};

const parseDelimitedAllowedValues = (raw: string, allowed: Set<string>): string[] =>
  raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0 && allowed.has(item));

export const getPagination = (query: Record<string, unknown>): Pagination => {
  const page = parsePositiveInt(query.page, 1, 1, 100000);
  const limit = parsePositiveInt(query.limit, 20, 1, 100);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

export const ensureJobsTextIndex = async (db: any): Promise<boolean> => {
  if (jobsTextIndexEnsured) return true;
  try {
    await db.collection(JOBS_COLLECTION).createIndex(
      {
        title: 'text',
        summary: 'text',
        description: 'text',
        locationText: 'text',
        companyName: 'text',
        companyHandle: 'text',
        tags: 'text',
      },
      {
        name: 'jobs_public_search_text_idx',
        weights: {
          title: 10,
          companyName: 8,
          tags: 6,
          summary: 4,
          description: 2,
          locationText: 2,
          companyHandle: 1,
        },
      },
    );
    jobsTextIndexEnsured = true;
    return true;
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('already exists') ||
      message.includes('index with name') ||
      message.includes('equivalent index already exists')
    ) {
      jobsTextIndexEnsured = true;
      return true;
    }
    console.error('Failed to ensure jobs text index:', error);
    return false;
  }
};

export const buildPublicJobsQuerySpec = (params: {
  status: string;
  workModelRaw: string;
  employmentTypeRaw: string;
  locationRaw: string;
  companyRaw: string;
  searchRaw: string;
  minSalary: number;
  maxSalary: number;
  postedWithinHours: number;
  sortBy: string;
  allowTextSearch: boolean;
}): PublicJobsQuerySpec => {
  const workModels = params.workModelRaw
    ? parseDelimitedAllowedValues(params.workModelRaw, ALLOWED_WORK_MODELS)
    : [];
  const employmentTypes = params.employmentTypeRaw
    ? parseDelimitedAllowedValues(params.employmentTypeRaw, ALLOWED_EMPLOYMENT_TYPES)
    : [];
  const locationRegex = sanitizeSearchRegex(params.locationRaw);
  const companyRegex = sanitizeSearchRegex(params.companyRaw);
  const searchText = readString(params.searchRaw, 120);

  const andClauses: Record<string, unknown>[] = [];
  if (params.status === 'all') {
    andClauses.push({ status: { $ne: 'archived' } });
  } else {
    andClauses.push({ status: params.status });
  }
  if (workModels.length > 0) {
    andClauses.push({ workModel: { $in: workModels } });
  }
  if (employmentTypes.length > 0) {
    andClauses.push({ employmentType: { $in: employmentTypes } });
  }
  if (locationRegex) {
    andClauses.push({ locationText: locationRegex });
  }
  if (companyRegex) {
    andClauses.push({ companyName: companyRegex });
  }
  if (Number.isFinite(params.minSalary) && params.minSalary > 0) {
    andClauses.push({
      $or: [
        { salaryMax: { $gte: params.minSalary } },
        { salaryMin: { $gte: params.minSalary } },
      ],
    });
  }
  if (Number.isFinite(params.maxSalary) && params.maxSalary > 0) {
    andClauses.push({
      $or: [
        { salaryMin: { $lte: params.maxSalary } },
        { salaryMax: { $lte: params.maxSalary } },
      ],
    });
  }
  if (Number.isFinite(params.postedWithinHours) && params.postedWithinHours > 0) {
    const thresholdIso = new Date(Date.now() - (params.postedWithinHours * 60 * 60 * 1000)).toISOString();
    andClauses.push({
      $or: [
        { publishedAt: { $gte: thresholdIso } },
        { createdAt: { $gte: thresholdIso } },
      ],
    });
  }
  const usesTextSearch = searchText.length > 0 && params.allowTextSearch;

  if (usesTextSearch) {
    andClauses.push({ $text: { $search: searchText } });
  }

  const filter =
    andClauses.length === 1
      ? andClauses[0]
      : andClauses.length > 1
        ? { $and: andClauses }
        : {};

  const sortByNormalized = readString(params.sortBy, 40).toLowerCase() as PublicJobsSortOption;
  const sort: Record<string, unknown> =
    sortByNormalized === 'salary_desc'
      ? { salaryMax: -1, salaryMin: -1, ...(usesTextSearch ? { score: { $meta: 'textScore' } } : {}), publishedAt: -1, createdAt: -1 }
      : sortByNormalized === 'salary_asc'
        ? { salaryMin: 1, salaryMax: 1, ...(usesTextSearch ? { score: { $meta: 'textScore' } } : {}), publishedAt: -1, createdAt: -1 }
        : usesTextSearch
          ? { score: { $meta: 'textScore' }, publishedAt: -1, createdAt: -1 }
          : { publishedAt: -1, createdAt: -1 };

  return {
    filter: filter as Record<string, unknown>,
    sort,
    usesTextSearch,
    searchText,
  };
};

export const buildDiscoveredWindowFilter = (
  baseFilter: Record<string, unknown>,
  thresholdIso: string,
): Record<string, unknown> => {
  const hasBaseFilter = baseFilter && Object.keys(baseFilter).length > 0;
  const discoveredClause = {
    discoveredAt: {
      $type: 'string',
      $gte: thresholdIso,
    },
  };
  if (!hasBaseFilter) return discoveredClause;
  return { $and: [baseFilter, discoveredClause] };
};

export const buildDiscoveredCountCacheKey = (parts: Record<string, unknown>): string => {
  const normalizedParts = Object.entries(parts)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value ?? ''))}`)
    .join('&');
  return crypto.createHash('sha256').update(normalizedParts).digest('hex');
};

const refreshDiscoveredCountCacheEntry = (
  cacheKey: string,
  entry: { count: number; expiresAt: number },
) => {
  discoveredCountCache.delete(cacheKey);
  discoveredCountCache.set(cacheKey, entry);
};

const storeDiscoveredCountCacheEntry = (
  cacheKey: string,
  entry: { count: number; expiresAt: number },
  now: number,
) => {
  refreshDiscoveredCountCacheEntry(cacheKey, entry);
  pruneDiscoveredCountCache(now);
};

const pruneDiscoveredCountCache = (now: number) => {
  for (const [key, cacheValue] of discoveredCountCache.entries()) {
    if (cacheValue.expiresAt <= now) {
      discoveredCountCache.delete(key);
    }
  }
  while (discoveredCountCache.size > JOB_DISCOVERED_COUNT_CACHE_MAX_KEYS) {
    const oldestEntry = discoveredCountCache.keys().next();
    if (oldestEntry.done) break;
    discoveredCountCache.delete(oldestEntry.value);
  }
};

export const resolveCachedDiscoveredCount = async (
  db: any,
  filter: Record<string, unknown>,
  cacheKey: string,
): Promise<number> => {
  const now = Date.now();
  pruneDiscoveredCountCache(now);

  const cached = discoveredCountCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    refreshDiscoveredCountCacheEntry(cacheKey, cached);
    return cached.count;
  }

  const count = await db.collection(JOBS_COLLECTION).countDocuments(filter);
  storeDiscoveredCountCacheEntry(cacheKey, {
    count,
    expiresAt: now + JOB_DISCOVERED_COUNT_CACHE_TTL_MS,
  }, now);
  return count;
};
