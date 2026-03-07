import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { readString } from '../utils/inputSanitizers';
import {
  getSavedJobStateForUser,
  listSavedJobsForUser,
  saveJobForUser,
  unsaveJobForUser,
} from '../services/savedJobsService';

export const savedJobsController = {
  // POST /api/jobs/:jobId/save
  saveJob: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = readString((req.user as any)?.id, 120);
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const jobId = readString(req.params.jobId, 120);
      const db = getDB();
      const result = await saveJobForUser({
        db,
        currentUserId,
        jobId,
      });

      if (result.error || !result.state) {
        return res.status(result.statusCode || 500).json({
          success: false,
          error: result.error || 'Failed to save job',
        });
      }

      return res.status(result.created ? 201 : 200).json({
        success: true,
        data: result.state,
      });
    } catch (error) {
      console.error('Save job error:', error);
      return res.status(500).json({ success: false, error: 'Failed to save job' });
    }
  },

  // DELETE /api/jobs/:jobId/save
  unsaveJob: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = readString((req.user as any)?.id, 120);
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const jobId = readString(req.params.jobId, 120);
      if (!jobId) {
        return res.status(400).json({ success: false, error: 'jobId is required' });
      }

      const db = getDB();
      await unsaveJobForUser({
        db,
        currentUserId,
        jobId,
      });

      return res.json({
        success: true,
        data: {
          jobId,
          isSaved: false,
          savedAt: null,
          savedJobId: null,
        },
      });
    } catch (error) {
      console.error('Unsave job error:', error);
      return res.status(500).json({ success: false, error: 'Failed to unsave job' });
    }
  },

  // GET /api/me/saved-jobs
  listMySavedJobs: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 20, total: 0, pages: 0 },
        });
      }

      const currentUserId = readString((req.user as any)?.id, 120);
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const db = getDB();
      const payload = await listSavedJobsForUser({
        db,
        currentUserId,
        query: (req.query as Record<string, unknown>) || {},
      });

      return res.json({
        success: true,
        data: payload.data,
        pagination: payload.pagination,
      });
    } catch (error) {
      console.error('List saved jobs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch saved jobs' });
    }
  },

  // GET /api/me/saved-jobs/:jobId/status
  getMySavedJobStatus: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = readString((req.user as any)?.id, 120);
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const jobId = readString(req.params.jobId, 120);
      if (!jobId) {
        return res.status(400).json({ success: false, error: 'jobId is required' });
      }

      const db = getDB();
      const state = await getSavedJobStateForUser({
        db,
        currentUserId,
        jobId,
      });

      return res.json({
        success: true,
        data: state || {
          jobId,
          isSaved: false,
          savedAt: null,
          savedJobId: null,
        },
      });
    } catch (error) {
      console.error('Get saved job status error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch saved job status' });
    }
  },
};
