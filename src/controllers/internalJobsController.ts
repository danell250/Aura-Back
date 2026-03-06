import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import {
  ingestAggregatedJobsBatch,
  MAX_INTERNAL_AGGREGATED_INGEST_ITEMS,
} from '../services/internalJobIngestionService';
import { processReverseJobMatchesForIngestedPayload } from '../services/reverseJobMatchService';

const REVERSE_MATCH_BACKGROUND_RETRY_LIMIT = Number.isFinite(Number(process.env.REVERSE_MATCH_BACKGROUND_RETRY_LIMIT))
  ? Math.max(0, Math.round(Number(process.env.REVERSE_MATCH_BACKGROUND_RETRY_LIMIT)))
  : 1;
const REVERSE_MATCH_BACKGROUND_RETRY_DELAY_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_BACKGROUND_RETRY_DELAY_MS))
  ? Math.max(500, Math.round(Number(process.env.REVERSE_MATCH_BACKGROUND_RETRY_DELAY_MS)))
  : 5000;

const scheduleReverseMatchProcessing = (params: {
  db: any;
  rawJobs: unknown[];
  nowIso: string;
  telemetry: {
    correlationId?: string;
    received: number;
    inserted: number;
    updated: number;
    skipped: number;
  };
  attempt?: number;
}): void => {
  const attempt = Number.isFinite(Number(params.attempt)) ? Math.max(0, Number(params.attempt)) : 0;
  setImmediate(() => {
    void processReverseJobMatchesForIngestedPayload({
      db: params.db,
      rawJobs: params.rawJobs,
      nowIso: params.nowIso,
    }).catch((error) => {
      if (attempt < REVERSE_MATCH_BACKGROUND_RETRY_LIMIT) {
        setTimeout(() => {
          scheduleReverseMatchProcessing({
            ...params,
            attempt: attempt + 1,
          });
        }, REVERSE_MATCH_BACKGROUND_RETRY_DELAY_MS);
      }
      console.error('Reverse match background processing error:', {
        attempt,
        retryLimit: REVERSE_MATCH_BACKGROUND_RETRY_LIMIT,
        telemetry: params.telemetry,
        error,
      });
    });
  });
};

export const internalJobsController = {
  // POST /api/internal/jobs/aggregated
  ingestAggregatedJobs: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const jobs = (req.body as any)?.jobs;
      if (!Array.isArray(jobs)) {
        return res.status(400).json({
          success: false,
          error: 'jobs array is required',
        });
      }

      if (jobs.length > MAX_INTERNAL_AGGREGATED_INGEST_ITEMS) {
        return res.status(413).json({
          success: false,
          error: `A maximum of ${MAX_INTERNAL_AGGREGATED_INGEST_ITEMS} jobs can be ingested per request`,
        });
      }

      if (jobs.length === 0) {
        return res.json({
          success: true,
          data: {
            received: 0,
            inserted: 0,
            updated: 0,
            skipped: 0,
            skippedReasons: {},
          },
        });
      }

      const db = getDB();
      const nowIso = new Date().toISOString();
      const stats = await ingestAggregatedJobsBatch(
        db,
        jobs as unknown[],
        nowIso,
      );

      scheduleReverseMatchProcessing({
        db,
        rawJobs: jobs as unknown[],
        nowIso,
        telemetry: {
          correlationId:
            typeof req.headers['x-request-id'] === 'string'
              ? req.headers['x-request-id']
              : undefined,
          received: jobs.length,
          inserted: stats.inserted,
          updated: stats.updated,
          skipped: stats.skipped,
        },
      });

      return res.json({
        success: true,
        data: {
          received: jobs.length,
          inserted: stats.inserted,
          updated: stats.updated,
          skipped: stats.skipped,
          skippedReasons: stats.skippedReasons,
          errors: stats.errorSamples,
        },
      });
    } catch (error) {
      console.error('Internal aggregated jobs ingest error:', error);
      return res.status(500).json({ success: false, error: 'Failed to ingest aggregated jobs' });
    }
  },
};
