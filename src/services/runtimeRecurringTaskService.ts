import type { Db } from 'mongodb';
import { getDB, isDBConnected } from '../db';
import { withRuntimeJobLock } from './runtimeJobLockService';

export const startRecurringTaskRunner = (params: {
  intervalMs: number;
  run: () => Promise<void>;
}): void => {
  const loop = async () => {
    try {
      await params.run();
    } finally {
      setTimeout(() => {
        void loop();
      }, params.intervalMs);
    }
  };

  void loop();
};

export const runLockedRecurringTask = async <T>(params: {
  jobKey: string;
  ttlMs: number;
  task: (db: Db) => Promise<T>;
}): Promise<T | null> => {
  if (!isDBConnected()) return null;
  const db = getDB();
  return withRuntimeJobLock({
    db,
    jobKey: params.jobKey,
    ttlMs: params.ttlMs,
    task: () => params.task(db),
  });
};
