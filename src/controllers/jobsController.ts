import { Request, Response } from 'express';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import { getDB, isDBConnected } from '../db';
import { resolveIdentityActor } from '../utils/identityUtils';
import { emitAuthorInsightsUpdate } from './postsController';
import { getHashtagsFromText } from '../utils/hashtagUtils';

const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const COMPANIES_COLLECTION = 'companies';
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

type CompanyAdminAccessResult = {
  allowed: boolean;
  status: number;
  error?: string;
  company?: any;
};

type Pagination = {
  page: number;
  limit: number;
  skip: number;
};

const readString = (value: unknown, maxLength = 10000): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

const readStringOrNull = (value: unknown, maxLength = 10000): string | null => {
  const normalized = readString(value, maxLength);
  return normalized.length > 0 ? normalized : null;
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

const parsePositiveInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

const getPagination = (query: Record<string, unknown>): Pagination => {
  const page = parsePositiveInt(query.page, 1, 1, 100000);
  const limit = parsePositiveInt(query.limit, 20, 1, 100);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const parseIsoOrNull = (value: unknown): string | null => {
  if (value == null) return null;
  const asString = readString(String(value), 100);
  if (!asString) return null;
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const sanitizeSearchRegex = (raw: string): RegExp | null => {
  const trimmed = readString(raw, 100);
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
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

const resolveOwnerAdminCompanyAccess = async (
  companyId: string,
  authenticatedUserId: string,
): Promise<CompanyAdminAccessResult> => {
  const db = getDB();
  const company = await db.collection(COMPANIES_COLLECTION).findOne({
    id: companyId,
    legacyArchived: { $ne: true },
  });

  if (!company) {
    return { allowed: false, status: 404, error: 'Company not found' };
  }

  if (company.ownerId === authenticatedUserId) {
    return { allowed: true, status: 200, company };
  }

  const membership = await db.collection(COMPANY_MEMBERS_COLLECTION).findOne({
    companyId,
    userId: authenticatedUserId,
    role: { $in: ['owner', 'admin'] },
  });

  if (!membership) {
    return { allowed: false, status: 403, error: 'Only company owner/admin can perform this action' };
  }

  return { allowed: true, status: 200, company };
};

const canReadApplication = async (
  application: any,
  authenticatedUserId: string,
): Promise<boolean> => {
  if (!application) return false;
  if (application.applicantUserId === authenticatedUserId) return true;
  const access = await resolveOwnerAdminCompanyAccess(String(application.companyId || ''), authenticatedUserId);
  return access.allowed;
};

const toJobResponse = (job: any) => ({
  id: String(job?.id || ''),
  companyId: String(job?.companyId || ''),
  companyName: String(job?.companyName || ''),
  companyHandle: String(job?.companyHandle || ''),
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
  updatedAt: job?.updatedAt || null,
  publishedAt: job?.publishedAt || null,
  announcementPostId: job?.announcementPostId || null,
  applicationCount: Number.isFinite(job?.applicationCount) ? Number(job.applicationCount) : 0,
});

const toApplicationResponse = (application: any) => ({
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

let s3Client: S3Client | null = null;

const getS3Client = (): S3Client | null => {
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) return null;
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Client;
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

  // GET /api/jobs/:jobId
  getJobById: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const { jobId } = req.params;
      const db = getDB();
      const job = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });

      if (!job || job.status === 'archived') {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }

      return res.json({ success: true, data: toJobResponse(job) });
    } catch (error) {
      console.error('Get job error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch job' });
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

      const nowIso = new Date().toISOString();
      const job = {
        id: `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        companyId: actor.id,
        companyName: readString(access.company?.name, 120) || 'Company',
        companyHandle: readString(access.company?.handle, 80),
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
        tags,
        createdByUserId: currentUserId,
        createdAt: nowIso,
        updatedAt: nowIso,
        publishedAt: nowIso,
        announcementPostId: null as string | null,
        applicationCount: 0,
      };

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

      await db.collection(JOBS_COLLECTION).insertOne(job);

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

      if ((req.body as any).tags !== undefined) {
        updates.tags = readStringList((req.body as any).tags, 10, 40);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
      }

      updates.updatedAt = new Date().toISOString();

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

      await db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $set: nextUpdate });
      const updatedJob = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });

      return res.json({ success: true, data: toJobResponse(updatedJob) });
    } catch (error) {
      console.error('Update job status error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update job status' });
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

      const applicantName = readString((req.body as any)?.applicantName, 120);
      const applicantEmail = readString((req.body as any)?.applicantEmail, 160).toLowerCase();
      const applicantPhone = readStringOrNull((req.body as any)?.applicantPhone, 40);
      const coverLetter = readStringOrNull((req.body as any)?.coverLetter, 5000);
      const portfolioUrl = readStringOrNull((req.body as any)?.portfolioUrl, 300);
      const resumeKey = readString((req.body as any)?.resumeKey, 500);
      const resumeFileName = readString((req.body as any)?.resumeFileName, 200);
      const resumeMimeType = readString((req.body as any)?.resumeMimeType, 120);
      const resumeSize = Number((req.body as any)?.resumeSize);

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
      const application = {
        id: `jobapp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        jobId,
        companyId: String(job.companyId || ''),
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
        updatedAt: nowIso,
        reviewedByUserId: null as string | null,
        reviewedAt: null as string | null,
        statusNote: null as string | null,
      };

      await db.collection(JOB_APPLICATIONS_COLLECTION).insertOne(application);
      await db.collection(JOBS_COLLECTION).updateOne(
        { id: jobId },
        { $inc: { applicationCount: 1 }, $set: { updatedAt: nowIso } },
      );

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

  // GET /api/applications/:applicationId
  getJobApplicationById: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { applicationId } = req.params;
      const db = getDB();
      const application = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      if (!application) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      const allowed = await canReadApplication(application, currentUserId);
      if (!allowed) {
        return res.status(403).json({ success: false, error: 'Unauthorized to view this application' });
      }

      return res.json({ success: true, data: toApplicationResponse(application) });
    } catch (error) {
      console.error('Get job application error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch application' });
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

      if (!ALLOWED_APPLICATION_STATUSES.has(nextStatus) || nextStatus === 'withdrawn') {
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
      const updates = {
        status: nextStatus,
        statusNote,
        updatedAt: nowIso,
        reviewedByUserId: currentUserId,
        reviewedAt: nowIso,
      };

      await db.collection(JOB_APPLICATIONS_COLLECTION).updateOne(
        { id: applicationId },
        { $set: updates },
      );

      const updated = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      return res.json({ success: true, data: toApplicationResponse(updated) });
    } catch (error) {
      console.error('Update application status error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update application status' });
    }
  },

  // GET /api/applications/:applicationId/resume/view-url
  getApplicationResumeViewUrl: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { applicationId } = req.params;
      const db = getDB();
      const application = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      if (!application) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      const allowed = await canReadApplication(application, currentUserId);
      if (!allowed) {
        return res.status(403).json({ success: false, error: 'Unauthorized to access this resume' });
      }

      const resumeKey = readString(application.resumeKey, 500);
      if (!resumeKey) {
        return res.status(404).json({ success: false, error: 'Resume key not available for this application' });
      }

      const bucketName = process.env.S3_BUCKET_NAME;
      const client = getS3Client();
      if (!bucketName || !client) {
        return res.status(503).json({
          success: false,
          error: 'Resume preview service is not configured',
        });
      }

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: resumeKey,
      });
      const url = await getSignedUrl(client, command, { expiresIn: 600 });

      return res.json({
        success: true,
        data: {
          url,
          expiresIn: 600,
        },
      });
    } catch (error) {
      console.error('Get resume view URL error:', error);
      return res.status(500).json({ success: false, error: 'Failed to generate resume view URL' });
    }
  },

  // GET /api/me/job-applications
  getMyJobApplications: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 20, total: 0, pages: 0 },
        });
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
        return res.status(403).json({ success: false, error: 'This endpoint is only available for personal identity' });
      }

      const pagination = getPagination(req.query as Record<string, unknown>);
      const status = readString((req.query as any).status, 40).toLowerCase();
      if (status && !ALLOWED_APPLICATION_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: 'Invalid application status filter' });
      }

      const db = getDB();
      const filter: Record<string, unknown> = {
        applicantUserId: currentUserId,
      };
      if (status) filter.status = status;

      const [items, total] = await Promise.all([
        db.collection(JOB_APPLICATIONS_COLLECTION)
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .toArray(),
        db.collection(JOB_APPLICATIONS_COLLECTION).countDocuments(filter),
      ]);

      const jobIds = Array.from(
        new Set(
          items
            .map((item: any) => String(item?.jobId || '').trim())
            .filter((id: string) => id.length > 0),
        ),
      );
      const jobs = await db.collection(JOBS_COLLECTION).find({ id: { $in: jobIds } }).toArray();
      const jobsById = new Map<string, any>(jobs.map((job: any) => [String(job.id), job]));

      const companyIds = Array.from(
        new Set(
          jobs
            .map((job: any) => String(job?.companyId || '').trim())
            .filter((id: string) => id.length > 0),
        ),
      );
      const companies = await db.collection(COMPANIES_COLLECTION)
        .find({ id: { $in: companyIds }, legacyArchived: { $ne: true } })
        .project({ id: 1, name: 1, handle: 1, avatar: 1, avatarType: 1 })
        .toArray();
      const companiesById = new Map<string, any>(companies.map((company: any) => [String(company.id), company]));

      const data = items.map((application: any) => {
        const job = jobsById.get(String(application.jobId || ''));
        const company = companiesById.get(String(job?.companyId || ''));
        return {
          ...toApplicationResponse(application),
          job: job ? toJobResponse(job) : null,
          company: company
            ? {
                id: String(company.id || ''),
                name: String(company.name || ''),
                handle: String(company.handle || ''),
                avatar: String(company.avatar || ''),
                avatarType: String(company.avatarType || 'image'),
              }
            : null,
        };
      });

      return res.json({
        success: true,
        data,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages: Math.ceil(total / pagination.limit),
        },
      });
    } catch (error) {
      console.error('Get my job applications error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch your applications' });
    }
  },

  // POST /api/applications/:applicationId/withdraw
  withdrawMyApplication: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { applicationId } = req.params;
      const db = getDB();
      const application = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      if (!application) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      if (String(application.applicantUserId || '') !== currentUserId) {
        return res.status(403).json({ success: false, error: 'Only the applicant can withdraw this application' });
      }

      const nowIso = new Date().toISOString();
      await db.collection(JOB_APPLICATIONS_COLLECTION).updateOne(
        { id: applicationId },
        {
          $set: {
            status: 'withdrawn',
            updatedAt: nowIso,
            statusNote: readStringOrNull((req.body as any)?.statusNote, 1000),
          },
        },
      );

      const updated = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      return res.json({ success: true, data: toApplicationResponse(updated) });
    } catch (error) {
      console.error('Withdraw application error:', error);
      return res.status(500).json({ success: false, error: 'Failed to withdraw application' });
    }
  },
};
