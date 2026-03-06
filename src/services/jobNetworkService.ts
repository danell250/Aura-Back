import { readString } from '../utils/inputSanitizers';

const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';
export const MAX_NETWORK_COUNT_SCAN_IDS = 25;
const NETWORK_COUNT_CACHE_TTL_MS = 5 * 60_000;
const NETWORK_COUNT_CACHE_MAX_KEYS = 500;

const networkCountCache = new Map<string, { count: number; expiresAt: number }>();

const buildNetworkCountCacheKey = (companyId: string, viewerUserId: string): string =>
  `${companyId}:${viewerUserId}`;

const getCachedNetworkCount = (cacheKey: string): number | null => {
  const cached = networkCountCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    networkCountCache.delete(cacheKey);
    return null;
  }
  return cached.count;
};

export const readCachedCompanyNetworkCount = (params: {
  companyId: string;
  viewerUserId: string;
}): number | null => {
  const companyId = readString(params.companyId, 120);
  const viewerUserId = readString(params.viewerUserId, 120);
  if (!companyId || !viewerUserId) {
    return null;
  }
  return getCachedNetworkCount(buildNetworkCountCacheKey(companyId, viewerUserId));
};

const setCachedNetworkCount = (cacheKey: string, count: number): void => {
  if (networkCountCache.size >= NETWORK_COUNT_CACHE_MAX_KEYS) {
    const oldestKey = networkCountCache.keys().next().value;
    if (oldestKey) {
      networkCountCache.delete(oldestKey);
    }
  }
  networkCountCache.set(cacheKey, {
    count,
    expiresAt: Date.now() + NETWORK_COUNT_CACHE_TTL_MS,
  });
};

export const countCompanyNetworkMembers = async (params: {
  db: any;
  companyId: string;
  viewerUserId: string;
  acquaintanceIds: unknown[];
}): Promise<number> => {
  const boundedAcquaintanceIds = params.acquaintanceIds.slice(0, MAX_NETWORK_COUNT_SCAN_IDS);
  const normalizedIds = Array.from(
    new Set(
      boundedAcquaintanceIds
        .map((value) => readString(value, 120))
        .filter((value) => value.length > 0),
    ),
  );

  if (!params.companyId || normalizedIds.length === 0) {
    return 0;
  }

  const cacheKey = buildNetworkCountCacheKey(params.companyId, params.viewerUserId);
  const cachedCount = getCachedNetworkCount(cacheKey);
  if (cachedCount != null) {
    return cachedCount;
  }

  const count = await params.db.collection(COMPANY_MEMBERS_COLLECTION).countDocuments({
    companyId: params.companyId,
    userId: { $in: normalizedIds },
  }, {
    hint: { companyId: 1, userId: 1 },
  });
  setCachedNetworkCount(cacheKey, count);
  return count;
};

export const refreshCompanyNetworkCount = async (params: {
  db: any;
  companyId: string;
  viewerUserId: string;
}): Promise<void> => {
  try {
    const viewerUserId = readString(params.viewerUserId, 120);
    if (!viewerUserId) {
      return;
    }

    const currentUser = await params.db.collection(USERS_COLLECTION).findOne(
      { id: viewerUserId },
      { projection: { acquaintances: { $slice: MAX_NETWORK_COUNT_SCAN_IDS } } },
    );
    await countCompanyNetworkMembers({
      db: params.db,
      companyId: params.companyId,
      viewerUserId,
      acquaintanceIds: Array.isArray(currentUser?.acquaintances) ? currentUser.acquaintances : [],
    });
  } catch (error) {
    console.warn('Refresh company network count error:', error);
  }
};

export const scheduleCompanyNetworkCountRefresh = (params: {
  db: any;
  companyId: string;
  viewerUserId: string;
}): void => {
  setTimeout(() => {
    void refreshCompanyNetworkCount(params);
  }, 0);
};
