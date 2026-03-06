import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { parsePositiveInt, readString } from '../utils/inputSanitizers';
import { buildPublicJobsQuerySpec } from '../services/jobDiscoveryQueryService';
import { toJobResponse } from '../services/jobResponseService';
import { buildJobsSyndicationFeed } from '../services/jobSyndicationService';

const JOBS_COLLECTION = 'jobs';
const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const OPEN_JOBS_FEED_DEFAULT_LIMIT = 50;
const OPEN_JOBS_FEED_MAX_LIMIT = 100;

const AURA_PUBLIC_WEB_BASE_URL = (
  readString(process.env.AURA_PUBLIC_WEB_URL, 320)
  || readString(process.env.FRONTEND_URL, 320)
  || readString(process.env.VITE_FRONTEND_URL, 320)
  || 'https://aura.social'
).replace(/\/+$/, '');

const resolveFeedSlug = (job: any): string =>
  readString(job?.slug, 220)
  || readString(job?.id, 220)
  || 'job';

const buildAuraJobApplyUrl = (job: any): string => {
  const slug = resolveFeedSlug(job);
  return `${AURA_PUBLIC_WEB_BASE_URL}/jobs/${encodeURIComponent(slug)}`;
};

const normalizeExternalUrl = (value: unknown): string | null => {
  const raw = readString(String(value || ''), 600);
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const resolveUrlHostname = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const hostname = readString(parsed.hostname, 220).toLowerCase().replace(/^www\./, '');
    return hostname || null;
  } catch {
    return null;
  }
};

const parseSourceSite = (value: unknown): string => {
  const source = readString(value, 120).toLowerCase();
  if (!source) return '';
  const [, suffix = source] = source.split(':', 2);
  return readString(suffix, 120).toLowerCase();
};

const toOpenFeedJobItem = (job: any) => {
  const sourceUrl =
    normalizeExternalUrl(job?.originalUrl) ||
    normalizeExternalUrl(job?.applicationUrl);
  const sourceSite = parseSourceSite(job?.source) || readString(job?.source, 120).toLowerCase() || 'aura';
  const auraUrl = buildAuraJobApplyUrl(job);
  const postedAt = readString(String(job?.publishedAt || job?.createdAt || ''), 80) || null;
  return {
    id: String(job?.id || ''),
    title: String(job?.title || ''),
    company: String(job?.companyName || ''),
    location: String(job?.locationText || ''),
    summary: String(job?.summary || ''),
    work_model: String(job?.workModel || ''),
    employment_type: String(job?.employmentType || ''),
    salary_min: typeof job?.salaryMin === 'number' ? job.salaryMin : null,
    salary_max: typeof job?.salaryMax === 'number' ? job.salaryMax : null,
    salary_currency: String(job?.salaryCurrency || ''),
    posted_at: postedAt,
    apply_url: auraUrl,
    aura_url: auraUrl,
    source: sourceSite,
    source_domain: resolveUrlHostname(sourceUrl),
    original_url: sourceUrl,
  };
};

export const jobSyndicationController = {
  // GET /api/jobs/open-feed
  getOpenJobsFeed: async (req: Request, res: Response) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=300');

      const query = req.query as Record<string, unknown>;
      const page = parsePositiveInt((query as any).page, 1, 1, 100000);
      const limit = parsePositiveInt(
        (query as any).limit,
        OPEN_JOBS_FEED_DEFAULT_LIMIT,
        1,
        OPEN_JOBS_FEED_MAX_LIMIT,
      );
      const skip = (page - 1) * limit;
      const workModelRaw =
        readString((query as any).workModel, 80).toLowerCase()
        || readString((query as any).work_model, 80).toLowerCase()
        || readString((query as any)['work-model'], 80).toLowerCase();
      const employmentTypeRaw =
        readString((query as any).employmentType, 80).toLowerCase()
        || readString((query as any).employment_type, 80).toLowerCase()
        || readString((query as any)['employment-type'], 80).toLowerCase();
      const locationRaw =
        readString((query as any).location, 100)
        || readString((query as any).country, 100);
      const companyRaw = readString((query as any).company, 100);
      const searchRaw =
        readString((query as any).q, 120)
        || readString((query as any).search, 120)
        || readString((query as any).query, 120);
      const postedWithinHours = Number(
        (query as any).postedWithinHours
        ?? (query as any).posted_within_hours
        ?? (query as any).hours_old,
      );

      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          meta: {
            generatedAt: new Date().toISOString(),
            attribution: 'Powered by Aura',
            sourceUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs`,
            widgetScriptUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs-widget.js`,
          },
          pagination: { page, limit, total: 0, pages: 0 },
        });
      }

      const db = getDB();

      const querySpec = buildPublicJobsQuerySpec({
        allowTextSearch: true,
        workModelRaw,
        employmentTypeRaw,
        locationRaw,
        companyRaw,
        searchRaw,
        status: 'open',
        minSalary: Number.NaN,
        maxSalary: Number.NaN,
        postedWithinHours,
        sortBy: 'latest',
      });
      const filter = querySpec.filter;

      const [rows, total] = await Promise.all([
        db.collection(JOBS_COLLECTION)
          .find(
            filter,
            querySpec.usesTextSearch
              ? {
                  projection: { score: { $meta: 'textScore' } },
                }
              : undefined,
          )
          .sort(querySpec.sort as any)
          .skip(skip)
          .limit(limit)
          .toArray(),
        db.collection(JOBS_COLLECTION).countDocuments(filter),
      ]);

      const items = rows.map(toOpenFeedJobItem);
      return res.json({
        success: true,
        data: items,
        meta: {
          generatedAt: new Date().toISOString(),
          attribution: 'Powered by Aura',
          sourceUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs`,
          widgetScriptUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs-widget.js`,
          count: items.length,
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      const message = String((error as any)?.message || '').toLowerCase();
      if (message.includes('text index')) {
        return res.status(503).json({
          success: false,
          error: 'Search index is warming up. Please retry in a moment.',
        });
      }
      console.error('Get open jobs feed error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch open jobs feed' });
    }
  },

  // GET /api/partner/jobs
  getJobsForSyndication: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const db = getDB();
      const limit = parsePositiveInt((req.query as any)?.limit, 100, 1, 250);
      const statusRaw = readString((req.query as any)?.status, 40).toLowerCase();
      const status = statusRaw || 'open';

      const filter: Record<string, unknown> = {};
      if (status === 'all') {
        filter.status = { $ne: 'archived' };
      } else if (ALLOWED_JOB_STATUSES.has(status)) {
        filter.status = status;
      } else {
        return res.status(400).json({ success: false, error: 'Invalid status filter' });
      }

      const jobs = await db.collection(JOBS_COLLECTION)
        .find(filter)
        .sort({ publishedAt: -1, createdAt: -1 })
        .limit(limit)
        .toArray();

      const feed = buildJobsSyndicationFeed(jobs.map(toJobResponse));

      res.setHeader('Content-Type', 'application/feed+json; charset=utf-8');
      return res.status(200).json(feed);
    } catch (error) {
      console.error('Get jobs for syndication error:', error);
      return res.status(500).json({ success: false, error: 'Failed to build jobs syndication feed' });
    }
  },
};
