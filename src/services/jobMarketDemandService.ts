import type { Db } from 'mongodb';
import { parsePositiveInt, readString } from '../utils/inputSanitizers';
import { buildJobMarketDemandEntries } from './jobMarketDemandScoringService';
import {
  ALLOWED_WORK_MODELS,
  TREND_WINDOW_DAYS,
  buildJobMarketDemandSnapshotContext,
  loadJobMarketDemandBaselineSnapshots,
  loadJobMarketDemandSnapshotGroups,
  startOfJobMarketDemandUtcDay,
  toJobMarketDemandIsoDate,
} from './jobMarketDemandStorageService';
import type {
  GroupAccumulator,
  JobMarketDemandQuery,
  JobMarketDemandResult,
} from './jobMarketDemandTypes';
import { normalizeDemandRoleFamily } from './openToWorkDemandService';

type MarketDemandCacheEntry = {
  expiresAt: number;
  data: JobMarketDemandResult;
};

type MarketDemandExecutionState = {
  location: string;
  workModel: string | null;
  limit: number;
  normalizedRoleFilters: Array<{ roleFamily: string; label: string }>;
  requestedRoleFamilies: Set<string>;
  context: ReturnType<typeof buildJobMarketDemandSnapshotContext>;
  todayBucket: string;
  historicalBucket: string;
  cacheKey: string;
  personalized: boolean;
};

const MARKET_DEMAND_CACHE_TTL_MS = 60_000;
const MARKET_DEMAND_CACHE_MAX_KEYS = 100;
const marketDemandCache = new Map<string, MarketDemandCacheEntry>();

const pruneMarketDemandCache = (now: number): void => {
  for (const [key, value] of marketDemandCache.entries()) {
    if (value.expiresAt <= now) {
      marketDemandCache.delete(key);
    }
  }
  while (marketDemandCache.size > MARKET_DEMAND_CACHE_MAX_KEYS) {
    const oldest = marketDemandCache.keys().next();
    if (oldest.done) break;
    marketDemandCache.delete(oldest.value);
  }
};

const normalizeRoleFilters = (roles: string[]): Array<{ roleFamily: string; label: string }> => {
  const seen = new Set<string>();
  const normalized: Array<{ roleFamily: string; label: string }> = [];
  for (const role of roles) {
    const mapped = normalizeDemandRoleFamily(role);
    if (!mapped || seen.has(mapped.roleFamily)) continue;
    seen.add(mapped.roleFamily);
    normalized.push(mapped);
    if (normalized.length >= 10) break;
  }
  return normalized;
};

const touchMarketDemandCache = (cacheKey: string, entry: MarketDemandCacheEntry): void => {
  marketDemandCache.delete(cacheKey);
  marketDemandCache.set(cacheKey, entry);
};

const readCachedMarketDemand = (cacheKey: string): JobMarketDemandResult | null => {
  pruneMarketDemandCache(Date.now());
  const cached = marketDemandCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    marketDemandCache.delete(cacheKey);
    return null;
  }
  touchMarketDemandCache(cacheKey, cached);
  return cached.data;
};

const storeMarketDemandCache = (cacheKey: string, data: JobMarketDemandResult): void => {
  pruneMarketDemandCache(Date.now());
  marketDemandCache.set(cacheKey, {
    expiresAt: Date.now() + MARKET_DEMAND_CACHE_TTL_MS,
    data,
  });
  pruneMarketDemandCache(Date.now());
};

export const clearJobMarketDemandCache = (): void => {
  marketDemandCache.clear();
};

const buildMarketDemandExecutionState = (params: {
  query?: JobMarketDemandQuery;
  personalized?: boolean;
}): MarketDemandExecutionState => {
  const location = readString(params.query?.location, 120);
  const normalizedWorkModelRaw = readString(params.query?.workModel, 20).toLowerCase();
  const workModel = ALLOWED_WORK_MODELS.has(normalizedWorkModelRaw) ? normalizedWorkModelRaw : null;
  const limit = parsePositiveInt(params.query?.limit, 6, 1, 12);
  const normalizedRoleFilters = normalizeRoleFilters(Array.isArray(params.query?.roles) ? params.query.roles : []);
  const requestedRoleFamilies = new Set(normalizedRoleFilters.map((entry) => entry.roleFamily));
  const roleCacheKey = normalizedRoleFilters.map((entry) => entry.roleFamily).sort();
  const context = buildJobMarketDemandSnapshotContext({ location, workModel });
  const todayBucket = toJobMarketDemandIsoDate(startOfJobMarketDemandUtcDay(new Date()));
  const historicalBucket = toJobMarketDemandIsoDate(
    startOfJobMarketDemandUtcDay(new Date(Date.now() - (TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000))),
  );

  return {
    location,
    workModel,
    limit,
    normalizedRoleFilters,
    requestedRoleFamilies,
    context,
    todayBucket,
    historicalBucket,
    cacheKey: JSON.stringify({
      location: context.locationKey,
      workModel: context.workModelKey,
      roles: roleCacheKey,
      limit,
      personalized: Boolean(params.personalized),
    }),
    personalized: Boolean(params.personalized),
  };
};

const buildMarketDemandResult = (params: {
  state: MarketDemandExecutionState;
  groups: Map<string, GroupAccumulator>;
  baselineSnapshots: Awaited<ReturnType<typeof loadJobMarketDemandBaselineSnapshots>>;
}): JobMarketDemandResult => ({
  entries: buildJobMarketDemandEntries({
    groups: params.groups,
    requestedRoleFamilies: params.state.requestedRoleFamilies,
    limit: params.state.limit,
    baselineSnapshots: params.baselineSnapshots,
  }),
  meta: {
    location: params.state.context.location,
    workModel: params.state.context.workModel,
    roles: params.state.normalizedRoleFilters.map((entry) => entry.label),
    trendWindowDays: TREND_WINDOW_DAYS,
    salarySource: 'listed_job_salaries',
    snapshotDate: params.state.todayBucket,
    trendAvailable: params.baselineSnapshots !== null,
    personalized: params.state.personalized,
  },
});

const loadFreshMarketDemandResult = async (params: {
  db: Db;
  state: MarketDemandExecutionState;
}): Promise<JobMarketDemandResult> => {
  const groups = await loadJobMarketDemandSnapshotGroups({
    db: params.db,
    context: params.state.context,
    bucketDate: params.state.todayBucket,
  }) || new Map<string, GroupAccumulator>();
  const baselineSnapshots = await loadJobMarketDemandBaselineSnapshots({
    db: params.db,
    context: params.state.context,
    bucketDate: params.state.historicalBucket,
  });
  return buildMarketDemandResult({
    state: params.state,
    groups,
    baselineSnapshots,
  });
};

export const listJobMarketDemand = async (params: {
  db: Db;
  query?: JobMarketDemandQuery;
  personalized?: boolean;
}): Promise<JobMarketDemandResult> => {
  const state = buildMarketDemandExecutionState(params);
  const cached = readCachedMarketDemand(state.cacheKey);
  if (cached) return cached;

  const result = await loadFreshMarketDemandResult({
    db: params.db,
    state,
  });

  storeMarketDemandCache(state.cacheKey, result);
  return result;
};

export type {
  JobMarketDemandEntry,
  JobMarketDemandMeta,
  JobMarketDemandQuery,
  JobMarketDemandResult,
  JobMarketDemandSnapshotContext,
} from './jobMarketDemandTypes';
