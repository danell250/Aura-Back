import { Request, Response } from 'express';
import crypto from 'crypto';
import { getDB, isDBConnected } from '../db';
import { resolveIdentityActor } from '../utils/identityUtils';
import { emitAuthorInsightsUpdate } from './postsController';
import { getHashtagsFromText } from '../utils/hashtagUtils';
import { parsePositiveInt, readString, readStringOrNull } from '../utils/inputSanitizers';
import { buildJobSkillGap } from '../services/jobSkillGapService';
import { buildJobRecommendationPrecomputedFields, buildJobRecommendationScore, resolveRecommendationMatchTier } from '../services/jobRecommendationService';
import { buildCompanyJobAnalytics, EMPTY_COMPANY_JOB_ANALYTICS, invalidateCompanyJobAnalyticsCache } from '../services/companyJobAnalyticsService';
import {
  incrementApplicantApplicationCount,
  resolveOwnerAdminCompanyAccess,
  scheduleJobApplicationPostCreateEffects,
} from '../services/jobApplicationLifecycleService';
import { recordJobPulseEventAsync } from '../services/jobPulseService';
import { listTopJobMatchesForUser } from '../services/reverseJobMatchService';
import { resolveCachedRecommendationProfile } from '../services/jobRecommendationProfileCacheService';
import { awardStatusDrivenBadge } from '../services/userBadgeService';
import { normalizeEmailAddress, normalizeExternalUrl } from '../utils/contactNormalization';

const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const JOB_APPLICATION_NOTES_COLLECTION = 'application_notes';
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';
const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
const ALLOWED_APPLICATION_STATUSES = new Set(['submitted', 'in_review', 'shortlisted', 'rejected', 'hired', 'withdrawn']);
const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_NETWORK_COUNT_SCAN_IDS = 5000;
const JOB_SKILL_GAP_TIMEOUT_MS = 180;
const CAREER_PAGE_SOURCE_SITES = new Set(['greenhouse', 'lever', 'workday', 'smartrecruiters', 'careers']);
const JOB_VIEW_FLUSH_INTERVAL_MS = 5000;
const JOB_VIEW_BUFFER_MAX_KEYS = 400;
const JOB_VIEW_FLUSH_BATCH_SIZE = 100;
const JOB_DISCOVERED_WINDOW_MINUTES = 30;
const JOB_DISCOVERED_COUNT_CACHE_TTL_MS = 60_000;
const JOB_DISCOVERED_COUNT_CACHE_MAX_KEYS = 200;
const AURA_PUBLIC_WEB_BASE_URL = (
  readString(process.env.AURA_PUBLIC_WEB_URL, 320)
  || readString(process.env.FRONTEND_URL, 320)
  || readString(process.env.VITE_FRONTEND_URL, 320)
  || 'https://aura.social'
).replace(/\/+$/, '');

type Pagination = {
  page: number;
  limit: number;
  skip: number;
};

const readStringList = (value: unknown, maxItems = 10, maxLength = 40): string[] => {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    const normalized = readString(item, maxLength).toLowerCase();
    if (!normalized || deduped.has(normalized)) continue;
    deduped.add(normalized);
    next.push(normalized);
    if (next.length >= maxItems) break;
  }
  return next;
};

