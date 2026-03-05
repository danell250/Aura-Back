const MAX_RESUME_ENRICHMENT_CONCURRENCY = 2;

type ResumeEnrichmentJob = () => Promise<void>;

const pendingResumeEnrichmentQueue: ResumeEnrichmentJob[] = [];
let activeResumeEnrichmentCount = 0;
let isPumpScheduled = false;

const schedulePump = (): void => {
  if (isPumpScheduled) return;
  isPumpScheduled = true;
  queueMicrotask(runQueuePump);
};

const runQueuePump = (): void => {
  isPumpScheduled = false;

  while (
    activeResumeEnrichmentCount < MAX_RESUME_ENRICHMENT_CONCURRENCY &&
    pendingResumeEnrichmentQueue.length > 0
  ) {
    const nextJob = pendingResumeEnrichmentQueue.shift();
    if (!nextJob) break;

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

export const enqueueResumeEnrichmentJob = (job: ResumeEnrichmentJob): void => {
  pendingResumeEnrichmentQueue.push(job);
  schedulePump();
};
