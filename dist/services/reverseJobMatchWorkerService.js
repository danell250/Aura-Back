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
exports.scoreReverseMatchCandidatesInWorker = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const worker_threads_1 = require("worker_threads");
const REVERSE_MATCH_WORKER_TIMEOUT_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_WORKER_TIMEOUT_MS))
    ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_WORKER_TIMEOUT_MS)))
    : 20000;
let reverseMatchWorker = null;
let reverseMatchWorkerPath = null;
let reverseMatchWorkerTaskSequence = 0;
const pendingWorkerTasks = new Map();
const resolveReverseMatchWorkerPath = () => {
    if (reverseMatchWorkerPath)
        return reverseMatchWorkerPath;
    const compiledWorkerPath = path_1.default.join(__dirname, '../workers/reverseJobMatchScoringWorker.js');
    if (!(0, fs_1.existsSync)(compiledWorkerPath)) {
        return null;
    }
    reverseMatchWorkerPath = compiledWorkerPath;
    return reverseMatchWorkerPath;
};
const rejectPendingWorkerTasks = (error) => {
    for (const [taskId, task] of pendingWorkerTasks.entries()) {
        clearTimeout(task.timeout);
        pendingWorkerTasks.delete(taskId);
        task.reject(error);
    }
};
const handleWorkerMessage = (message) => {
    const taskId = typeof (message === null || message === void 0 ? void 0 : message.taskId) === 'string' ? message.taskId : '';
    if (!taskId)
        return;
    const task = pendingWorkerTasks.get(taskId);
    if (!task)
        return;
    clearTimeout(task.timeout);
    pendingWorkerTasks.delete(taskId);
    if (message === null || message === void 0 ? void 0 : message.error) {
        task.reject(new Error(message.error));
        return;
    }
    const results = new Map();
    (Array.isArray(message === null || message === void 0 ? void 0 : message.results) ? message.results : []).forEach((result) => {
        if (!(result === null || result === void 0 ? void 0 : result.jobId))
            return;
        results.set(result.jobId, Array.isArray(result.entries) ? result.entries : []);
    });
    task.resolve(results);
};
const resetWorkerInstance = (error) => {
    if (reverseMatchWorker) {
        reverseMatchWorker.removeAllListeners();
        reverseMatchWorker = null;
    }
    if (error) {
        rejectPendingWorkerTasks(error);
    }
};
const getReverseMatchWorker = () => {
    if (reverseMatchWorker)
        return reverseMatchWorker;
    const workerPath = resolveReverseMatchWorkerPath();
    if (!workerPath) {
        throw new Error('Compiled reverse match scoring worker is unavailable');
    }
    const worker = new worker_threads_1.Worker(workerPath);
    worker.on('message', handleWorkerMessage);
    worker.on('error', (error) => {
        resetWorkerInstance(error instanceof Error ? error : new Error(String(error)));
    });
    worker.on('exit', (code) => {
        if (code === 0) {
            reverseMatchWorker = null;
            return;
        }
        resetWorkerInstance(new Error(`Reverse match scoring worker exited with code ${code}`));
    });
    reverseMatchWorker = worker;
    return worker;
};
const scoreReverseMatchCandidatesInWorker = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobs.length === 0) {
        return new Map();
    }
    const worker = getReverseMatchWorker();
    const taskId = `reverse-match-${Date.now()}-${reverseMatchWorkerTaskSequence += 1}`;
    const workerMessage = {
        taskId,
        jobs: params.jobs,
        minScore: params.minScore,
    };
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingWorkerTasks.delete(taskId);
            reject(new Error('Reverse match scoring worker timed out'));
            if (reverseMatchWorker) {
                void reverseMatchWorker.terminate();
                resetWorkerInstance(new Error('Reverse match scoring worker terminated after timeout'));
            }
        }, REVERSE_MATCH_WORKER_TIMEOUT_MS);
        pendingWorkerTasks.set(taskId, {
            resolve,
            reject,
            timeout,
        });
        try {
            worker.postMessage(workerMessage);
        }
        catch (error) {
            clearTimeout(timeout);
            pendingWorkerTasks.delete(taskId);
            reject(error);
        }
    });
});
exports.scoreReverseMatchCandidatesInWorker = scoreReverseMatchCandidatesInWorker;
