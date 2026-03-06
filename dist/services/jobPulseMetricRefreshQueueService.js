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
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleJobPulseMetricRefreshTask = void 0;
const MAX_CONCURRENT_PULSE_METRIC_REFRESH_TASKS = 2;
const MAX_QUEUED_PULSE_METRIC_REFRESH_TASKS = 24;
const queuedPulseMetricRefreshTasks = [];
let activePulseMetricRefreshTaskCount = 0;
const drainPulseMetricRefreshQueue = () => {
    while (activePulseMetricRefreshTaskCount < MAX_CONCURRENT_PULSE_METRIC_REFRESH_TASKS
        && queuedPulseMetricRefreshTasks.length > 0) {
        const nextTask = queuedPulseMetricRefreshTasks.shift();
        if (!nextTask)
            break;
        activePulseMetricRefreshTaskCount += 1;
        void (() => __awaiter(void 0, void 0, void 0, function* () {
            try {
                yield nextTask.runTask(nextTask.jobIds, nextTask.stateByJobId);
                nextTask.resolve();
            }
            catch (error) {
                nextTask.reject(error);
                throw error;
            }
        }))()
            .catch(() => undefined)
            .finally(() => {
            activePulseMetricRefreshTaskCount = Math.max(0, activePulseMetricRefreshTaskCount - 1);
            drainPulseMetricRefreshQueue();
        });
    }
};
const mergeIntoQueuedPulseMetricRefreshTask = (params) => {
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
const scheduleJobPulseMetricRefreshTask = (params) => {
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
    let resolveTask = () => undefined;
    let rejectTask = () => undefined;
    const taskPromise = new Promise((resolve, reject) => {
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
exports.scheduleJobPulseMetricRefreshTask = scheduleJobPulseMetricRefreshTask;
