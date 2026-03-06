import { getDB, isDBConnected } from '../db';
import { recordJobPulseEventAsync } from './jobPulseService';

const JOBS_COLLECTION = 'jobs';
const JOB_VIEW_FLUSH_INTERVAL_MS = 5000;
const JOB_VIEW_BUFFER_MAX_KEYS = 400;
const JOB_VIEW_BUFFER_HARD_MAX_KEYS = 1000;
const JOB_VIEW_BUFFER_GROWTH_STEP_KEYS = 500;
const JOB_VIEW_FLUSH_BATCH_SIZE = 100;

const pendingJobViewCount = new Map<string, number>();
const flushingJobViewCount = new Map<string, number>();
let isJobViewFlushScheduled = false;
let isJobViewFlushInFlight = false;
let shouldFlushJobViewCountAgain = false;
let isJobViewShutdownHookRegistered = false;
let jobViewCountDbProvider: (() => any) | null = null;
let hasLoggedJobViewBufferGrowth = false;
let jobViewFlushChain: Promise<void> = Promise.resolve();
let jobViewFlushTimer: NodeJS.Timeout | null = null;
let isJobViewShutdownDraining = false;
let jobViewBufferCapacity = JOB_VIEW_BUFFER_HARD_MAX_KEYS;

const takePendingJobViewCountBatch = (): Array<[string, number]> => {
  if (flushingJobViewCount.size > 0) {
    return [];
  }

  const snapshot = Array.from(pendingJobViewCount.entries()).slice(0, JOB_VIEW_FLUSH_BATCH_SIZE);
  for (const [jobId, count] of snapshot) {
    pendingJobViewCount.delete(jobId);
    flushingJobViewCount.set(jobId, count);
  }
  return snapshot;
};

const clearFlushingJobViewCountBatch = (): void => {
  flushingJobViewCount.clear();
};

const restoreFlushingJobViewCountBatch = (): void => {
  for (const [jobId, count] of flushingJobViewCount.entries()) {
    pendingJobViewCount.set(jobId, (pendingJobViewCount.get(jobId) || 0) + count);
  }
  flushingJobViewCount.clear();
};

const flushJobViewCountBuffer = async (db: any): Promise<void> => {
  if (isJobViewFlushInFlight) {
    shouldFlushJobViewCountAgain = true;
    return;
  }
  if (pendingJobViewCount.size === 0) return;
  const snapshot = takePendingJobViewCountBatch();
  if (snapshot.length === 0) return;

  isJobViewFlushInFlight = true;
  const operations = snapshot.map(([jobId, count]) => ({
    updateOne: {
      filter: { id: jobId, status: { $ne: 'archived' } },
      update: { $inc: { viewCount: count } },
    },
  }));

  try {
    await db.collection(JOBS_COLLECTION).bulkWrite(operations, { ordered: false });
    clearFlushingJobViewCountBatch();
  } catch (error: any) {
    restoreFlushingJobViewCountBatch();
    console.warn('Flush job view count buffer error:', error);
  } finally {
    isJobViewFlushInFlight = false;
    if (pendingJobViewCount.size <= JOB_VIEW_BUFFER_HARD_MAX_KEYS) {
      jobViewBufferCapacity = JOB_VIEW_BUFFER_HARD_MAX_KEYS;
      hasLoggedJobViewBufferGrowth = false;
    }
    const shouldFlushAgain = shouldFlushJobViewCountAgain || pendingJobViewCount.size >= JOB_VIEW_BUFFER_MAX_KEYS;
    shouldFlushJobViewCountAgain = false;
    if (pendingJobViewCount.size > 0 && !isJobViewShutdownDraining) {
      scheduleJobViewCountFlush(db);
      if (shouldFlushAgain) {
        return;
      }
    }
  }
};

const scheduleJobViewCountFlush = (db: any): void => {
  if (isJobViewFlushScheduled) return;
  isJobViewFlushScheduled = true;
  jobViewFlushTimer = setTimeout(() => {
    jobViewFlushTimer = null;
    isJobViewFlushScheduled = false;
    jobViewFlushChain = jobViewFlushChain
      .then(() => flushJobViewCountBuffer(db))
      .catch((error) => {
        console.warn('Flush job view count queue error:', error);
      });
  }, JOB_VIEW_FLUSH_INTERVAL_MS);
};

export const registerJobViewCountShutdownHooks = (dbProvider: () => any = getDB): void => {
  jobViewCountDbProvider = dbProvider;
  if (isJobViewShutdownHookRegistered) return;
  isJobViewShutdownHookRegistered = true;
};

export const flushRegisteredJobViewCountBuffer = async (): Promise<void> => {
  if (!jobViewCountDbProvider || !isDBConnected()) return;
  isJobViewShutdownDraining = true;
  if (jobViewFlushTimer) {
    clearTimeout(jobViewFlushTimer);
    jobViewFlushTimer = null;
    isJobViewFlushScheduled = false;
  }
  try {
    await jobViewFlushChain;
    const db = jobViewCountDbProvider();
    let previousPendingSize = -1;
    while (
      (pendingJobViewCount.size > 0 || flushingJobViewCount.size > 0)
      && pendingJobViewCount.size !== previousPendingSize
    ) {
      await jobViewFlushChain;
      previousPendingSize = pendingJobViewCount.size;
      await flushJobViewCountBuffer(db);
    }
    await jobViewFlushChain;
  } finally {
    isJobViewShutdownDraining = false;
  }
};

export const incrementJobViewCountAsync = (db: any, jobId: string, userId?: string): void => {
  if (!jobId) return;
  if (!pendingJobViewCount.has(jobId) && pendingJobViewCount.size >= jobViewBufferCapacity) {
    jobViewBufferCapacity += JOB_VIEW_BUFFER_GROWTH_STEP_KEYS;
    if (!hasLoggedJobViewBufferGrowth) {
      hasLoggedJobViewBufferGrowth = true;
      console.warn(
        `Job view count buffer exceeded ${JOB_VIEW_BUFFER_HARD_MAX_KEYS} unique jobs. Expanding buffer capacity to ${jobViewBufferCapacity} while the queued writes drain.`,
      );
    }
  }
  pendingJobViewCount.set(jobId, (pendingJobViewCount.get(jobId) || 0) + 1);
  recordJobPulseEventAsync(db, {
    jobId,
    type: 'job_viewed',
    userId,
  });
  if (pendingJobViewCount.size >= JOB_VIEW_BUFFER_MAX_KEYS) {
    scheduleJobViewCountFlush(db);
    return;
  }
  scheduleJobViewCountFlush(db);
};