export const getPagination = (query: Record<string, unknown>): Pagination => {
  const page = parsePositiveInt(query.page, 1, 1, 100000);
  const limit = parsePositiveInt(query.limit, 20, 1, 100);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const resolveJobSkillGap = async (params: {
  db: any;
  currentUserId: string;
  viewer: any;
  job: any;
}) => {
  const currentUserId = readString(params.currentUserId, 120);
  if (!currentUserId) return null;

  const supportsTimeoutSignal =
    typeof AbortSignal !== 'undefined' &&
    typeof (AbortSignal as any).timeout === 'function';
  const signal: AbortSignal | undefined = supportsTimeoutSignal
    ? (AbortSignal as any).timeout(JOB_SKILL_GAP_TIMEOUT_MS)
    : undefined;

  try {
    return await buildJobSkillGap({
      db: params.db,
      currentUserId,
      viewer: params.viewer,
      job: params.job,
      signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') return null;
    console.warn('Job skill gap analysis error:', error);
    return null;
  }
};

const parseIsoOrNull = (value: unknown): string | null => {
  if (value == null) return null;
  const asString = readString(String(value), 100);
  if (!asString) return null;
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

export const hashSecureToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const escapeRegexPattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const sanitizeSearchRegex = (raw: string): RegExp | null => {
  const trimmed = readString(raw, 100);
  if (!trimmed) return null;
  const escaped = escapeRegexPattern(trimmed);
  return new RegExp(escaped, 'i');
};

const normalizeSlugValue = (value: unknown, maxLength = 220): string => {
  const raw = readString(String(value || ''), maxLength)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const parseDelimitedAllowedValues = (raw: string, allowed: Set<string>): string[] =>
  raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0 && allowed.has(item));

type PublicJobsSortOption = 'latest' | 'salary_desc' | 'salary_asc';

type PublicJobsQuerySpec = {
  filter: Record<string, unknown>;
  sort: Record<string, unknown>;
  usesTextSearch: boolean;
  searchText: string;
};

const parseSourceSite = (value: unknown): string => {
  const source = readString(value, 120).toLowerCase();
  if (!source) return '';
  const [, suffix = source] = source.split(':', 2);
  return readString(suffix, 120).toLowerCase();
};

let jobsTextIndexEnsured = false;

export const ensureJobsTextIndex = async (db: any): Promise<boolean> => {
  if (jobsTextIndexEnsured) return true;
  try {
    await db.collection(JOBS_COLLECTION).createIndex(
      {
        title: 'text',
        summary: 'text',
        description: 'text',
        locationText: 'text',
        companyName: 'text',
        companyHandle: 'text',
        tags: 'text',
      },
      {
        name: 'jobs_public_search_text_idx',
        weights: {
          title: 10,
          companyName: 8,
          tags: 6,
          summary: 4,
          description: 2,
          locationText: 2,
          companyHandle: 1,
        },
      },
    );
    jobsTextIndexEnsured = true;
    return true;
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('already exists') ||
      message.includes('index with name') ||
      message.includes('equivalent index already exists')
    ) {
      jobsTextIndexEnsured = true;
      return true;
    }
    console.error('Failed to ensure jobs text index:', error);
    return false;
  }
};

export const buildPublicJobsQuerySpec = (params: {
  status: string;
  workModelRaw: string;
  employmentTypeRaw: string;
  locationRaw: string;
  companyRaw: string;
  searchRaw: string;
  minSalary: number;
  maxSalary: number;
  postedWithinHours: number;
  sortBy: string;
  allowTextSearch: boolean;
}): PublicJobsQuerySpec => {
  const workModels = params.workModelRaw
    ? parseDelimitedAllowedValues(params.workModelRaw, ALLOWED_WORK_MODELS)
    : [];
  const employmentTypes = params.employmentTypeRaw
    ? parseDelimitedAllowedValues(params.employmentTypeRaw, ALLOWED_EMPLOYMENT_TYPES)
    : [];
  const locationRegex = sanitizeSearchRegex(params.locationRaw);
  const companyRegex = sanitizeSearchRegex(params.companyRaw);
  const searchText = readString(params.searchRaw, 120);

  const andClauses: Record<string, unknown>[] = [];
  if (params.status === 'all') {
    andClauses.push({ status: { $ne: 'archived' } });
  } else {
    andClauses.push({ status: params.status });
  }
  if (workModels.length > 0) {
    andClauses.push({ workModel: { $in: workModels } });
  }
  if (employmentTypes.length > 0) {
    andClauses.push({ employmentType: { $in: employmentTypes } });
  }
  if (locationRegex) {
    andClauses.push({ locationText: locationRegex });
  }
  if (companyRegex) {
    andClauses.push({ companyName: companyRegex });
  }
  if (Number.isFinite(params.minSalary) && params.minSalary > 0) {
    andClauses.push({
      $or: [
        { salaryMax: { $gte: params.minSalary } },
        { salaryMin: { $gte: params.minSalary } },
      ],
    });
  }
  if (Number.isFinite(params.maxSalary) && params.maxSalary > 0) {
    andClauses.push({
      $or: [
        { salaryMin: { $lte: params.maxSalary } },
        { salaryMax: { $lte: params.maxSalary } },
      ],
    });
  }
  if (Number.isFinite(params.postedWithinHours) && params.postedWithinHours > 0) {
    const thresholdIso = new Date(Date.now() - (params.postedWithinHours * 60 * 60 * 1000)).toISOString();
    andClauses.push({
      $or: [
        { publishedAt: { $gte: thresholdIso } },
        { createdAt: { $gte: thresholdIso } },
      ],
    });
  }
  const usesTextSearch = searchText.length > 0 && params.allowTextSearch;

  if (usesTextSearch) {
    andClauses.push({ $text: { $search: searchText } });
  }

  const filter =
    andClauses.length === 1
      ? andClauses[0]
      : andClauses.length > 1
        ? { $and: andClauses }
        : {};

  const sortByNormalized = readString(params.sortBy, 40).toLowerCase() as PublicJobsSortOption;
  const sort: Record<string, unknown> =
    sortByNormalized === 'salary_desc'
      ? { salaryMax: -1, salaryMin: -1, ...(usesTextSearch ? { score: { $meta: 'textScore' } } : {}), publishedAt: -1, createdAt: -1 }
      : sortByNormalized === 'salary_asc'
        ? { salaryMin: 1, salaryMax: 1, ...(usesTextSearch ? { score: { $meta: 'textScore' } } : {}), publishedAt: -1, createdAt: -1 }
        : usesTextSearch
          ? { score: { $meta: 'textScore' }, publishedAt: -1, createdAt: -1 }
          : { publishedAt: -1, createdAt: -1 };

  return {
    filter: filter as Record<string, unknown>,
    sort,
    usesTextSearch,
    searchText,
  };
};

const slugifySegment = (value: unknown, maxLength = 80): string => {
  const normalized = readString(String(value || ''), 240)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, maxLength).replace(/-+$/g, '');
};

const buildJobSlug = (job: any): string => {
  const titlePart = slugifySegment(job?.title, 90);
  const locationPart = slugifySegment(job?.locationText, 70);
  const companyPart = slugifySegment(job?.companyName || job?.companyHandle, 70);
  const parts = [titlePart, locationPart || companyPart].filter((part) => part.length > 0);
  return parts.join('-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
};

const buildPersistentJobSlug = (job: any): string => {
  if (!job || typeof job !== 'object') return 'job';
  const stored = normalizeSlugValue(job?.slug, 220);
  if (stored) return stored;

  const baseSlug = buildJobSlug(job) || 'job';
  const idSlug = slugifySegment(job?.id, 120);
  const rawSlug = idSlug ? `${baseSlug}--${idSlug}` : baseSlug;
  return normalizeSlugValue(rawSlug, 220) || 'job';
};

const toAnnouncementTag = (tag: string) => tag.replace(/[^a-z0-9]/gi, '').toLowerCase();

const buildJobAnnouncementContent = (job: {
  title: string;
  companyName: string;
  locationText: string;
  workModel: string;
  employmentType: string;
  summary: string;
  tags: string[];
}) => {
  const normalizedTags = Array.from(
    new Set(
      (job.tags || [])
        .map(toAnnouncementTag)
        .filter((value) => value.length > 0),
    ),
  ).slice(0, 5);

  const hashtagList = Array.from(
    new Set(['hiring', 'jobs', ...normalizedTags]),
  )
    .map((tag) => `#${tag}`)
    .join(' ');

  return [
    `We're hiring: ${job.title}`,
    '',
    `${job.companyName} is opening a new role.`,
    `Location: ${job.locationText} • ${job.workModel.replace('_', ' ')} • ${job.employmentType.replace('_', ' ')}`,
    '',
    job.summary,
    '',
    'Apply directly from our Jobs tab on Aura.',
    hashtagList,
  ].join('\n');
};

export const toJobResponse = (job: any) => ({
  id: String(job?.id || ''),
  slug: buildPersistentJobSlug(job),
  source: readString(job?.source, 120) || null,
  sourceSite: parseSourceSite(job?.source) || null,
  isCareerPageSource: CAREER_PAGE_SOURCE_SITES.has(parseSourceSite(job?.source)),
  companyId: String(job?.companyId || ''),
  companyName: String(job?.companyName || ''),
  companyHandle: String(job?.companyHandle || ''),
  companyIsVerified: Boolean(job?.companyIsVerified),
  companyWebsite: readStringOrNull(job?.companyWebsite, 600),
  companyEmail: readStringOrNull(job?.companyEmail, 200),
  title: String(job?.title || ''),
  summary: String(job?.summary || ''),
  description: String(job?.description || ''),
  locationText: String(job?.locationText || ''),
  workModel: String(job?.workModel || 'onsite'),
  employmentType: String(job?.employmentType || 'full_time'),
  salaryMin: typeof job?.salaryMin === 'number' ? job.salaryMin : null,
  salaryMax: typeof job?.salaryMax === 'number' ? job.salaryMax : null,
  salaryCurrency: String(job?.salaryCurrency || ''),
  applicationDeadline: job?.applicationDeadline || null,
  status: String(job?.status || 'open'),
  tags: Array.isArray(job?.tags) ? job.tags : [],
  createdByUserId: String(job?.createdByUserId || ''),
  createdAt: job?.createdAt || null,
  discoveredAt: job?.discoveredAt || null,
  updatedAt: job?.updatedAt || null,
  publishedAt: job?.publishedAt || null,
  announcementPostId: job?.announcementPostId || null,
  applicationUrl: readStringOrNull(job?.applicationUrl, 600),
  applicationEmail: readStringOrNull(job?.applicationEmail, 200),
  applicationCount: Number.isFinite(job?.applicationCount) ? Number(job.applicationCount) : 0,
  viewCount: Number.isFinite(job?.viewCount) ? Number(job.viewCount) : 0,
});

export const toApplicationResponse = (application: any) => ({
  id: String(application?.id || ''),
  jobId: String(application?.jobId || ''),
  companyId: String(application?.companyId || ''),
  applicantUserId: String(application?.applicantUserId || ''),
  applicantName: String(application?.applicantName || ''),
  applicantEmail: String(application?.applicantEmail || ''),
  applicantPhone: String(application?.applicantPhone || ''),
  coverLetter: String(application?.coverLetter || ''),
  portfolioUrl: String(application?.portfolioUrl || ''),
  resumeKey: String(application?.resumeKey || ''),
  resumeFileName: String(application?.resumeFileName || ''),
  resumeMimeType: String(application?.resumeMimeType || ''),
  resumeSize: Number.isFinite(application?.resumeSize) ? Number(application.resumeSize) : 0,
  status: String(application?.status || 'submitted'),
  createdAt: application?.createdAt || null,
  updatedAt: application?.updatedAt || null,
  reviewedByUserId: application?.reviewedByUserId || null,
  reviewedAt: application?.reviewedAt || null,
  statusNote: application?.statusNote || null,
});

const pendingJobViewCount = new Map<string, number>();
let isJobViewFlushScheduled = false;
let isJobViewShutdownHookRegistered = false;
const discoveredCountCache = new Map<string, { count: number; expiresAt: number }>();

const takePendingJobViewCountBatch = (): Array<[string, number]> => {
  const snapshot: Array<[string, number]> = [];
  const iterator = pendingJobViewCount.entries();
  while (snapshot.length < JOB_VIEW_FLUSH_BATCH_SIZE) {
    const next = iterator.next();
    if (next.done) break;
    const [jobId, count] = next.value;
    pendingJobViewCount.delete(jobId);
    snapshot.push([jobId, count]);
  }
  return snapshot;
};

const flushJobViewCountBuffer = async (db: any): Promise<void> => {
  if (pendingJobViewCount.size === 0) return;
  const snapshot = takePendingJobViewCountBatch();
  if (snapshot.length === 0) return;

  const operations = snapshot.map(([jobId, count]) => ({
    updateOne: {
      filter: { id: jobId, status: { $ne: 'archived' } },
      update: { $inc: { viewCount: count } },
    },
  }));

  try {
    await db.collection(JOBS_COLLECTION).bulkWrite(operations, { ordered: false });
  } catch (error: any) {
    for (const [jobId, count] of snapshot) {
      pendingJobViewCount.set(jobId, (pendingJobViewCount.get(jobId) || 0) + count);
    }
    console.warn('Flush job view count buffer error:', error);
  } finally {
    if (pendingJobViewCount.size > 0) {
      scheduleJobViewCountFlush(db);
    }
  }
};

const scheduleJobViewCountFlush = (db: any): void => {
  if (isJobViewFlushScheduled) return;
  isJobViewFlushScheduled = true;
  setTimeout(() => {
    isJobViewFlushScheduled = false;
    void flushJobViewCountBuffer(db);
  }, JOB_VIEW_FLUSH_INTERVAL_MS);
};

export const registerJobViewCountShutdownHooks = (dbProvider: () => any = getDB): void => {
  if (isJobViewShutdownHookRegistered) return;
  isJobViewShutdownHookRegistered = true;

  const flushOnShutdown = () => {
    if (!isDBConnected()) return;
    void flushJobViewCountBuffer(dbProvider());
  };

  process.once('SIGINT', flushOnShutdown);
  process.once('SIGTERM', flushOnShutdown);
  process.once('beforeExit', flushOnShutdown);
};

const incrementJobViewCountAsync = (db: any, jobId: string, userId?: string): void => {
  if (!jobId) return;
  pendingJobViewCount.set(jobId, (pendingJobViewCount.get(jobId) || 0) + 1);
  const viewEvent = {
    jobId,
    type: 'job_viewed' as const,
    userId,
  };
  recordJobPulseEventAsync(db, viewEvent);
  if (pendingJobViewCount.size >= JOB_VIEW_BUFFER_MAX_KEYS) {
    void flushJobViewCountBuffer(db);
    return;
  }
  scheduleJobViewCountFlush(db);
};

const withOptimisticViewCount = (job: any): any => ({
  ...job,
  viewCount:
    Number.isFinite(job?.viewCount)
      ? Number(job.viewCount) + 1
      : 1,
});

const buildDiscoveredWindowFilter = (
  baseFilter: Record<string, unknown>,
  thresholdIso: string,
): Record<string, unknown> => {
  const hasBaseFilter = baseFilter && Object.keys(baseFilter).length > 0;
  const discoveredClause = { createdAt: { $gte: thresholdIso } };
  if (!hasBaseFilter) return discoveredClause;
  return { $and: [baseFilter, discoveredClause] };
};

const buildDiscoveredCountCacheKey = (parts: Record<string, unknown>): string => {
  const normalizedParts = Object.entries(parts)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value ?? ''))}`)
    .join('&');
  return crypto.createHash('sha256').update(normalizedParts).digest('hex');
};

const refreshDiscoveredCountCacheEntry = (
  cacheKey: string,
  entry: { count: number; expiresAt: number },
) => {
  discoveredCountCache.delete(cacheKey);
  discoveredCountCache.set(cacheKey, entry);
};

const storeDiscoveredCountCacheEntry = (
  cacheKey: string,
  entry: { count: number; expiresAt: number },
  now: number,
) => {
  refreshDiscoveredCountCacheEntry(cacheKey, entry);
  pruneDiscoveredCountCache(now);
};

const pruneDiscoveredCountCache = (now: number) => {
  for (const [key, cacheValue] of discoveredCountCache.entries()) {
    if (cacheValue.expiresAt <= now) {
      discoveredCountCache.delete(key);
    }
  }
  while (discoveredCountCache.size > JOB_DISCOVERED_COUNT_CACHE_MAX_KEYS) {
    const oldestEntry = discoveredCountCache.keys().next();
    if (oldestEntry.done) break;
    discoveredCountCache.delete(oldestEntry.value);
  }
};

const resolveCachedDiscoveredCount = async (
  db: any,
  filter: Record<string, unknown>,
  cacheKey: string,
): Promise<number> => {
  const now = Date.now();
  pruneDiscoveredCountCache(now);

  const cached = discoveredCountCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    refreshDiscoveredCountCacheEntry(cacheKey, cached);
    return cached.count;
  }

  const count = await db.collection(JOBS_COLLECTION).countDocuments(filter);
  storeDiscoveredCountCacheEntry(cacheKey, {
    count,
    expiresAt: now + JOB_DISCOVERED_COUNT_CACHE_TTL_MS,
  }, now);
  return count;
};

export const jobsController = {
  // GET /api/companies/:companyId/jobs
  listCompanyJobs: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 20, total: 0, pages: 0 },
        });
      }

      const { companyId } = req.params;
      const db = getDB();
      const statusRaw = readString((req.query as any).status, 40).toLowerCase() || 'open';
      const status = statusRaw === 'all' ? 'all' : statusRaw;
      if (status !== 'all' && !ALLOWED_JOB_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status filter' });
      }

      const pagination = getPagination(req.query as Record<string, unknown>);

      const filter: Record<string, unknown> = { companyId };
      if (status === 'all') {
        filter.status = { $ne: 'archived' };
      } else {
        filter.status = status;
      }

      const [items, total] = await Promise.all([
        db.collection(JOBS_COLLECTION)
          .find(filter)
          .sort({ publishedAt: -1, createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .toArray(),
        db.collection(JOBS_COLLECTION).countDocuments(filter),
      ]);

      return res.json({
        success: true,
        data: items.map(toJobResponse),
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages: Math.ceil(total / pagination.limit),
        },
      });
    } catch (error) {
      console.error('List company jobs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
    }
  },

  // GET /api/jobs
  listPublicJobs: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 20, total: 0, pages: 0 },
        });
      }

      const db = getDB();
      const statusRaw = readString((req.query as any).status, 40).toLowerCase() || 'open';
      const status = statusRaw === 'all' ? 'all' : statusRaw;
      if (status !== 'all' && !ALLOWED_JOB_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status filter' });
      }

      const workModelRaw = readString((req.query as any).workModel, 80).toLowerCase();
      const employmentTypeRaw = readString((req.query as any).employmentType, 80).toLowerCase();
      const locationRaw = readString((req.query as any).location, 100);
      const companyRaw = readString((req.query as any).company, 100);
      const searchRaw = readString((req.query as any).q, 120);
      const minSalary = Number((req.query as any).salaryMin);
      const maxSalary = Number((req.query as any).salaryMax);
      const postedWithinHours = Number((req.query as any).postedWithinHours);
      const sortBy = readString((req.query as any).sort, 40).toLowerCase() || 'latest';
      const pagination = getPagination(req.query as Record<string, unknown>);

      if (Number.isFinite(minSalary) && Number.isFinite(maxSalary) && minSalary > 0 && maxSalary > 0 && maxSalary < minSalary) {
        return res.status(400).json({ success: false, error: 'salaryMax cannot be less than salaryMin' });
      }

      const allowTextSearch = await ensureJobsTextIndex(db);
      if (searchRaw && !allowTextSearch) {
        return res.status(503).json({
          success: false,
          error: 'Search index is warming up. Please retry in a moment.',
        });
      }
      const querySpec = buildPublicJobsQuerySpec({
        status,
        workModelRaw,
        employmentTypeRaw,
        locationRaw,
        companyRaw,
        searchRaw,
        minSalary,
        maxSalary,
        postedWithinHours,
        sortBy,
        allowTextSearch,
      });

      const currentUserId = readString((req.user as any)?.id, 120);
      const recommendationProfilePromise = resolveCachedRecommendationProfile(db, currentUserId);
      const discoveredThresholdIso = new Date(
        Date.now() - (JOB_DISCOVERED_WINDOW_MINUTES * 60 * 1000),
      ).toISOString();
      const discoveredFilter = buildDiscoveredWindowFilter(querySpec.filter, discoveredThresholdIso);
      const discoveredCountCacheKey = buildDiscoveredCountCacheKey({
        status,
        workModelRaw,
        employmentTypeRaw,
        locationRaw,
        companyRaw,
        searchRaw,
        minSalary: Number.isFinite(minSalary) ? minSalary : '',
        maxSalary: Number.isFinite(maxSalary) ? maxSalary : '',
        postedWithinHours: Number.isFinite(postedWithinHours) ? postedWithinHours : '',
      });

      const [items, total, discoveredLast30Minutes, recommendationProfile] = await Promise.all([
        db.collection(JOBS_COLLECTION)
          .find(
            querySpec.filter,
            querySpec.usesTextSearch
              ? {
                  projection: { score: { $meta: 'textScore' } },
                }
              : undefined,
          )
          .sort(querySpec.sort as any)
          .skip(pagination.skip)
          .limit(pagination.limit)
          .toArray(),
        db.collection(JOBS_COLLECTION).countDocuments(querySpec.filter),
        resolveCachedDiscoveredCount(db, discoveredFilter, discoveredCountCacheKey),
        recommendationProfilePromise,
      ]);
      const jobsWithRecommendations = items.map((item) => {
        const base = toJobResponse(item);
        if (!recommendationProfile) return base;

        const recommendation = buildJobRecommendationScore(item, recommendationProfile);
        const roundedScore = Math.max(0, Math.round(recommendation.score));
        return {
          ...base,
          recommendationScore: roundedScore,
          recommendationReasons: recommendation.reasons.slice(0, 3),
          matchedSkills: recommendation.matchedSkills.slice(0, 5),
          matchTier: resolveRecommendationMatchTier(roundedScore),
        };
      });

      return res.json({
        success: true,
        data: jobsWithRecommendations,
        meta: {
          discoveredLast30Minutes:
            Number.isFinite(discoveredLast30Minutes) && discoveredLast30Minutes > 0
              ? Number(discoveredLast30Minutes)
              : 0,
        },
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages: Math.ceil(total / pagination.limit),
        },
      });
    } catch (error) {
      console.error('List public jobs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
    }
  },

  // GET /api/jobs/matches/:handle
  getPublicJobMatchesByHandle: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const rawHandle = readString(req.params.handle, 120).replace(/^@+/, '');
      if (!rawHandle) {
        return res.status(400).json({ success: false, error: 'Handle is required' });
      }

      const db = getDB();
      const handleRegex = new RegExp(`^@?${escapeRegexPattern(rawHandle)}$`, 'i');
      const publicUser = await db.collection(USERS_COLLECTION).findOne(
        { handle: handleRegex },
        {
          projection: {
            id: 1,
            handle: 1,
            firstName: 1,
            name: 1,
            jobMatchShareEnabled: 1,
          },
        },
      );

      if (!publicUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if ((publicUser as any)?.jobMatchShareEnabled !== true) {
        return res.status(403).json({ success: false, error: 'This match feed is private' });
      }

      const user = await db.collection(USERS_COLLECTION).findOne(
        { id: String((publicUser as any)?.id || '') },
        {
          projection: {
            id: 1,
            handle: 1,
            firstName: 1,
            name: 1,
            title: 1,
            skills: 1,
            profileSkills: 1,
            location: 1,
            country: 1,
            industry: 1,
            remotePreference: 1,
            workPreference: 1,
            preferredWorkModel: 1,
            preferredWorkModels: 1,
            workPreferences: 1,
            experienceLevel: 1,
            seniority: 1,
            roleLevel: 1,
            jobSeniorityPreference: 1,
            yearsOfExperience: 1,
            experienceYears: 1,
            totalExperienceYears: 1,
          },
        },
      );
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const limit = parsePositiveInt((req.query as any)?.limit, 20, 1, 40);
      const matchedJobs = await listTopJobMatchesForUser({
        db,
        user,
        limit,
      });

      const normalizedHandle = readString((publicUser as any)?.handle, 120) || `@${rawHandle.toLowerCase()}`;
      return res.json({
        success: true,
        data: matchedJobs.map((job) => ({
          ...toJobResponse(job),
          recommendationScore:
            Number.isFinite((job as any)?.recommendationScore) && Number((job as any)?.recommendationScore) > 0
              ? Number((job as any).recommendationScore)
              : 0,
          recommendationReasons: Array.isArray((job as any)?.recommendationReasons)
            ? (job as any).recommendationReasons.slice(0, 3)
            : [],
          matchedSkills: Array.isArray((job as any)?.matchedSkills)
            ? (job as any).matchedSkills.slice(0, 5)
            : [],
          matchTier:
            (job as any)?.matchTier === 'best' || (job as any)?.matchTier === 'good' || (job as any)?.matchTier === 'other'
              ? (job as any).matchTier
              : 'other',
        })),
        meta: {
          user: {
            id: String((publicUser as any)?.id || ''),
            handle: normalizedHandle,
            name:
              readString((publicUser as any)?.name, 160)
              || readString((publicUser as any)?.firstName, 120)
              || normalizedHandle,
          },
          shareUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs/${encodeURIComponent(normalizedHandle)}`,
        },
      });
    } catch (error) {
      console.error('Get public job matches by handle error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch public job matches' });
    }
  },

  // GET /api/jobs/salary-insights
  getSalaryInsights: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const jobTitle = readString((req.query as any).jobTitle, 140);
      const location = readString((req.query as any).location, 140);
      if (!jobTitle || !location) {
        return res.status(400).json({ success: false, error: 'jobTitle and location are required' });
      }

      const db = getDB();
      const allowTextSearch = await ensureJobsTextIndex(db);
      if (!allowTextSearch) {
        return res.status(503).json({
          success: false,
          error: 'Search index is warming up. Please retry in a moment.',
        });
      }
      const searchText = `${jobTitle} ${location}`.trim();
      const missingMinSentinel = Number.MAX_SAFE_INTEGER;
      const missingMaxSentinel = -1;

      const [aggregated] = await db.collection(JOBS_COLLECTION)
        .aggregate([
          {
            $match: {
              status: 'open',
              $text: { $search: searchText },
              $or: [
                { salaryMin: { $type: 'number' } },
                { salaryMax: { $type: 'number' } },
              ],
            },
          },
          {
            $group: {
              _id: null,
              sampleSize: { $sum: 1 },
              avgMin: {
                $avg: {
                  $cond: [{ $isNumber: '$salaryMin' }, '$salaryMin', null],
                },
              },
              avgMax: {
                $avg: {
                  $cond: [{ $isNumber: '$salaryMax' }, '$salaryMax', null],
                },
              },
              minSalaryCandidate: {
                $min: {
                  $cond: [{ $isNumber: '$salaryMin' }, '$salaryMin', missingMinSentinel],
                },
              },
              maxSalaryCandidate: {
                $max: {
                  $cond: [{ $isNumber: '$salaryMax' }, '$salaryMax', missingMaxSentinel],
                },
              },
            },
          },
          {
            $project: {
              sampleSize: 1,
              avgMin: 1,
              avgMax: 1,
              minSalary: {
                $cond: [{ $eq: ['$minSalaryCandidate', missingMinSentinel] }, null, '$minSalaryCandidate'],
              },
              maxSalary: {
                $cond: [{ $eq: ['$maxSalaryCandidate', missingMaxSentinel] }, null, '$maxSalaryCandidate'],
              },
            },
          },
        ])
        .toArray();

      return res.json({
        success: true,
        data: {
          sampleSize: Number.isFinite(aggregated?.sampleSize) ? Number(aggregated.sampleSize) : 0,
          avgMin: Number.isFinite(aggregated?.avgMin) ? Number(aggregated.avgMin) : null,
          avgMax: Number.isFinite(aggregated?.avgMax) ? Number(aggregated.avgMax) : null,
          minSalary: Number.isFinite(aggregated?.minSalary) ? Number(aggregated.minSalary) : null,
          maxSalary: Number.isFinite(aggregated?.maxSalary) ? Number(aggregated.maxSalary) : null,
        },
      });
    } catch (error) {
      console.error('Get salary insights error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch salary insights' });
    }
  },

  // GET /api/jobs/slug/:jobSlug
  getJobBySlug: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const rawRequestedSlug = readString(req.params.jobSlug, 220).toLowerCase();
      const requestedSlug = normalizeSlugValue(rawRequestedSlug, 220);
      if (!requestedSlug) {
        return res.status(400).json({ success: false, error: 'Invalid job slug' });
      }

      const db = getDB();
      const currentUserId = readString((req.user as any)?.id, 120);

      const slugIdMatch = rawRequestedSlug.match(/(?:^|--)(job-[a-z0-9-]+)$/i);
      const slugJobId = slugIdMatch?.[1] || '';
      if (slugJobId) {
        const byId = await db.collection(JOBS_COLLECTION).findOne({ id: slugJobId, status: { $ne: 'archived' } });
        if (byId) {
          incrementJobViewCountAsync(db, slugJobId, currentUserId);
          const byIdWithView = withOptimisticViewCount(byId);
          const skillGap = currentUserId
            ? await resolveJobSkillGap({
                db,
                currentUserId,
                viewer: req.user,
                job: byIdWithView,
              })
            : null;
          return res.json({
            success: true,
            data: {
              ...toJobResponse(byIdWithView),
              ...(skillGap ? { skillGap } : {}),
            },
          });
        }
      }

      const bySlug = await db.collection(JOBS_COLLECTION).findOne({
        slug: requestedSlug,
        status: { $ne: 'archived' },
      });
      if (!bySlug) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }
      incrementJobViewCountAsync(db, readString(bySlug?.id, 120), currentUserId);
      const bySlugWithView = withOptimisticViewCount(bySlug);

      const skillGap = currentUserId
        ? await resolveJobSkillGap({
            db,
            currentUserId,
            viewer: req.user,
            job: bySlugWithView,
          })
        : null;
      return res.json({
        success: true,
        data: {
          ...toJobResponse(bySlugWithView),
          ...(skillGap ? { skillGap } : {}),
        },
      });
    } catch (error) {
      console.error('Get job by slug error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch job' });
    }
  },

  // GET /api/jobs/:jobId
  getJobById: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const { jobId } = req.params;
      const db = getDB();
      const currentUserId = readString((req.user as any)?.id, 120);
      const job = await db.collection(JOBS_COLLECTION).findOne({ id: jobId, status: { $ne: 'archived' } });

      if (!job) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }
      incrementJobViewCountAsync(db, jobId, currentUserId);
      const jobWithView = withOptimisticViewCount(job);

      const skillGap = currentUserId
        ? await resolveJobSkillGap({
            db,
            currentUserId,
            viewer: req.user,
            job: jobWithView,
          })
        : null;
      return res.json({
        success: true,
        data: {
          ...toJobResponse(jobWithView),
          ...(skillGap ? { skillGap } : {}),
        },
      });
    } catch (error) {
      console.error('Get job error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch job' });
    }
  },

  // GET /api/jobs/:jobId/network-count
  getJobNetworkCount: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
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
        { projection: { id: 1, companyId: 1 } },
      );

      if (!job) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }

      const companyId = readString(job.companyId, 120);
      if (!companyId) {
        return res.json({ success: true, data: { count: 0, companyId: '' } });
      }

      const currentUser = await db.collection(USERS_COLLECTION).findOne(
        { id: currentUserId },
        { projection: { acquaintances: 1 } },
      );

      const acquaintanceIds = Array.isArray(currentUser?.acquaintances)
        ? Array.from(
            new Set(
              currentUser.acquaintances
                .map((value: unknown) => readString(value, 120))
                .filter((value: string) => value.length > 0),
            ),
          )
        : [];

      if (acquaintanceIds.length === 0) {
        return res.json({ success: true, data: { count: 0, companyId } });
      }

      const scannedAcquaintanceIds = acquaintanceIds.slice(0, MAX_NETWORK_COUNT_SCAN_IDS);
      const count = await db.collection(COMPANY_MEMBERS_COLLECTION).countDocuments({
        companyId,
        userId: { $in: scannedAcquaintanceIds },
      });

      return res.json({
        success: true,
        data: {
          count,
          companyId,
        },
      });
    } catch (error) {
      console.error('Get job network count error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch network count' });
    }
  },

  // POST /api/jobs
  createJob: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const requestedCompanyId =
        readString((req.body as any)?.companyId, 120) ||
        readString((req.headers['x-identity-id'] as string | undefined) || '', 120);

      const actor = await resolveIdentityActor(
        currentUserId,
        { ownerType: 'company', ownerId: requestedCompanyId },
      );

      if (!actor || actor.type !== 'company') {
        return res.status(403).json({ success: false, error: 'Company identity context is required' });
      }

      const access = await resolveOwnerAdminCompanyAccess(actor.id, currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const title = readString((req.body as any)?.title, 120);
      const summary = readString((req.body as any)?.summary, 240);
      const description = readString((req.body as any)?.description, 15000);
      const locationText = readString((req.body as any)?.locationText, 160);
      const workModel = readString((req.body as any)?.workModel, 40).toLowerCase();
      const employmentType = readString((req.body as any)?.employmentType, 40).toLowerCase();
      const tags = readStringList((req.body as any)?.tags, 10, 40);

      if (!title || !summary || !description || !locationText) {
        return res.status(400).json({
          success: false,
          error: 'title, summary, description, and locationText are required',
        });
      }

      if (!ALLOWED_WORK_MODELS.has(workModel)) {
        return res.status(400).json({ success: false, error: 'Invalid workModel' });
      }

      if (!ALLOWED_EMPLOYMENT_TYPES.has(employmentType)) {
        return res.status(400).json({ success: false, error: 'Invalid employmentType' });
      }

      const salaryMinRaw = (req.body as any)?.salaryMin;
      const salaryMaxRaw = (req.body as any)?.salaryMax;
      const salaryMin = Number.isFinite(Number(salaryMinRaw)) ? Number(salaryMinRaw) : null;
      const salaryMax = Number.isFinite(Number(salaryMaxRaw)) ? Number(salaryMaxRaw) : null;
      const salaryCurrency = readString((req.body as any)?.salaryCurrency, 10).toUpperCase();
      const applicationDeadline = parseIsoOrNull((req.body as any)?.applicationDeadline);
      const hasApplicationUrlPayload = (req.body as any)?.applicationUrl !== undefined;
      const hasApplicationEmailPayload = (req.body as any)?.applicationEmail !== undefined;
      const applicationUrl = normalizeExternalUrl((req.body as any)?.applicationUrl);
      const applicationEmail = normalizeEmailAddress((req.body as any)?.applicationEmail);
      const announceInFeed = Boolean((req.body as any)?.announceInFeed);

      if (salaryMin != null && salaryMin < 0) {
        return res.status(400).json({ success: false, error: 'salaryMin cannot be negative' });
      }
      if (salaryMax != null && salaryMax < 0) {
        return res.status(400).json({ success: false, error: 'salaryMax cannot be negative' });
      }
      if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) {
        return res.status(400).json({ success: false, error: 'salaryMax cannot be less than salaryMin' });
      }
      if (hasApplicationUrlPayload && !applicationUrl) {
        return res.status(400).json({ success: false, error: 'applicationUrl must be a valid http(s) URL' });
      }
      if (hasApplicationEmailPayload && !applicationEmail) {
        return res.status(400).json({ success: false, error: 'applicationEmail must be a valid email address' });
      }

      const nowIso = new Date().toISOString();
      const jobId = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const job = {
        id: jobId,
        slug: '',
        companyId: actor.id,
        companyName: readString(access.company?.name, 120) || 'Company',
        companyHandle: readString(access.company?.handle, 80),
        companyIsVerified: Boolean(access.company?.isVerified),
        companyWebsite: normalizeExternalUrl(access.company?.website),
        companyEmail: normalizeEmailAddress(access.company?.email),
        title,
        summary,
        description,
        locationText,
        workModel,
        employmentType,
        salaryMin,
        salaryMax,
        salaryCurrency,
        applicationDeadline,
        status: 'open',
        source: 'aura:company',
        tags,
        createdByUserId: currentUserId,
        createdAt: nowIso,
        discoveredAt: nowIso,
        updatedAt: nowIso,
        publishedAt: nowIso,
        announcementPostId: null as string | null,
        applicationUrl,
        applicationEmail,
        applicationCount: 0,
        viewCount: 0,
      };
      job.slug = buildPersistentJobSlug(job);

      const db = getDB();
      let announcementPostId: string | null = null;

      if (announceInFeed) {
        const nowTimestamp = Date.now();
        const postId = `post-job-${nowTimestamp}-${crypto.randomBytes(4).toString('hex')}`;
        const announcementContent = buildJobAnnouncementContent({
          title,
          companyName: readString(access.company?.name, 120) || 'Company',
          locationText,
          workModel,
          employmentType,
          summary,
          tags,
        });
        const hashtags = getHashtagsFromText(announcementContent);

        const announcementPost = {
          id: postId,
          author: {
            id: actor.id,
            firstName: readString(access.company?.name, 120) || 'Company',
            lastName: '',
            name: readString(access.company?.name, 120) || 'Company',
            handle: readString(access.company?.handle, 80) || '',
            avatar: readString(access.company?.avatar, 500) || '',
            avatarKey: readString(access.company?.avatarKey, 500) || '',
            avatarType: access.company?.avatarType === 'video' ? 'video' : 'image',
            activeGlow: access.company?.activeGlow || 'none',
            type: 'company',
          },
          authorId: actor.id,
          ownerId: actor.id,
          ownerType: 'company',
          content: announcementContent,
          energy: '🪐 Neutral',
          radiance: 0,
          timestamp: nowTimestamp,
          visibility: 'public',
          reactions: {} as Record<string, number>,
          reactionUsers: {} as Record<string, string[]>,
          userReactions: [] as string[],
          comments: [] as any[],
          isBoosted: false,
          viewCount: 0,
          hashtags,
          taggedUserIds: [] as string[],
          jobMeta: {
            jobId: job.id,
            companyId: actor.id,
            title,
            locationText,
            workModel,
            employmentType,
          },
        };

        try {
          await db.collection('posts').insertOne(announcementPost);
          const io = req.app.get('io');
          if (io) {
            io.emit('new_post', announcementPost);
          }
          emitAuthorInsightsUpdate(req.app, actor.id, 'company').catch(() => undefined);
          announcementPostId = postId;
        } catch (announcementError) {
          console.error('Create job announcement post error:', announcementError);
        }
      }

      if (announcementPostId) {
        job.announcementPostId = announcementPostId;
      }

      const recommendationSource = {
        id: job.id,
        title: readString(job.title, 120),
        summary: readString(job.summary, 240),
        description: readString(job.description, 15000),
        locationText: readString(job.locationText, 160),
        tags: Array.isArray(job.tags) ? job.tags : [],
        workModel: readString(job.workModel, 40),
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        createdAt: job.createdAt,
        publishedAt: job.publishedAt,
      };
      Object.assign(job, buildJobRecommendationPrecomputedFields(recommendationSource));

      await db.collection(JOBS_COLLECTION).insertOne(job);
      recordJobPulseEventAsync(db, {
        jobId: job.id,
        type: 'job_discovered',
        userId: currentUserId,
        createdAt: nowIso,
      });

      return res.status(201).json({
        success: true,
        data: toJobResponse(job),
      });
    } catch (error) {
      console.error('Create job error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create job' });
    }
  },

  // PUT /api/jobs/:jobId
  updateJob: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { jobId } = req.params;
      const db = getDB();
      const existingJob = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });
      if (!existingJob) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }

      const access = await resolveOwnerAdminCompanyAccess(String(existingJob.companyId || ''), currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const updates: Record<string, unknown> = {};

      if ((req.body as any).title !== undefined) {
        const value = readString((req.body as any).title, 120);
        if (!value) return res.status(400).json({ success: false, error: 'title cannot be empty' });
        updates.title = value;
      }

      if ((req.body as any).summary !== undefined) {
        const value = readString((req.body as any).summary, 240);
        if (!value) return res.status(400).json({ success: false, error: 'summary cannot be empty' });
        updates.summary = value;
      }

      if ((req.body as any).description !== undefined) {
        const value = readString((req.body as any).description, 15000);
        if (!value) return res.status(400).json({ success: false, error: 'description cannot be empty' });
        updates.description = value;
      }

      if ((req.body as any).locationText !== undefined) {
        const value = readString((req.body as any).locationText, 160);
        if (!value) return res.status(400).json({ success: false, error: 'locationText cannot be empty' });
        updates.locationText = value;
      }

      if ((req.body as any).workModel !== undefined) {
        const value = readString((req.body as any).workModel, 40).toLowerCase();
        if (!ALLOWED_WORK_MODELS.has(value)) return res.status(400).json({ success: false, error: 'Invalid workModel' });
        updates.workModel = value;
      }

      if ((req.body as any).employmentType !== undefined) {
        const value = readString((req.body as any).employmentType, 40).toLowerCase();
        if (!ALLOWED_EMPLOYMENT_TYPES.has(value)) {
          return res.status(400).json({ success: false, error: 'Invalid employmentType' });
        }
        updates.employmentType = value;
      }

      if ((req.body as any).salaryMin !== undefined) {
        const value = Number((req.body as any).salaryMin);
        if (!Number.isFinite(value) || value < 0) {
          return res.status(400).json({ success: false, error: 'salaryMin must be a non-negative number' });
        }
        updates.salaryMin = value;
      }

      if ((req.body as any).salaryMax !== undefined) {
        const value = Number((req.body as any).salaryMax);
        if (!Number.isFinite(value) || value < 0) {
          return res.status(400).json({ success: false, error: 'salaryMax must be a non-negative number' });
        }
        updates.salaryMax = value;
      }

      const nextSalaryMin =
        updates.salaryMin !== undefined
          ? Number(updates.salaryMin)
          : (Number.isFinite(existingJob.salaryMin) ? Number(existingJob.salaryMin) : null);
      const nextSalaryMax =
        updates.salaryMax !== undefined
          ? Number(updates.salaryMax)
          : (Number.isFinite(existingJob.salaryMax) ? Number(existingJob.salaryMax) : null);
      if (nextSalaryMin != null && nextSalaryMax != null && nextSalaryMax < nextSalaryMin) {
        return res.status(400).json({ success: false, error: 'salaryMax cannot be less than salaryMin' });
      }

      if ((req.body as any).salaryCurrency !== undefined) {
        updates.salaryCurrency = readString((req.body as any).salaryCurrency, 10).toUpperCase();
      }

      if ((req.body as any).applicationDeadline !== undefined) {
        const parsed = parseIsoOrNull((req.body as any).applicationDeadline);
        updates.applicationDeadline = parsed;
      }

      if ((req.body as any).applicationUrl !== undefined) {
        const parsedUrl = normalizeExternalUrl((req.body as any).applicationUrl);
        const raw = readString(String((req.body as any).applicationUrl || ''), 600);
        if (raw && !parsedUrl) {
          return res.status(400).json({ success: false, error: 'applicationUrl must be a valid http(s) URL' });
        }
        updates.applicationUrl = parsedUrl;
      }

      if ((req.body as any).applicationEmail !== undefined) {
        const parsedEmail = normalizeEmailAddress((req.body as any).applicationEmail);
        const raw = readString(String((req.body as any).applicationEmail || ''), 200);
        if (raw && !parsedEmail) {
          return res.status(400).json({ success: false, error: 'applicationEmail must be a valid email address' });
        }
        updates.applicationEmail = parsedEmail;
      }

      if ((req.body as any).tags !== undefined) {
        updates.tags = readStringList((req.body as any).tags, 10, 40);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
      }

      if (!normalizeSlugValue(existingJob?.slug, 220)) {
        updates.slug = buildPersistentJobSlug({ ...existingJob, ...updates, id: existingJob.id });
      }

      const recommendationSource = {
        id: existingJob.id,
        title: readString((updates.title as string | undefined) ?? existingJob.title, 120),
        summary: readString((updates.summary as string | undefined) ?? existingJob.summary, 240),
        description: readString((updates.description as string | undefined) ?? existingJob.description, 15000),
        locationText: readString((updates.locationText as string | undefined) ?? existingJob.locationText, 160),
        tags: Array.isArray(updates.tags) ? updates.tags : (Array.isArray(existingJob.tags) ? existingJob.tags : []),
        workModel: readString((updates.workModel as string | undefined) ?? existingJob.workModel, 40),
        salaryMin: updates.salaryMin !== undefined ? updates.salaryMin : existingJob.salaryMin,
        salaryMax: updates.salaryMax !== undefined ? updates.salaryMax : existingJob.salaryMax,
        createdAt: existingJob.createdAt,
        publishedAt: updates.publishedAt !== undefined ? updates.publishedAt : existingJob.publishedAt,
      };
      updates.updatedAt = new Date().toISOString();
      Object.assign(updates, buildJobRecommendationPrecomputedFields(recommendationSource));

      await db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $set: updates });
      const updatedJob = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });

      return res.json({
        success: true,
        data: toJobResponse(updatedJob),
      });
    } catch (error) {
      console.error('Update job error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update job' });
    }
  },

  // PATCH /api/jobs/:jobId/status
  updateJobStatus: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { jobId } = req.params;
      const nextStatus = readString((req.body as any)?.status, 40).toLowerCase();
      if (!ALLOWED_JOB_STATUSES.has(nextStatus)) {
        return res.status(400).json({ success: false, error: 'Invalid status' });
      }

      const db = getDB();
      const existingJob = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });
      if (!existingJob) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }

      const access = await resolveOwnerAdminCompanyAccess(String(existingJob.companyId || ''), currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const nextUpdate: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
      if (nextStatus === 'open' && !existingJob.publishedAt) {
        nextUpdate.publishedAt = new Date().toISOString();
      }
      const recommendationSource = {
        id: existingJob.id,
        title: readString(existingJob.title, 120),
        summary: readString(existingJob.summary, 240),
        description: readString(existingJob.description, 15000),
        locationText: readString(existingJob.locationText, 160),
        tags: Array.isArray(existingJob.tags) ? existingJob.tags : [],
        workModel: readString(existingJob.workModel, 40),
        salaryMin: existingJob.salaryMin,
        salaryMax: existingJob.salaryMax,
        createdAt: existingJob.createdAt,
        publishedAt:
          nextStatus === 'open'
            ? (nextUpdate.publishedAt !== undefined ? nextUpdate.publishedAt : existingJob.publishedAt)
            : null,
      };
      Object.assign(nextUpdate, buildJobRecommendationPrecomputedFields(recommendationSource));

      await db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $set: nextUpdate });
      const updatedJob = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });

      return res.json({ success: true, data: toJobResponse(updatedJob) });
    } catch (error) {
      console.error('Update job status error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update job status' });
    }
  },

  // DELETE /api/jobs/:jobId
  deleteJob: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { jobId } = req.params;
      const db = getDB();
      const existingJob = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });
      if (!existingJob) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }

      const companyId = readString(existingJob.companyId, 120);
      const access = await resolveOwnerAdminCompanyAccess(companyId, currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const announcementPostId = readString(existingJob.announcementPostId, 120);
      const postDeleteFilter: Record<string, unknown> = announcementPostId
        ? { $or: [{ id: announcementPostId }, { 'jobMeta.jobId': jobId }] }
        : { 'jobMeta.jobId': jobId };

      await Promise.all([
        db.collection(JOBS_COLLECTION).deleteOne({ id: jobId }),
        db.collection(JOB_APPLICATIONS_COLLECTION).deleteMany({ jobId }),
        db.collection(JOB_APPLICATION_NOTES_COLLECTION).deleteMany({ jobId }),
        db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).deleteMany({ jobId }),
        db.collection('posts').deleteMany(postDeleteFilter),
      ]);

      emitAuthorInsightsUpdate(req.app, companyId, 'company').catch(() => undefined);

      return res.json({
        success: true,
        data: {
          id: jobId,
          companyId,
          announcementPostId: announcementPostId || null,
        },
      });
    } catch (error) {
      console.error('Delete job error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete job' });
    }
  },

  // POST /api/jobs/:jobId/applications
  createJobApplication: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const actor = await resolveIdentityActor(
        currentUserId,
        {
          ownerType: readString((req.headers['x-identity-type'] as string | undefined) || 'user', 20),
          ownerId: readString((req.headers['x-identity-id'] as string | undefined) || currentUserId, 120),
        },
        req.headers,
      );

      if (!actor || actor.type !== 'user' || actor.id !== currentUserId) {
        return res.status(403).json({ success: false, error: 'Applications must be submitted from personal identity' });
      }

      const { jobId } = req.params;
      const db = getDB();
      const job = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });
      if (!job || job.status !== 'open') {
        return res.status(404).json({ success: false, error: 'Job not available for applications' });
      }

      const duplicate = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({
        jobId,
        applicantUserId: currentUserId,
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          error: 'You have already applied to this job',
        });
      }

      const useProfile = Boolean((req.body as any)?.useProfile);
      const profileUser = useProfile
        ? await db.collection(USERS_COLLECTION).findOne(
            { id: currentUserId },
            {
              projection: {
                firstName: 1,
                lastName: 1,
                name: 1,
                email: 1,
                defaultResumeKey: 1,
                defaultResumeFileName: 1,
                defaultResumeMimeType: 1,
                defaultResumeSize: 1,
              },
            },
          )
        : null;

      let applicantName = readString((req.body as any)?.applicantName, 120);
      let applicantEmail = readString((req.body as any)?.applicantEmail, 160).toLowerCase();
      const applicantPhone = readStringOrNull((req.body as any)?.applicantPhone, 40);
      const coverLetter = readStringOrNull((req.body as any)?.coverLetter, 5000);
      const portfolioUrl = readStringOrNull((req.body as any)?.portfolioUrl, 300);
      let resumeKey = readString((req.body as any)?.resumeKey, 500);
      let resumeFileName = readString((req.body as any)?.resumeFileName, 200);
      let resumeMimeType = readString((req.body as any)?.resumeMimeType, 120);
      let resumeSize = Number((req.body as any)?.resumeSize);

      if (profileUser) {
        const derivedProfileName =
          `${readString((profileUser as any)?.firstName, 80)} ${readString((profileUser as any)?.lastName, 80)}`.trim()
          || readString((profileUser as any)?.name, 120);
        const derivedProfileEmail = readString((profileUser as any)?.email, 160).toLowerCase();

        if (derivedProfileName) {
          applicantName = derivedProfileName;
        }
        if (derivedProfileEmail) {
          applicantEmail = derivedProfileEmail;
        }

        const defaultResumeKey = readString((profileUser as any)?.defaultResumeKey, 500);
        if (defaultResumeKey) {
          resumeKey = defaultResumeKey;
          resumeFileName = readString((profileUser as any)?.defaultResumeFileName, 200);
          resumeMimeType = readString((profileUser as any)?.defaultResumeMimeType, 120);
          resumeSize = Number((profileUser as any)?.defaultResumeSize);
        }
      }

      if (useProfile && (!resumeKey || !resumeFileName || !resumeMimeType || !Number.isFinite(resumeSize) || resumeSize <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'No default resume found on your Aura profile. Add one in your profile and retry.',
        });
      }

      if (!applicantName || !applicantEmail || !resumeKey || !resumeFileName || !resumeMimeType) {
        return res.status(400).json({
          success: false,
          error: 'applicantName, applicantEmail, resumeKey, resumeFileName and resumeMimeType are required',
        });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) {
        return res.status(400).json({ success: false, error: 'Invalid applicantEmail format' });
      }

      if (!ALLOWED_RESUME_MIME_TYPES.has(resumeMimeType)) {
        return res.status(400).json({ success: false, error: 'Unsupported resume file type' });
      }

      if (!Number.isFinite(resumeSize) || resumeSize <= 0 || resumeSize > 10 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: 'resumeSize must be between 1 byte and 10MB' });
      }

      const nowIso = new Date().toISOString();
      const nowDate = new Date(nowIso);
      const application = {
        id: `jobapp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        jobId,
        companyId: String(job.companyId || ''),
        jobTitleSnapshot: readString(job.title, 180) || null,
        applicantUserId: currentUserId,
        applicantName,
        applicantEmail,
        applicantPhone,
        coverLetter,
        portfolioUrl,
        resumeKey,
        resumeFileName,
        resumeMimeType,
        resumeSize,
        status: 'submitted',
        createdAt: nowIso,
        createdAtDate: nowDate,
        updatedAt: nowIso,
        updatedAtDate: nowDate,
        reviewedByUserId: null as string | null,
        reviewedAt: null as string | null,
        reviewedAtDate: null as Date | null,
        statusNote: null as string | null,
      };

      await db.collection(JOB_APPLICATIONS_COLLECTION).insertOne(application);
      await db.collection(JOBS_COLLECTION).updateOne(
        { id: jobId },
        { $inc: { applicationCount: 1 }, $set: { updatedAt: nowIso } },
      );
      recordJobPulseEventAsync(db, {
        jobId,
        type: 'job_applied',
        userId: currentUserId,
        createdAt: nowIso,
      });
      invalidateCompanyJobAnalyticsCache(String(job.companyId || ''));
      const applicantApplicationCount = await incrementApplicantApplicationCount(db, currentUserId, nowIso);

      scheduleJobApplicationPostCreateEffects({
        req,
        db,
        currentUserId,
        applicantApplicationCount,
        jobId,
        job,
        application,
        nowIso,
      });

      return res.status(201).json({
        success: true,
        data: toApplicationResponse(application),
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res.status(409).json({ success: false, error: 'You have already applied to this job' });
      }
      console.error('Create job application error:', error);
      return res.status(500).json({ success: false, error: 'Failed to submit application' });
    }
  },

  // GET /api/jobs/:jobId/applications
  listJobApplications: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { jobId } = req.params;
      const db = getDB();
      const job = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });
      if (!job) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }

      const access = await resolveOwnerAdminCompanyAccess(String(job.companyId || ''), currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const status = readString((req.query as any).status, 40).toLowerCase();
      if (status && !ALLOWED_APPLICATION_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: 'Invalid application status filter' });
      }

      const pagination = getPagination(req.query as Record<string, unknown>);
      const searchRegex = sanitizeSearchRegex(readString((req.query as any).q, 100));

      const filter: Record<string, unknown> = { jobId };
      if (status) filter.status = status;
      if (searchRegex) {
        filter.$or = [
          { applicantName: searchRegex },
          { applicantEmail: searchRegex },
        ];
      }

      const [items, total] = await Promise.all([
        db.collection(JOB_APPLICATIONS_COLLECTION)
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .toArray(),
        db.collection(JOB_APPLICATIONS_COLLECTION).countDocuments(filter),
      ]);

      return res.json({
        success: true,
        data: items.map(toApplicationResponse),
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages: Math.ceil(total / pagination.limit),
        },
      });
    } catch (error) {
      console.error('List job applications error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch applications' });
    }
  },

  // PATCH /api/applications/:applicationId/status
  updateJobApplicationStatus: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { applicationId } = req.params;
      const nextStatus = readString((req.body as any)?.status, 40).toLowerCase();
      const statusNote = readStringOrNull((req.body as any)?.statusNote, 1000);

      if (!ALLOWED_APPLICATION_STATUSES.has(nextStatus)) {
        return res.status(400).json({ success: false, error: 'Invalid application status' });
      }

      const db = getDB();
      const application = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      if (!application) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      const access = await resolveOwnerAdminCompanyAccess(String(application.companyId || ''), currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const nowIso = new Date().toISOString();
      const nowDate = new Date(nowIso);
      const updates = {
        status: nextStatus,
        statusNote,
        updatedAt: nowIso,
        updatedAtDate: nowDate,
        reviewedByUserId: currentUserId,
        reviewedAt: nowIso,
        reviewedAtDate: nowDate,
      };

      await db.collection(JOB_APPLICATIONS_COLLECTION).updateOne(
        { id: applicationId },
        { $set: updates },
      );
      invalidateCompanyJobAnalyticsCache(String(application.companyId || ''));

      void awardStatusDrivenBadge({
        db,
        userId: String(application.applicantUserId || ''),
        applicationId,
        nextStatus,
      }).catch((badgeError) => {
        console.error('Award status-driven badge error:', badgeError);
      });

      const updated = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      return res.json({ success: true, data: toApplicationResponse(updated) });
    } catch (error) {
      console.error('Update application status error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update application status' });
    }
  },

  // GET /api/companies/:companyId/job-analytics
  getJobAnalytics: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({ success: true, data: EMPTY_COMPANY_JOB_ANALYTICS });
      }

      const currentUserId = readString((req.user as any)?.id, 120);
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const companyId = readString(req.params.companyId, 120);
      if (!companyId) {
        return res.status(400).json({ success: false, error: 'companyId is required' });
      }

      const access = await resolveOwnerAdminCompanyAccess(companyId, currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const db = getDB();
      const data = await buildCompanyJobAnalytics(db, companyId);
      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Get company job analytics error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch company job analytics' });
    }
  },

};
