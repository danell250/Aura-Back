import crypto from 'crypto';
import { readString } from '../utils/inputSanitizers';
import { parseJobPulseIsoMs } from './jobPulseUtils';

const JOB_PULSE_EVENTS_COLLECTION = 'job_pulse_events';
const JOB_PULSE_BUCKETS_COLLECTION = 'job_pulse_time_buckets';
const JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION = 'job_pulse_metric_snapshots';

const JOB_PULSE_EVENT_TTL_SECONDS = 2 * 24 * 60 * 60;
const JOB_PULSE_BUCKET_WINDOW_MS = 10 * 60 * 1000;

export type JobPulseEventType =
  | 'job_viewed'
  | 'job_applied'
  | 'job_matched'
  | 'job_saved'
  | 'job_discovered';

type RecordJobPulseEventParams = {
  id?: string;
  jobId: string;
  type: JobPulseEventType;
  userId?: string | null;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

type BucketCounterField =
  | 'jobViewedCount'
  | 'jobAppliedCount'
  | 'jobMatchedCount'
  | 'jobSavedCount';

let pulseIndexesPromise: Promise<void> | null = null;
let pulseIndexesEnsured = false;

const buildEventId = (): string =>
  `jobpulse-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

const resolveBucketCounterField = (type: JobPulseEventType): BucketCounterField | null => {
  if (type === 'job_viewed') return 'jobViewedCount';
  if (type === 'job_applied') return 'jobAppliedCount';
  if (type === 'job_matched') return 'jobMatchedCount';
  if (type === 'job_saved') return 'jobSavedCount';
  return null;
};

const resolveTimeBucketStart = (createdAt: string): { bucketStart: string; bucketStartDate: Date } => {
  const createdAtMs = parseJobPulseIsoMs(createdAt) || Date.now();
  const bucketStartMs = Math.floor(createdAtMs / JOB_PULSE_BUCKET_WINDOW_MS) * JOB_PULSE_BUCKET_WINDOW_MS;
  const bucketStartDate = new Date(bucketStartMs);
  return {
    bucketStart: bucketStartDate.toISOString(),
    bucketStartDate,
  };
};

const buildPulseEventDoc = (params: RecordJobPulseEventParams) => {
  const createdAt = readString(params.createdAt, 80) || new Date().toISOString();
  return {
    id: readString(params.id, 180) || buildEventId(),
    jobId: readString(params.jobId, 120),
    type: params.type,
    userId: readString(params.userId, 120) || null,
    createdAt,
    createdAtDate: new Date(createdAt),
    metadata: params.metadata && Object.keys(params.metadata).length > 0 ? params.metadata : undefined,
  };
};

export const ensureJobPulseIndexes = async (db: any): Promise<void> => {
  if (pulseIndexesEnsured) return;
  if (!pulseIndexesPromise) {
    pulseIndexesPromise = (async () => {
      try {
        await Promise.all([
          db.collection(JOB_PULSE_EVENTS_COLLECTION).createIndex({ id: 1 }, { unique: true, name: 'job_pulse_event_id_idx' }),
          db.collection(JOB_PULSE_EVENTS_COLLECTION).createIndex(
            { jobId: 1, type: 1, createdAtDate: -1 },
            { name: 'job_pulse_event_job_type_created_idx' },
          ),
          db.collection(JOB_PULSE_EVENTS_COLLECTION).createIndex(
            { type: 1, createdAtDate: -1 },
            { name: 'job_pulse_event_type_created_idx' },
          ),
          db.collection(JOB_PULSE_EVENTS_COLLECTION).createIndex(
            { createdAtDate: 1 },
            {
              name: 'job_pulse_event_created_ttl_idx',
              expireAfterSeconds: JOB_PULSE_EVENT_TTL_SECONDS,
            },
          ),
          db.collection(JOB_PULSE_BUCKETS_COLLECTION).createIndex(
            { jobId: 1, bucketStart: 1 },
            { unique: true, name: 'job_pulse_bucket_job_bucket_idx' },
          ),
          db.collection(JOB_PULSE_BUCKETS_COLLECTION).createIndex(
            { jobId: 1, bucketStartDate: -1 },
            { name: 'job_pulse_bucket_job_bucket_date_idx' },
          ),
          db.collection(JOB_PULSE_BUCKETS_COLLECTION).createIndex(
            { bucketStartDate: 1 },
            {
              name: 'job_pulse_bucket_ttl_idx',
              expireAfterSeconds: JOB_PULSE_EVENT_TTL_SECONDS,
            },
          ),
          db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).createIndex(
            { jobId: 1 },
            { unique: true, name: 'job_pulse_metric_snapshot_job_idx' },
          ),
          db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).createIndex(
            { refreshedAtDate: -1 },
            { name: 'job_pulse_metric_snapshot_refreshed_idx' },
          ),
        ]);
        pulseIndexesEnsured = true;
      } finally {
        if (!pulseIndexesEnsured) {
          pulseIndexesPromise = null;
        }
      }
    })();
  }

  return pulseIndexesPromise;
};

export const recordJobPulseEvent = async (db: any, params: RecordJobPulseEventParams): Promise<void> => {
  const eventDoc = buildPulseEventDoc(params);
  if (!eventDoc.jobId) return;
  const counterField = resolveBucketCounterField(params.type);
  const { bucketStart, bucketStartDate } = resolveTimeBucketStart(eventDoc.createdAt);
  const eventWriteResult = await db.collection(JOB_PULSE_EVENTS_COLLECTION).updateOne(
    { id: eventDoc.id },
    { $setOnInsert: eventDoc },
    { upsert: true },
  );
  if (!counterField || Number(eventWriteResult.upsertedCount || 0) === 0) return;
  await db.collection(JOB_PULSE_BUCKETS_COLLECTION).updateOne(
    { jobId: eventDoc.jobId, bucketStart },
    {
      $inc: { [counterField]: 1 },
      $set: {
        jobId: eventDoc.jobId,
        bucketStart,
        bucketStartDate,
      },
      $max: {
        latestEventAt: eventDoc.createdAt,
      },
    },
    { upsert: true },
  );
};

export const recordJobPulseEvents = async (
  db: any,
  events: RecordJobPulseEventParams[],
): Promise<void> => {
  const docs = events
    .map((event) => buildPulseEventDoc(event))
    .filter((doc) => doc.jobId.length > 0);
  if (docs.length === 0) return;

  const eventOperations = docs.map((doc) => ({
    doc,
    operation: {
      updateOne: {
        filter: { id: doc.id },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    },
  }));
  let eventWriteResult: any;
  try {
    eventWriteResult = await db.collection(JOB_PULSE_EVENTS_COLLECTION).bulkWrite(
      eventOperations.map((entry) => entry.operation),
      { ordered: false },
    );
  } catch (error: any) {
    if (!error?.result) {
      throw error;
    }
    eventWriteResult = error.result;
  }

  const insertedDocs = Object.keys((eventWriteResult as any)?.upsertedIds || {}).reduce<ReturnType<typeof buildPulseEventDoc>[]>(
    (docs, rawIndex) => {
      const index = Number(rawIndex);
      if (!Number.isFinite(index) || index < 0 || index >= eventOperations.length) {
        return docs;
      }
      const eventOperation = eventOperations[index];
      if (!eventOperation?.doc || !eventOperation.doc.jobId) {
        return docs;
      }
      docs.push(eventOperation.doc);
      return docs;
    },
    [],
  );
  if (insertedDocs.length === 0) return;
  const bucketOperationsMap = new Map<string, {
    filter: { jobId: string; bucketStart: string };
    counterField: BucketCounterField;
    count: number;
    bucketStartDate: Date;
    latestEventAt: string;
  }>();

  insertedDocs.forEach((doc) => {
    const counterField = resolveBucketCounterField(doc.type);
    if (!counterField) return;
    const { bucketStart, bucketStartDate } = resolveTimeBucketStart(doc.createdAt);
    const operationKey = `${doc.jobId}:${bucketStart}:${counterField}`;
    const existing = bucketOperationsMap.get(operationKey);
    if (existing) {
      existing.count += 1;
      if (parseJobPulseIsoMs(doc.createdAt) > parseJobPulseIsoMs(existing.latestEventAt)) {
        existing.latestEventAt = doc.createdAt;
      }
      return;
    }
    bucketOperationsMap.set(operationKey, {
      filter: { jobId: doc.jobId, bucketStart },
      counterField,
      count: 1,
      bucketStartDate,
      latestEventAt: doc.createdAt,
    });
  });

  if (bucketOperationsMap.size === 0) return;
  await db.collection(JOB_PULSE_BUCKETS_COLLECTION).bulkWrite(
    Array.from(bucketOperationsMap.values()).map((entry) => ({
      updateOne: {
        filter: entry.filter,
        update: {
          $inc: { [entry.counterField]: entry.count },
          $set: {
            jobId: entry.filter.jobId,
            bucketStart: entry.filter.bucketStart,
            bucketStartDate: entry.bucketStartDate,
          },
          $max: {
            latestEventAt: entry.latestEventAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
};

export const recordJobPulseEventsAsync = (db: any, events: RecordJobPulseEventParams[]): void => {
  void recordJobPulseEvents(db, events).catch((error) => {
    console.error('Record job pulse events error:', {
      events: events.length,
      error,
    });
  });
};

export const recordJobPulseEventAsync = (db: any, params: RecordJobPulseEventParams): void => {
  void recordJobPulseEvent(db, params).catch((error) => {
    console.error('Record job pulse event error:', {
      type: params.type,
      jobId: params.jobId,
      error,
    });
  });
};
