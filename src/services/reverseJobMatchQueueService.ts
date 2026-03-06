import { processReverseJobMatchesForIngestedPayload } from './reverseJobMatchService';
import { readString } from '../utils/inputSanitizers';

const REVERSE_MATCH_QUEUE_COLLECTION = 'job_reverse_match_queue';
const REVERSE_MATCH_QUEUE_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_BATCH_SIZE))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_BATCH_SIZE)))
  : 12;
const REVERSE_MATCH_QUEUE_POLL_INTERVAL_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_POLL_INTERVAL_MS))
  ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_POLL_INTERVAL_MS)))
  : 3000;
const REVERSE_MATCH_QUEUE_RETRY_DELAY_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_RETRY_DELAY_MS))
  ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_RETRY_DELAY_MS)))
  : 30_000;
const REVERSE_MATCH_QUEUE_MAX_ATTEMPTS = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_MAX_ATTEMPTS))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_MAX_ATTEMPTS)))
  : 3;

type ReverseMatchQueueEntry = {
  id: string;
  jobId: string;
  attempts: number;
};

let reverseMatchQueueIndexesPromise: Promise<void> | null = null;
let reverseMatchQueueWorkerTimer: NodeJS.Timeout | null = null;
let reverseMatchQueuePumpScheduled = false;
let reverseMatchQueuePumpInFlight = false;
let reverseMatchQueueDbProvider: (() => any) | null = null;

const buildReverseMatchQueueId = (jobId: string): string => `reverse-match:${jobId}`;

export const ensureReverseMatchQueueIndexes = async (db: any): Promise<void> => {
  if (!reverseMatchQueueIndexesPromise) {
    reverseMatchQueueIndexesPromise = (async () => {
      await Promise.all([
        db.collection(REVERSE_MATCH_QUEUE_COLLECTION).createIndex(
          { id: 1 },
          { name: 'reverse_match_queue_id_unique', unique: true },
        ),
        db.collection(REVERSE_MATCH_QUEUE_COLLECTION).createIndex(
          { status: 1, availableAtDate: 1, updatedAt: 1 },
          { name: 'reverse_match_queue_status_available_idx' },
        ),
      ]);
    })().catch((error) => {
      reverseMatchQueueIndexesPromise = null;
      throw error;
    });
  }
  return reverseMatchQueueIndexesPromise;
};

const normalizeQueuedJobIds = (jobIds: string[]): string[] =>
  Array.from(
    new Set(
      (Array.isArray(jobIds) ? jobIds : [])
        .map((jobId) => readString(jobId, 120))
        .filter((jobId) => jobId.length > 0),
    ),
  );

const claimReverseMatchQueueEntries = async (db: any, nowIso: string): Promise<ReverseMatchQueueEntry[]> => {
  const nowDate = new Date(nowIso);
  const queuedEntries = await db.collection(REVERSE_MATCH_QUEUE_COLLECTION).find(
    {
      status: 'queued',
      availableAtDate: { $lte: nowDate },
    },
    {
      projection: { id: 1, jobId: 1 },
      sort: { availableAtDate: 1, updatedAt: 1 },
      limit: REVERSE_MATCH_QUEUE_BATCH_SIZE,
    },
  ).toArray();
  if (queuedEntries.length === 0) {
    return [];
  }

  const queuedIds = queuedEntries
    .map((entry: any) => readString(entry?.id, 160))
    .filter((id: string) => id.length > 0);
  if (queuedIds.length === 0) {
    return [];
  }

  await db.collection(REVERSE_MATCH_QUEUE_COLLECTION).updateMany(
    {
      id: { $in: queuedIds },
      status: 'queued',
      availableAtDate: { $lte: nowDate },
    },
    {
      $set: {
        status: 'processing',
        processingStartedAt: nowIso,
        updatedAt: nowIso,
      },
      $inc: { attempts: 1 },
    },
  );

  const claimed = await db.collection(REVERSE_MATCH_QUEUE_COLLECTION).find(
    {
      id: { $in: queuedIds },
      status: 'processing',
      processingStartedAt: nowIso,
    },
    {
      projection: { id: 1, jobId: 1, attempts: 1 },
    },
  ).toArray();

  return claimed
    .map((entry: any) => ({
      id: readString(entry?.id, 160),
      jobId: readString(entry?.jobId, 120),
      attempts: Number.isFinite(Number(entry?.attempts)) ? Number(entry.attempts) : 0,
    }))
    .filter((entry: ReverseMatchQueueEntry) => entry.id.length > 0 && entry.jobId.length > 0);
};

const completeReverseMatchQueueEntries = async (params: {
  db: any;
  entries: ReverseMatchQueueEntry[];
  completedAtIso: string;
}): Promise<void> => {
  const ids = params.entries
    .map((entry) => readString(entry.id, 160))
    .filter((id) => id.length > 0);
  if (ids.length === 0) return;
  await params.db.collection(REVERSE_MATCH_QUEUE_COLLECTION).updateMany(
    {
      id: { $in: ids },
      status: 'processing',
    },
    {
      $set: {
        status: 'completed',
        completedAt: params.completedAtIso,
        updatedAt: params.completedAtIso,
      },
      $unset: {
        processingStartedAt: '',
      },
    },
  );
};

