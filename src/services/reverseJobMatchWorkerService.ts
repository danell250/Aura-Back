import { existsSync } from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';

export type ReverseMatchWorkerCandidate = {
  userId: string;
  profile: any;
};

export type ReverseMatchWorkerJobPayload = {
  jobId: string;
  job: any;
  candidates: ReverseMatchWorkerCandidate[];
};

export type ReverseMatchWorkerJobResultEntry = {
  userId: string;
  score: number;
  reasons: string[];
  matchedSkills: string[];
};

type ReverseMatchWorkerTaskMessage = {
  taskId: string;
  jobs: ReverseMatchWorkerJobPayload[];
  minScore: number;
};

type ReverseMatchWorkerTaskResponse = {
  taskId: string;
  results?: Array<{
    jobId: string;
    entries: ReverseMatchWorkerJobResultEntry[];
  }>;
  error?: string;
};

type PendingWorkerTask = {
  resolve: (value: Map<string, ReverseMatchWorkerJobResultEntry[]>) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

const REVERSE_MATCH_WORKER_TIMEOUT_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_WORKER_TIMEOUT_MS))
  ? Math.max(1000, Math.round(Number(process.env.REVERSE_MATCH_WORKER_TIMEOUT_MS)))
  : 20_000;

let reverseMatchWorker: Worker | null = null;
let reverseMatchWorkerPath: string | null = null;
let reverseMatchWorkerTaskSequence = 0;
const pendingWorkerTasks = new Map<string, PendingWorkerTask>();

const resolveReverseMatchWorkerPath = (): string | null => {
  if (reverseMatchWorkerPath) return reverseMatchWorkerPath;
  const compiledWorkerPath = path.join(__dirname, '../workers/reverseJobMatchScoringWorker.js');
  if (!existsSync(compiledWorkerPath)) {
    return null;
  }
  reverseMatchWorkerPath = compiledWorkerPath;
  return reverseMatchWorkerPath;
};

const rejectPendingWorkerTasks = (error: Error): void => {
  for (const [taskId, task] of pendingWorkerTasks.entries()) {
    clearTimeout(task.timeout);
    pendingWorkerTasks.delete(taskId);
    task.reject(error);
  }
};

const handleWorkerMessage = (message: ReverseMatchWorkerTaskResponse): void => {
  const taskId = typeof message?.taskId === 'string' ? message.taskId : '';
  if (!taskId) return;
  const task = pendingWorkerTasks.get(taskId);
  if (!task) return;

  clearTimeout(task.timeout);
  pendingWorkerTasks.delete(taskId);

  if (message?.error) {
    task.reject(new Error(message.error));
    return;
  }

  const results = new Map<string, ReverseMatchWorkerJobResultEntry[]>();
  (Array.isArray(message?.results) ? message.results : []).forEach((result) => {
    if (!result?.jobId) return;
    results.set(result.jobId, Array.isArray(result.entries) ? result.entries : []);
  });
  task.resolve(results);
};

const resetWorkerInstance = (error?: Error): void => {
  if (reverseMatchWorker) {
    reverseMatchWorker.removeAllListeners();
    reverseMatchWorker = null;
  }
  if (error) {
    rejectPendingWorkerTasks(error);
  }
};

const getReverseMatchWorker = (): Worker => {
  if (reverseMatchWorker) return reverseMatchWorker;

  const workerPath = resolveReverseMatchWorkerPath();
  if (!workerPath) {
    throw new Error('Compiled reverse match scoring worker is unavailable');
  }

  const worker = new Worker(workerPath);
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

export const scoreReverseMatchCandidatesInWorker = async (params: {
  jobs: ReverseMatchWorkerJobPayload[];
  minScore: number;
}): Promise<Map<string, ReverseMatchWorkerJobResultEntry[]>> => {
  if (params.jobs.length === 0) {
    return new Map<string, ReverseMatchWorkerJobResultEntry[]>();
  }

  const worker = getReverseMatchWorker();
  const taskId = `reverse-match-${Date.now()}-${reverseMatchWorkerTaskSequence += 1}`;
  const workerMessage: ReverseMatchWorkerTaskMessage = {
    taskId,
    jobs: params.jobs,
    minScore: params.minScore,
  };

  return new Promise<Map<string, ReverseMatchWorkerJobResultEntry[]>>((resolve, reject) => {
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
    } catch (error) {
      clearTimeout(timeout);
      pendingWorkerTasks.delete(taskId);
      reject(error);
    }
  });
};
