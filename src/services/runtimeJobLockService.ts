import os from 'os';
import type { Db } from 'mongodb';

const RUNTIME_JOB_LOCKS_COLLECTION = 'runtime_job_locks';
const RUNTIME_JOB_LOCK_OWNER_ID = `${os.hostname()}:${process.pid}`;
let runtimeJobLockIndexesPromise: Promise<void> | null = null;

export const ensureRuntimeJobLockIndexes = async (db: Db): Promise<void> => {
  if (!runtimeJobLockIndexesPromise) {
    runtimeJobLockIndexesPromise = (async () => {
      await Promise.all([
        db.collection(RUNTIME_JOB_LOCKS_COLLECTION).createIndex(
          { jobKey: 1 },
          { unique: true, name: 'runtime_job_locks_job_key_idx' },
        ),
        db.collection(RUNTIME_JOB_LOCKS_COLLECTION).createIndex(
          { expiresAt: 1 },
          { expireAfterSeconds: 0, name: 'runtime_job_locks_expires_at_ttl_idx' },
        ),
      ]);
    })().catch((error) => {
      runtimeJobLockIndexesPromise = null;
      throw error;
    });
  }
  return runtimeJobLockIndexesPromise;
};

export const tryAcquireRuntimeJobLock = async (params: {
  db: Db;
  jobKey: string;
  ttlMs: number;
}): Promise<boolean> => {
  await ensureRuntimeJobLockIndexes(params.db);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1000, params.ttlMs));

  try {
    const result = await params.db.collection(RUNTIME_JOB_LOCKS_COLLECTION).updateOne(
      {
        jobKey: params.jobKey,
        $or: [
          { expiresAt: { $lte: now } },
          { ownerId: RUNTIME_JOB_LOCK_OWNER_ID },
        ],
      },
      {
        $set: {
          jobKey: params.jobKey,
          ownerId: RUNTIME_JOB_LOCK_OWNER_ID,
          acquiredAt: now.toISOString(),
          expiresAt,
        },
        $setOnInsert: {
          createdAt: now.toISOString(),
        },
      },
      { upsert: true },
    );

    return result.matchedCount > 0 || result.upsertedCount > 0;
  } catch (error: any) {
    if (error?.code === 11000) {
      return false;
    }
    throw error;
  }
};

export const releaseRuntimeJobLock = async (params: {
  db: Db;
  jobKey: string;
}): Promise<void> => {
  await params.db.collection(RUNTIME_JOB_LOCKS_COLLECTION).updateOne(
    {
      jobKey: params.jobKey,
      ownerId: RUNTIME_JOB_LOCK_OWNER_ID,
    },
    {
      $set: {
        expiresAt: new Date(0),
        releasedAt: new Date().toISOString(),
      },
    },
  );
};

export const withRuntimeJobLock = async <T>(params: {
  db: Db;
  jobKey: string;
  ttlMs: number;
  task: () => Promise<T>;
}): Promise<T | null> => {
  const acquired = await tryAcquireRuntimeJobLock({
    db: params.db,
    jobKey: params.jobKey,
    ttlMs: params.ttlMs,
  });
  if (!acquired) return null;

  try {
    return await params.task();
  } finally {
    await releaseRuntimeJobLock({
      db: params.db,
      jobKey: params.jobKey,
    }).catch(() => undefined);
  }
};
