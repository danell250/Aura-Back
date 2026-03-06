import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import {
  readCachedCompanyNetworkCount,
  scheduleCompanyNetworkCountRefresh,
} from '../services/jobNetworkService';
import { readString } from '../utils/inputSanitizers';

const JOBS_COLLECTION = 'jobs';
export const jobNetworkController = {
  // GET /api/jobs/:jobId/network-count
  getJobNetworkCount: async (req: Request, res: Response) => {
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
      const job = await db.collection(JOBS_COLLECTION).findOne(
        { id: jobId, status: { $ne: 'archived' } },
        { projection: { companyId: 1 } },
      );
      if (!job) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }

      const companyId = readString(job.companyId, 120);
      if (!companyId) {
        return res.json({ success: true, data: { count: 0, companyId: '' } });
      }

      const cachedCount = readCachedCompanyNetworkCount({
        companyId,
        viewerUserId: currentUserId,
      });
      if (cachedCount != null) {
        return res.json({
          success: true,
          data: {
            count: cachedCount,
            companyId,
          },
        });
      }

      scheduleCompanyNetworkCountRefresh({
        db,
        companyId,
        viewerUserId: currentUserId,
      });

      return res.json({
        success: true,
        data: {
          count: 0,
          companyId,
          pending: true,
        },
      });
    } catch (error) {
      console.error('Get job network count error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch network count' });
    }
  },
};
