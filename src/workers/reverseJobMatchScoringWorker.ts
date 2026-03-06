import { parentPort } from 'worker_threads';
import type {
  ReverseMatchWorkerCandidate,
  ReverseMatchWorkerJobPayload,
} from '../services/reverseJobMatchWorkerService';
import { buildReverseMatchScoreEntry } from '../services/reverseJobMatchScoringUtils';

type ReverseMatchWorkerTaskMessage = {
  taskId: string;
  jobs: ReverseMatchWorkerJobPayload[];
  minScore: number;
};

const scoreJobs = (jobs: ReverseMatchWorkerJobPayload[], minScore: number) =>
  jobs.map((jobPayload) => {
    if (!jobPayload || typeof jobPayload !== 'object') {
      return { jobId: '', entries: [] };
    }

    const candidates = Array.isArray(jobPayload.candidates) ? jobPayload.candidates : [];
    const entries = candidates.reduce<Array<{
      userId: string;
      score: number;
      reasons: string[];
      matchedSkills: string[];
    }>>((results, candidate: ReverseMatchWorkerCandidate) => {
      const entry = buildReverseMatchScoreEntry({
        job: jobPayload.job,
        userId: candidate?.userId || '',
        profile: candidate?.profile,
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

parentPort?.on('message', (message: ReverseMatchWorkerTaskMessage) => {
  const taskId = typeof message?.taskId === 'string' ? message.taskId : '';
  const jobs = Array.isArray(message?.jobs) ? message.jobs : [];
  const minScore = Number.isFinite(Number(message?.minScore))
    ? Math.max(0, Math.round(Number(message.minScore)))
    : 0;

  try {
    parentPort?.postMessage({
      taskId,
      results: scoreJobs(jobs, minScore),
    });
  } catch (error) {
    parentPort?.postMessage({
      taskId,
      error: error instanceof Error ? error.message : 'Reverse match scoring worker failed',
    });
  }
});
