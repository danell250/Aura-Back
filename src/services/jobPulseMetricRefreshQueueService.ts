const MAX_CONCURRENT_PULSE_METRIC_REFRESH_TASKS = 2;
const MAX_QUEUED_PULSE_METRIC_REFRESH_TASKS = 24;

type PulseMetricRefreshTask = {
  jobIds: string[];
  stateByJobId: Map<string, unknown>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  runTask: (jobIds: string[], stateByJobId: Map<string, unknown>) => Promise<void>;
};

const queuedPulseMetricRefreshTasks: PulseMetricRefreshTask[] = [];
let activePulseMetricRefreshTaskCount = 0;

const drainPulseMetricRefreshQueue = (): void => {
  while (
    activePulseMetricRefreshTaskCount < MAX_CONCURRENT_PULSE_METRIC_REFRESH_TASKS
    && queuedPulseMetricRefreshTasks.length > 0
  ) {
    const nextTask = queuedPulseMetricRefreshTasks.shift();
    if (!nextTask) break;
    activePulseMetricRefreshTaskCount += 1;
    void (async () => {
      try {
        await nextTask.runTask(nextTask.jobIds, nextTask.stateByJobId);
        nextTask.resolve();
      } catch (error) {
        nextTask.reject(error);
        throw error;
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        activePulseMetricRefreshTaskCount = Math.max(0, activePulseMetricRefreshTaskCount - 1);
        drainPulseMetricRefreshQueue();
      });
  }
};

const mergeIntoQueuedPulseMetricRefreshTask = (params: {
  task: PulseMetricRefreshTask;
  jobIds: string[];
  stateByJobId: Map<string, unknown>;
}): Promise<void> => {
  const seenJobIds = new Set(params.task.jobIds);
  params.jobIds.forEach((jobId) => {
    if (!seenJobIds.has(jobId)) {
      params.task.jobIds.push(jobId);
      seenJobIds.add(jobId);
    }
    if (params.stateByJobId.has(jobId)) {
      params.task.stateByJobId.set(jobId, params.stateByJobId.get(jobId));
    }
  });
  return params.task.promise;
};

export const scheduleJobPulseMetricRefreshTask = (params: {
  jobIds: string[];
  stateByJobId: Map<string, unknown>;
  runTask: (jobIds: string[], stateByJobId: Map<string, unknown>) => Promise<void>;
}): Promise<void> | null => {
  if ((activePulseMetricRefreshTaskCount + queuedPulseMetricRefreshTasks.length) >= MAX_QUEUED_PULSE_METRIC_REFRESH_TASKS) {
    const lastQueuedTask = queuedPulseMetricRefreshTasks[queuedPulseMetricRefreshTasks.length - 1];
    return lastQueuedTask
      ? mergeIntoQueuedPulseMetricRefreshTask({
        task: lastQueuedTask,
        jobIds: params.jobIds,
        stateByJobId: params.stateByJobId,
      })
      : null;
  }

  let resolveTask: () => void = () => undefined;
  let rejectTask: (error: unknown) => void = () => undefined;
  const taskPromise = new Promise<void>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });

  queuedPulseMetricRefreshTasks.push({
    jobIds: [...params.jobIds],
    stateByJobId: new Map(params.stateByJobId),
    promise: taskPromise,
    resolve: resolveTask,
    reject: rejectTask,
    runTask: params.runTask,
  });
  drainPulseMetricRefreshQueue();
  return taskPromise;
};
