import type { Db } from 'mongodb';
import { readString } from '../utils/inputSanitizers';
import { clearJobMarketDemandCache } from './jobMarketDemandService';
import { loadJobMarketDemandSnapshotSeedContexts } from './jobMarketDemandSnapshotContextService';
import {
  aggregateJobMarketDemandGroups,
  buildJobMarketDemandSnapshotContext,
  ensureJobMarketDemandIndexes,
  startOfJobMarketDemandUtcDay,
  toJobMarketDemandIsoDate,
  writeJobMarketDemandSnapshotGroups,
} from './jobMarketDemandStorageService';
import type { JobMarketDemandSnapshotContext } from './jobMarketDemandTypes';

const JOB_MARKET_DEMAND_SNAPSHOT_CONCURRENCY = 2;

const syncSnapshotContext = async (params: {
  db: Db;
  bucketDate: string;
  context: JobMarketDemandSnapshotContext;
}): Promise<void> => {
  const groups = await aggregateJobMarketDemandGroups({
    db: params.db,
    location: params.context.location,
    workModel: params.context.workModel,
  });
  await writeJobMarketDemandSnapshotGroups({
    db: params.db,
    context: buildJobMarketDemandSnapshotContext({
      location: params.context.location,
      workModel: params.context.workModel,
    }),
    bucketDate: params.bucketDate,
    groups,
  });
};

const executeSnapshotContextQueue = async (params: {
  db: Db;
  bucketDate: string;
  contexts: JobMarketDemandSnapshotContext[];
}): Promise<void> => {
  const queue = [...params.contexts];
  const workerCount = Math.max(1, Math.min(JOB_MARKET_DEMAND_SNAPSHOT_CONCURRENCY, queue.length));
  let failure: Error | null = null;

  const worker = async () => {
    while (queue.length > 0 && !failure) {
      const context = queue.shift();
      if (!context) return;
      try {
        await syncSnapshotContext({
          db: params.db,
          bucketDate: params.bucketDate,
          context,
        });
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Job market demand snapshot sync failed');
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failure) {
    throw failure;
  }
};

const prepareJobMarketDemandSnapshotSync = async (params: {
  db: Db;
  bucketDate?: string;
}): Promise<{ bucketDate: string; contexts: JobMarketDemandSnapshotContext[] }> => {
  await ensureJobMarketDemandIndexes(params.db);
  const bucketDate = readString(params.bucketDate, 20)
    || toJobMarketDemandIsoDate(startOfJobMarketDemandUtcDay(new Date()));
  const contexts = await loadJobMarketDemandSnapshotSeedContexts(params.db);
  return {
    bucketDate,
    contexts,
  };
};

const executeJobMarketDemandSnapshotSync = async (params: {
  db: Db;
  bucketDate: string;
  contexts: JobMarketDemandSnapshotContext[];
}): Promise<{ bucketDate: string; contexts: number }> => {
  await executeSnapshotContextQueue({
    db: params.db,
    bucketDate: params.bucketDate,
    contexts: params.contexts,
  });
  clearJobMarketDemandCache();
  return {
    bucketDate: params.bucketDate,
    contexts: params.contexts.length,
  };
};

export const syncJobMarketDemandSnapshots = async (params: {
  db: Db;
  bucketDate?: string;
}): Promise<{ bucketDate: string; contexts: number }> => {
  const prepared = await prepareJobMarketDemandSnapshotSync(params);
  return executeJobMarketDemandSnapshotSync({
    db: params.db,
    bucketDate: prepared.bucketDate,
    contexts: prepared.contexts,
  });
};
