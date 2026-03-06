"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueReverseJobMatchProcessing = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const reverseJobMatchService_1 = require("./reverseJobMatchService");
const REVERSE_MATCH_QUEUE_CONCURRENCY = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_CONCURRENCY))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_CONCURRENCY)))
    : 1;
const REVERSE_MATCH_QUEUE_RETRY_LIMIT = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_RETRY_LIMIT))
    ? Math.max(0, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_RETRY_LIMIT)))
    : 1;
const REVERSE_MATCH_QUEUE_RETRY_DELAY_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_RETRY_DELAY_MS))
    ? Math.max(500, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_RETRY_DELAY_MS)))
    : 6000;
const REVERSE_MATCH_QUEUE_MAX_PENDING = Number.isFinite(Number(process.env.REVERSE_MATCH_QUEUE_MAX_PENDING))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_QUEUE_MAX_PENDING)))
    : 25;
const reverseMatchQueue = [];
let reverseMatchActiveWorkers = 0;
let reverseMatchQueuePumpScheduled = false;
const createReverseMatchCorrelationId = () => `reverse-match-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const compressRawJobsForQueue = (rawJobs) => {
    const compact = [];
    for (const raw of rawJobs) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            continue;
        const payload = raw;
        const source = (0, inputSanitizers_1.readString)(payload.source, 80).toLowerCase();
        const originalId = (0, inputSanitizers_1.readString)(payload.originalId, 240);
        const originalUrl = (0, inputSanitizers_1.readString)(payload.originalUrl, 700);
        if (!source || (!originalId && !originalUrl))
            continue;
        compact.push({ source, originalId, originalUrl });
    }
    return compact;
};
const queueReverseMatchJob = (item) => {
    if (reverseMatchQueue.length >= REVERSE_MATCH_QUEUE_MAX_PENDING) {
        const dropped = reverseMatchQueue.shift();
        console.warn('Reverse match queue capacity reached; dropping oldest queued item', {
            droppedCorrelationId: dropped === null || dropped === void 0 ? void 0 : dropped.correlationId,
            queueSize: reverseMatchQueue.length,
            maxPending: REVERSE_MATCH_QUEUE_MAX_PENDING,
        });
    }
    reverseMatchQueue.push(item);
};
const scheduleReverseMatchQueuePump = () => {
    if (reverseMatchQueuePumpScheduled)
        return;
    if (reverseMatchQueue.length === 0)
        return;
    if (reverseMatchActiveWorkers >= REVERSE_MATCH_QUEUE_CONCURRENCY)
        return;
    reverseMatchQueuePumpScheduled = true;
    queueMicrotask(runReverseMatchQueuePump);
};
const scheduleReverseMatchRetry = (item) => {
    const retryItem = Object.assign(Object.assign({}, item), { attempt: item.attempt + 1, enqueuedAtMs: Date.now() });
    setTimeout(() => {
        queueReverseMatchJob(retryItem);
        scheduleReverseMatchQueuePump();
    }, REVERSE_MATCH_QUEUE_RETRY_DELAY_MS);
};
const runReverseMatchQueuePump = () => {
    reverseMatchQueuePumpScheduled = false;
    while (reverseMatchActiveWorkers < REVERSE_MATCH_QUEUE_CONCURRENCY
        && reverseMatchQueue.length > 0) {
        const nextItem = reverseMatchQueue.shift();
        if (!nextItem)
            break;
        reverseMatchActiveWorkers += 1;
        const startedAtMs = Date.now();
        let completionStatus = 'success';
        void (0, reverseJobMatchService_1.processReverseJobMatchesForIngestedPayload)({
            db: nextItem.db,
            rawJobs: nextItem.jobIdentities,
            nowIso: nextItem.nowIso,
        })
            .catch((error) => {
            if (nextItem.attempt < REVERSE_MATCH_QUEUE_RETRY_LIMIT) {
                completionStatus = 'retry_scheduled';
                scheduleReverseMatchRetry(nextItem);
                console.error('Reverse match queue item failed; queued for retry', {
                    correlationId: nextItem.correlationId,
                    attempt: nextItem.attempt + 1,
                    retryLimit: REVERSE_MATCH_QUEUE_RETRY_LIMIT,
                    telemetry: nextItem.telemetry,
                    error,
                });
                return;
            }
            completionStatus = 'failed';
            console.error('Reverse match queue item failed permanently', {
                correlationId: nextItem.correlationId,
                attempt: nextItem.attempt,
                retryLimit: REVERSE_MATCH_QUEUE_RETRY_LIMIT,
                telemetry: nextItem.telemetry,
                error,
            });
        })
            .finally(() => {
            reverseMatchActiveWorkers = Math.max(0, reverseMatchActiveWorkers - 1);
            const durationMs = Date.now() - startedAtMs;
            const queueWaitMs = Math.max(0, startedAtMs - nextItem.enqueuedAtMs);
            console.info('Reverse match queue item completed', {
                correlationId: nextItem.correlationId,
                attempt: nextItem.attempt,
                durationMs,
                queueWaitMs,
                completionStatus,
                telemetry: nextItem.telemetry,
            });
            scheduleReverseMatchQueuePump();
        });
    }
};
const enqueueReverseJobMatchProcessing = (params) => {
    var _a;
    if (!params.db || !Array.isArray(params.rawJobs) || params.rawJobs.length === 0)
        return;
    const compactJobs = compressRawJobsForQueue(params.rawJobs);
    if (compactJobs.length === 0)
        return;
    const correlationId = (0, inputSanitizers_1.readString)((_a = params.telemetry) === null || _a === void 0 ? void 0 : _a.correlationId, 120) || createReverseMatchCorrelationId();
    queueReverseMatchJob({
        db: params.db,
        jobIdentities: compactJobs,
        nowIso: params.nowIso,
        telemetry: params.telemetry,
        attempt: 0,
        enqueuedAtMs: Date.now(),
        correlationId,
    });
    scheduleReverseMatchQueuePump();
};
exports.enqueueReverseJobMatchProcessing = enqueueReverseJobMatchProcessing;
