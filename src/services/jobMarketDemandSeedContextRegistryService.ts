import type { Db } from 'mongodb';
import { readString } from '../utils/inputSanitizers';
import { buildJobMarketDemandSnapshotContext } from './jobMarketDemandStorageService';
import type { JobMarketDemandSnapshotContext } from './jobMarketDemandTypes';

const JOB_MARKET_DEMAND_SEED_CONTEXTS_COLLECTION = 'job_market_demand_seed_contexts';
let jobMarketDemandSeedContextIndexesPromise: Promise<void> | null = null;

const buildRegistryEntries = (params: {
  locationText?: unknown;
  workModel?: unknown;
  status?: unknown;
}): Array<{ contextKey: string; location?: string; workModel?: string | null }> => {
  const status = readString(params.status, 40).toLowerCase();
  if (status && status !== 'open') return [];

  const location = readString(params.locationText, 160);
  const workModel = readString(params.workModel, 40).toLowerCase() || null;
  if (!location) return [];

  const contexts = [
    buildJobMarketDemandSnapshotContext({ location }),
    buildJobMarketDemandSnapshotContext({ location, workModel }),
  ];

  return Array.from(
    new Map(
      contexts
        .filter((context) => Boolean(context.location))
        .map((context) => [context.locationKey + '::' + context.workModelKey, {
          contextKey: `${context.locationKey}::${context.workModelKey}`,
          location: context.location || undefined,
          workModel: context.workModel,
        }]),
    ).values(),
  );
};

export const ensureJobMarketDemandSeedContextRegistryIndexes = async (db: Db): Promise<void> => {
  if (!jobMarketDemandSeedContextIndexesPromise) {
    jobMarketDemandSeedContextIndexesPromise = (async () => {
      await db.collection(JOB_MARKET_DEMAND_SEED_CONTEXTS_COLLECTION).createIndex(
        { contextKey: 1 },
        { unique: true, name: 'job_market_demand_seed_contexts_key_idx' },
      );
    })().catch((error) => {
      jobMarketDemandSeedContextIndexesPromise = null;
      throw error;
    });
  }
  return jobMarketDemandSeedContextIndexesPromise;
};

export const registerJobMarketDemandSeedContexts = async (params: {
  db: Db;
  jobs: Array<{ locationText?: unknown; workModel?: unknown; status?: unknown }>;
}): Promise<void> => {
  if (params.jobs.length === 0) return;
  await ensureJobMarketDemandSeedContextRegistryIndexes(params.db);
  const entries = params.jobs.flatMap((job) => buildRegistryEntries(job));
  if (entries.length === 0) return;

  const nowIso = new Date().toISOString();
  const operations = entries.map((entry) => ({
    updateOne: {
      filter: { contextKey: entry.contextKey },
      update: {
        $setOnInsert: {
          createdAt: nowIso,
        },
        $set: {
          contextKey: entry.contextKey,
          location: entry.location || null,
          workModel: entry.workModel || null,
          refreshedAt: nowIso,
        },
      },
      upsert: true,
    },
  }));

  await params.db.collection(JOB_MARKET_DEMAND_SEED_CONTEXTS_COLLECTION).bulkWrite(operations, { ordered: false });
};

export const listJobMarketDemandSeedContexts = async (params: {
  db: Db;
  limit: number;
}): Promise<JobMarketDemandSnapshotContext[]> => {
  await ensureJobMarketDemandSeedContextRegistryIndexes(params.db);
  const docs = await params.db.collection(JOB_MARKET_DEMAND_SEED_CONTEXTS_COLLECTION)
    .find({}, { projection: { location: 1, workModel: 1 } })
    .sort({ refreshedAt: -1, createdAt: -1 })
    .limit(params.limit)
    .toArray();

  return docs.map((doc) => ({
    location: readString((doc as any)?.location, 160) || undefined,
    workModel: readString((doc as any)?.workModel, 40).toLowerCase() || null,
  }));
};
