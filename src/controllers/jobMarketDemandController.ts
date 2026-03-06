import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { parsePositiveInt, readString } from '../utils/inputSanitizers';
import { listJobMarketDemand } from '../services/jobMarketDemandService';

const parseRoleFilters = (req: Request): string[] => {
  const singleRole = readString((req.query as any)?.role, 140);
  const multipleRoles = readString((req.query as any)?.roles, 1200);
  const values = [
    ...(singleRole ? [singleRole] : []),
    ...multipleRoles.split(','),
  ];

  const deduped = new Set<string>();
  const roles: string[] = [];
  values.forEach((value) => {
    const normalized = readString(value, 140);
    if (!normalized) return;
    const cacheKey = normalized.toLowerCase();
    if (deduped.has(cacheKey)) return;
    deduped.add(cacheKey);
    roles.push(normalized);
  });
  return roles.slice(0, 10);
};

export const jobMarketDemandController = {
  // GET /api/jobs/market-demand
  getJobMarketDemand: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const db = getDB();
      const location = readString((req.query as any)?.location, 120);
      const workModelRaw = readString((req.query as any)?.workModel, 20).toLowerCase();
      const workModel = workModelRaw === 'all' ? '' : workModelRaw;
      const roles = parseRoleFilters(req);
      const limit = parsePositiveInt((req.query as any)?.limit, 6, 1, 12);
      const isScopedDemandQuery = Boolean(location || workModel || roles.length > 0);

      const marketDemand = await listJobMarketDemand({
        db,
        query: {
          location,
          workModel,
          roles,
          limit,
        },
        personalized: isScopedDemandQuery,
      });

      return res.json({
        success: true,
        data: marketDemand.entries,
        meta: marketDemand.meta,
      });
    } catch (error) {
      console.error('Get job market demand error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch job market demand' });
    }
  },
};
