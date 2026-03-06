import type { Db } from 'mongodb';
import { listJobMarketDemandSeedContexts } from './jobMarketDemandSeedContextRegistryService';
import { buildJobMarketDemandSnapshotContext } from './jobMarketDemandStorageService';
import type { JobMarketDemandSnapshotContext } from './jobMarketDemandTypes';

const JOB_MARKET_DEMAND_SNAPSHOT_SEED_CONTEXT_LIMIT = 120;
const JOB_MARKET_DEMAND_SEED_CONTEXT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);

type SnapshotSeedContextCacheEntry = {
  expiresAt: number;
  contexts: JobMarketDemandSnapshotContext[];
};

let snapshotSeedContextCache: SnapshotSeedContextCacheEntry | null = null;

const buildSnapshotContextKey = (context: JobMarketDemandSnapshotContext): string => {
  const normalized = buildJobMarketDemandSnapshotContext({
    location: context.location,
    workModel: context.workModel,
  });
  return `${normalized.locationKey}::${normalized.workModelKey}`;
};

const queueSnapshotContext = (
  contexts: Map<string, JobMarketDemandSnapshotContext>,
  context: JobMarketDemandSnapshotContext,
): void => {
  const key = buildSnapshotContextKey(context);
  if (!contexts.has(key)) {
    contexts.set(key, context);
  }
};

const readCachedSnapshotSeedContexts = (): JobMarketDemandSnapshotContext[] | null => {
  if (!snapshotSeedContextCache) return null;
  if (snapshotSeedContextCache.expiresAt <= Date.now()) {
    snapshotSeedContextCache = null;
    return null;
  }
  return snapshotSeedContextCache.contexts;
};

const storeSnapshotSeedContexts = (contexts: JobMarketDemandSnapshotContext[]): void => {
  snapshotSeedContextCache = {
    contexts,
    expiresAt: Date.now() + JOB_MARKET_DEMAND_SEED_CONTEXT_CACHE_TTL_MS,
  };
};

export const invalidateJobMarketDemandSeedContextCache = (): void => {
  snapshotSeedContextCache = null;
};

export const loadJobMarketDemandSnapshotSeedContexts = async (db: Db): Promise<JobMarketDemandSnapshotContext[]> => {
  const cached = readCachedSnapshotSeedContexts();
  if (cached) return cached;

  const contexts = new Map<string, JobMarketDemandSnapshotContext>();

  queueSnapshotContext(contexts, {});
  ALLOWED_WORK_MODELS.forEach((workModel) => {
    queueSnapshotContext(contexts, { workModel });
  });

  const registeredContexts = await listJobMarketDemandSeedContexts({
    db,
    limit: JOB_MARKET_DEMAND_SNAPSHOT_SEED_CONTEXT_LIMIT,
  });
  registeredContexts.forEach((context) => {
    if (context.location) {
      queueSnapshotContext(contexts, { location: context.location });
      if (context.workModel) {
        queueSnapshotContext(contexts, {
          location: context.location,
          workModel: context.workModel,
        });
      }
    }
  });

  const nextContexts = Array.from(contexts.values());
  storeSnapshotSeedContexts(nextContexts);
  return nextContexts;
};
