"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordJobPulseEventAsync = exports.recordJobPulseEventsAsync = exports.recordJobPulseEvents = exports.recordJobPulseEvent = exports.ensureJobPulseIndexes = void 0;
const crypto_1 = __importDefault(require("crypto"));
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobPulseUtils_1 = require("./jobPulseUtils");
const JOB_PULSE_EVENTS_COLLECTION = 'job_pulse_events';
const JOB_PULSE_BUCKETS_COLLECTION = 'job_pulse_time_buckets';
const JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION = 'job_pulse_metric_snapshots';
const JOB_PULSE_EVENT_TTL_SECONDS = 2 * 24 * 60 * 60;
const JOB_PULSE_BUCKET_WINDOW_MS = 10 * 60 * 1000;
let pulseIndexesPromise = null;
let pulseIndexesEnsured = false;
const buildEventId = () => `jobpulse-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
const resolveBucketCounterField = (type) => {
    if (type === 'job_viewed')
        return 'jobViewedCount';
    if (type === 'job_applied')
        return 'jobAppliedCount';
    if (type === 'job_matched')
        return 'jobMatchedCount';
    if (type === 'job_saved')
        return 'jobSavedCount';
    return null;
};
const resolveTimeBucketStart = (createdAt) => {
    const createdAtMs = (0, jobPulseUtils_1.parseJobPulseIsoMs)(createdAt) || Date.now();
    const bucketStartMs = Math.floor(createdAtMs / JOB_PULSE_BUCKET_WINDOW_MS) * JOB_PULSE_BUCKET_WINDOW_MS;
    const bucketStartDate = new Date(bucketStartMs);
    return {
        bucketStart: bucketStartDate.toISOString(),
        bucketStartDate,
    };
};
const buildPulseEventDoc = (params) => {
    const createdAt = (0, inputSanitizers_1.readString)(params.createdAt, 80) || new Date().toISOString();
    return {
        id: (0, inputSanitizers_1.readString)(params.id, 180) || buildEventId(),
        jobId: (0, inputSanitizers_1.readString)(params.jobId, 120),
        type: params.type,
        userId: (0, inputSanitizers_1.readString)(params.userId, 120) || null,
        createdAt,
        createdAtDate: new Date(createdAt),
        metadata: params.metadata && Object.keys(params.metadata).length > 0 ? params.metadata : undefined,
    };
};
const ensureJobPulseIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (pulseIndexesEnsured)
        return;
    if (!pulseIndexesPromise) {
        pulseIndexesPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
            try {
                yield Promise.all([
                    db.collection(JOB_PULSE_EVENTS_COLLECTION).createIndex({ id: 1 }, { unique: true, name: 'job_pulse_event_id_idx' }),
                    db.collection(JOB_PULSE_EVENTS_COLLECTION).createIndex({ jobId: 1, type: 1, createdAtDate: -1 }, { name: 'job_pulse_event_job_type_created_idx' }),
                    db.collection(JOB_PULSE_EVENTS_COLLECTION).createIndex({ type: 1, createdAtDate: -1 }, { name: 'job_pulse_event_type_created_idx' }),
                    db.collection(JOB_PULSE_EVENTS_COLLECTION).createIndex({ createdAtDate: 1 }, {
                        name: 'job_pulse_event_created_ttl_idx',
                        expireAfterSeconds: JOB_PULSE_EVENT_TTL_SECONDS,
                    }),
                    db.collection(JOB_PULSE_BUCKETS_COLLECTION).createIndex({ jobId: 1, bucketStart: 1 }, { unique: true, name: 'job_pulse_bucket_job_bucket_idx' }),
                    db.collection(JOB_PULSE_BUCKETS_COLLECTION).createIndex({ jobId: 1, bucketStartDate: -1 }, { name: 'job_pulse_bucket_job_bucket_date_idx' }),
                    db.collection(JOB_PULSE_BUCKETS_COLLECTION).createIndex({ bucketStartDate: 1 }, {
                        name: 'job_pulse_bucket_ttl_idx',
                        expireAfterSeconds: JOB_PULSE_EVENT_TTL_SECONDS,
                    }),
                    db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).createIndex({ jobId: 1 }, { unique: true, name: 'job_pulse_metric_snapshot_job_idx' }),
                    db.collection(JOB_PULSE_METRIC_SNAPSHOTS_COLLECTION).createIndex({ refreshedAtDate: -1 }, { name: 'job_pulse_metric_snapshot_refreshed_idx' }),
                ]);
                pulseIndexesEnsured = true;
            }
            finally {
                if (!pulseIndexesEnsured) {
                    pulseIndexesPromise = null;
                }
            }
        }))();
    }
    return pulseIndexesPromise;
});
exports.ensureJobPulseIndexes = ensureJobPulseIndexes;
const recordJobPulseEvent = (db, params) => __awaiter(void 0, void 0, void 0, function* () {
    const eventDoc = buildPulseEventDoc(params);
    if (!eventDoc.jobId)
        return;
    const counterField = resolveBucketCounterField(params.type);
    const { bucketStart, bucketStartDate } = resolveTimeBucketStart(eventDoc.createdAt);
    const eventWriteResult = yield db.collection(JOB_PULSE_EVENTS_COLLECTION).updateOne({ id: eventDoc.id }, { $setOnInsert: eventDoc }, { upsert: true });
    if (!counterField || Number(eventWriteResult.upsertedCount || 0) === 0)
        return;
    yield db.collection(JOB_PULSE_BUCKETS_COLLECTION).updateOne({ jobId: eventDoc.jobId, bucketStart }, {
        $inc: { [counterField]: 1 },
        $set: {
            jobId: eventDoc.jobId,
            bucketStart,
            bucketStartDate,
        },
        $max: {
            latestEventAt: eventDoc.createdAt,
        },
    }, { upsert: true });
});
exports.recordJobPulseEvent = recordJobPulseEvent;
const recordJobPulseEvents = (db, events) => __awaiter(void 0, void 0, void 0, function* () {
    const docs = events
        .map((event) => buildPulseEventDoc(event))
        .filter((doc) => doc.jobId.length > 0);
    if (docs.length === 0)
        return;
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
    let eventWriteResult;
    try {
        eventWriteResult = yield db.collection(JOB_PULSE_EVENTS_COLLECTION).bulkWrite(eventOperations.map((entry) => entry.operation), { ordered: false });
    }
    catch (error) {
        if (!(error === null || error === void 0 ? void 0 : error.result)) {
            throw error;
        }
        eventWriteResult = error.result;
    }
    const insertedDocs = Object.keys((eventWriteResult === null || eventWriteResult === void 0 ? void 0 : eventWriteResult.upsertedIds) || {}).reduce((docs, rawIndex) => {
        const index = Number(rawIndex);
        if (!Number.isFinite(index) || index < 0 || index >= eventOperations.length) {
            return docs;
        }
        const eventOperation = eventOperations[index];
        if (!(eventOperation === null || eventOperation === void 0 ? void 0 : eventOperation.doc) || !eventOperation.doc.jobId) {
            return docs;
        }
        docs.push(eventOperation.doc);
        return docs;
    }, []);
    if (insertedDocs.length === 0)
        return;
    const bucketOperationsMap = new Map();
    insertedDocs.forEach((doc) => {
        const counterField = resolveBucketCounterField(doc.type);
        if (!counterField)
            return;
        const { bucketStart, bucketStartDate } = resolveTimeBucketStart(doc.createdAt);
        const operationKey = `${doc.jobId}:${bucketStart}:${counterField}`;
        const existing = bucketOperationsMap.get(operationKey);
        if (existing) {
            existing.count += 1;
            if ((0, jobPulseUtils_1.parseJobPulseIsoMs)(doc.createdAt) > (0, jobPulseUtils_1.parseJobPulseIsoMs)(existing.latestEventAt)) {
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
    if (bucketOperationsMap.size === 0)
        return;
    yield db.collection(JOB_PULSE_BUCKETS_COLLECTION).bulkWrite(Array.from(bucketOperationsMap.values()).map((entry) => ({
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
    })), { ordered: false });
});
exports.recordJobPulseEvents = recordJobPulseEvents;
const recordJobPulseEventsAsync = (db, events) => {
    void (0, exports.recordJobPulseEvents)(db, events).catch((error) => {
        console.error('Record job pulse events error:', {
            events: events.length,
            error,
        });
    });
};
exports.recordJobPulseEventsAsync = recordJobPulseEventsAsync;
const recordJobPulseEventAsync = (db, params) => {
    void (0, exports.recordJobPulseEvent)(db, params).catch((error) => {
        console.error('Record job pulse event error:', {
            type: params.type,
            jobId: params.jobId,
            error,
        });
    });
};
exports.recordJobPulseEventAsync = recordJobPulseEventAsync;
