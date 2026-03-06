"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const reverseJobMatchScoringUtils_1 = require("../services/reverseJobMatchScoringUtils");
const scoreJobs = (jobs, minScore) => jobs.map((jobPayload) => {
    if (!jobPayload || typeof jobPayload !== 'object') {
        return { jobId: '', entries: [] };
    }
    const candidates = Array.isArray(jobPayload.candidates) ? jobPayload.candidates : [];
    const entries = candidates.reduce((results, candidate) => {
        const entry = (0, reverseJobMatchScoringUtils_1.buildReverseMatchScoreEntry)({
            job: jobPayload.job,
            userId: (candidate === null || candidate === void 0 ? void 0 : candidate.userId) || '',
            profile: candidate === null || candidate === void 0 ? void 0 : candidate.profile,
            minScore,
        });
        if (entry) {
            results.push(entry);
        }
        return results;
    }, []);
    return {
        jobId: jobPayload.jobId || '',
        entries,
    };
});
worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.on('message', (message) => {
    const taskId = typeof (message === null || message === void 0 ? void 0 : message.taskId) === 'string' ? message.taskId : '';
    const jobs = Array.isArray(message === null || message === void 0 ? void 0 : message.jobs) ? message.jobs : [];
    const minScore = Number.isFinite(Number(message === null || message === void 0 ? void 0 : message.minScore))
        ? Math.max(0, Math.round(Number(message.minScore)))
        : 0;
    try {
        worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.postMessage({
            taskId,
            results: scoreJobs(jobs, minScore),
        });
    }
    catch (error) {
        worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.postMessage({
            taskId,
            error: error instanceof Error ? error.message : 'Reverse match scoring worker failed',
        });
    }
});
