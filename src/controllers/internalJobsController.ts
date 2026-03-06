import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import {
  ingestAggregatedJobsBatch,
  MAX_INTERNAL_AGGREGATED_INGEST_ITEMS,
} from '../services/internalJobIngestionService';

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