const deleteReverseMatchQueueEntries = async (
  db: any,
  entries: ReverseMatchQueueEntry[],
): Promise<void> => {
  const ids = entries
    .map((entry) => readString(entry.id, 160))
    .filter((id) => id.length > 0);
  if (ids.length === 0) return;
  await db.collection(REVERSE_MATCH_QUEUE_COLLECTION).deleteMany({
    id: { $in: ids },
    status: 'completed',
  });
};

const requeueReverseMatchQueueEntries = async (params: {
  db: any;
  entries: ReverseMatchQueueEntry[];
  nowIso: string;
  error: unknown;
}): Promise<void> => {
  if (params.entries.length === 0) return;

  const errorMessage = readString((params.error as any)?.message, 300) || 'Reverse match queue processing failed';
  const retryAtIso = new Date(Date.now() + REVERSE_MATCH_QUEUE_RETRY_DELAY_MS).toISOString();
  const retryAtDate = new Date(retryAtIso);

  await params.db.collection(REVERSE_MATCH_QUEUE_COLLECTION).bulkWrite(
    params.entries.map((entry) => {
      const attempts = Number.isFinite(Number(entry.attempts)) ? Number(entry.attempts) : 0;
      const shouldFail = attempts >= REVERSE_MATCH_QUEUE_MAX_ATTEMPTS;
      return {
        updateOne: {
          filter: { id: entry.id, status: 'processing' },
          update: shouldFail
            ? {
                $set: {
                  status: 'failed',
                  failedAt: params.nowIso,
                  updatedAt: params.nowIso,
                  lastError: errorMessage,
                },
                $unset: {
                  processingStartedAt: '',
                  availableAt: '',
                  availableAtDate: '',
                },
              }
            : {
                $set: {
                  status: 'queued',
                  availableAt: retryAtIso,
                  availableAtDate: retryAtDate,
                  updatedAt: params.nowIso,
                  lastError: errorMessage,
                },
                $unset: {
                  processingStartedAt: '',
                },
              },
        },
      };
    }),
    { ordered: false },
  );
};

const processReverseMatchQueueBatch = async (dbProvider: () => any): Promise<void> => {
  if (reverseMatchQueuePumpInFlight) return;
  reverseMatchQueuePumpInFlight = true;

  try {
    const db = dbProvider();
    await ensureReverseMatchQueueIndexes(db);
    const nowIso = new Date().toISOString();
    const entries = await claimReverseMatchQueueEntries(db, nowIso);
    if (entries.length === 0) return;

    try {
      await processReverseJobMatchesForIngestedPayload({
        db,
        jobIds: entries.map((entry) => entry.jobId),
        nowIso,
      });
      await completeReverseMatchQueueEntries({
        db,
        entries,
        completedAtIso: nowIso,
      });
      await deleteReverseMatchQueueEntries(db, entries);
    } catch (error) {
      await requeueReverseMatchQueueEntries({
        db,
        entries,
        nowIso,
        error,
      });
      console.error('Reverse match queue batch error:', error);
    }
  } catch (error) {
    console.error('Reverse match queue pump error:', error);
  } finally {
    reverseMatchQueuePumpInFlight = false;
  }
};

export const enqueueReverseJobMatchJobs = async (params: {
  db: any;
  jobIds: string[];
  queuedAtIso?: string;
}): Promise<number> => {
  const jobIds = normalizeQueuedJobIds(params.jobIds);
  if (jobIds.length === 0) return 0;

  await ensureReverseMatchQueueIndexes(params.db);
  const queuedAtIso = readString(params.queuedAtIso, 80) || new Date().toISOString();
  const queuedAtDate = new Date(queuedAtIso);

  await params.db.collection(REVERSE_MATCH_QUEUE_COLLECTION).bulkWrite(
    jobIds.map((jobId) => ({
      updateOne: {
        filter: { id: buildReverseMatchQueueId(jobId) },
        update: {
          $set: {
            jobId,
            status: 'queued',
            availableAt: queuedAtIso,
            availableAtDate: queuedAtDate,
            updatedAt: queuedAtIso,
          },
          $unset: {
            failedAt: '',
            processingStartedAt: '',
            lastError: '',
          },
          $setOnInsert: {
            id: buildReverseMatchQueueId(jobId),
            createdAt: queuedAtIso,
            attempts: 0,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  nudgeReverseMatchQueueWorker();
  return jobIds.length;
};

export const nudgeReverseMatchQueueWorker = (): void => {
  if (!reverseMatchQueueDbProvider || reverseMatchQueuePumpScheduled) return;
  reverseMatchQueuePumpScheduled = true;
  setImmediate(() => {
    reverseMatchQueuePumpScheduled = false;
    void processReverseMatchQueueBatch(reverseMatchQueueDbProvider as () => any);
  });
};

export const startReverseMatchQueueWorker = (dbProvider: () => any): void => {
  reverseMatchQueueDbProvider = dbProvider;
  if (reverseMatchQueueWorkerTimer) return;

  reverseMatchQueueWorkerTimer = setInterval(() => {
    void processReverseMatchQueueBatch(dbProvider);
  }, REVERSE_MATCH_QUEUE_POLL_INTERVAL_MS);
  reverseMatchQueueWorkerTimer.unref?.();
  nudgeReverseMatchQueueWorker();
};
