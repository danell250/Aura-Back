import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { parsePositiveInt, readString } from '../utils/inputSanitizers';
import { listJobPulseSnapshots } from '../services/jobPulseSnapshotService';

const parseRequestedJobIds = (req: Request): string[] => {
  const single = readString((req.query as any)?.jobId, 120);
  const multiple = readString((req.query as any)?.jobIds, 4000);
  const rawValues = [
    ...(single ? [single] : []),
    ...multiple.split(','),
  ];

  const seen = new Set<string>();
  const jobIds: string[] = [];
  rawValues.forEach((rawValue) => {
    const normalized = readString(rawValue, 120);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    jobIds.push(normalized);
  });
  return jobIds.slice(0, 20);
};

export const jobPulseController = {
  // GET /api/jobs/pulse
  getJobsPulse: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          meta: {
            generatedAt: new Date().toISOString(),
          },
        });
      }

      const jobIds = parseRequestedJobIds(req);
      const limit = parsePositiveInt((req.query as any)?.limit, 20, 1, 20);
      const db = getDB();
      const snapshots = await listJobPulseSnapshots({
        db,
        requestedJobIds: jobIds,
        limit,
      });

      return res.json({
        success: true,
        data: snapshots,
        meta: {
          generatedAt: new Date().toISOString(),
          recommendedPollingIntervalSeconds: 30,
          windows: {
            applicationsLast24hHours: 24,
            viewsLast60mMinutes: 60,
            matchesLast10mMinutes: 10,
            savesLast24hHours: 24,
          },
        },
      });
    } catch (error) {
      console.error('Get jobs pulse error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch jobs pulse' });
    }
  },
};
