"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueResumeEnrichmentJob = void 0;
const MAX_RESUME_ENRICHMENT_CONCURRENCY = 2;
const pendingResumeEnrichmentQueue = [];
let activeResumeEnrichmentCount = 0;
let isPumpScheduled = false;
const schedulePump = () => {
    if (isPumpScheduled)
        return;
    isPumpScheduled = true;
    queueMicrotask(runQueuePump);
};
const runQueuePump = () => {
    isPumpScheduled = false;
    while (activeResumeEnrichmentCount < MAX_RESUME_ENRICHMENT_CONCURRENCY &&
        pendingResumeEnrichmentQueue.length > 0) {
        const nextJob = pendingResumeEnrichmentQueue.shift();
        if (!nextJob)
            break;
        activeResumeEnrichmentCount += 1;
        void nextJob()
            .catch((error) => {
            console.error('Resume parsing/profile enrichment error:', error);
        })
            .finally(() => {
            activeResumeEnrichmentCount = Math.max(0, activeResumeEnrichmentCount - 1);
            schedulePump();
        });
    }
};
const enqueueResumeEnrichmentJob = (job) => {
    pendingResumeEnrichmentQueue.push(job);
    schedulePump();
};
exports.enqueueResumeEnrichmentJob = enqueueResumeEnrichmentJob;
