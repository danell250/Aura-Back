import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { emitAuthorInsightsUpdate } from './postsController';
import { parsePositiveInt, readString } from '../utils/inputSanitizers';
import { buildJobSkillGap } from '../services/jobSkillGapService';
import { buildCompanyJobAnalytics, EMPTY_COMPANY_JOB_ANALYTICS, invalidateCompanyJobAnalyticsCache } from '../services/companyJobAnalyticsService';
import { getPagination } from '../services/jobDiscoveryQueryService';
import { attachHeatFieldsToJobResponses, toJobResponse } from '../services/jobResponseService';
import { normalizeJobSlugValue } from '../services/jobSlugService';
import { incrementJobViewCountAsync } from '../services/jobViewBufferService';
import { createCompanyJob, updateCompanyJob, updateCompanyJobStatus } from '../services/jobWriteService';
import { attachSavedStateToJobResponses } from '../services/savedJobsService';
import {
  resolveOwnerAdminCompanyAccess,
} from '../services/jobApplicationLifecycleService';
import { buildJobHeatResponseFields, listJobPulseSnapshots } from '../services/jobPulseSnapshotService';

export const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const JOB_APPLICATION_NOTES_COLLECTION = 'application_notes';
const USERS_COLLECTION = 'users';
export const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const JOB_SKILL_GAP_TIMEOUT_MS = 180;
const CAREER_PAGE_SOURCE_SITES = new Set(['greenhouse', 'lever', 'workday', 'smartrecruiters', 'careers']);

const createTimeoutAbortSignal = (timeoutMs: number): {
  signal?: AbortSignal;
  dispose: () => void;
} => {
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
    return {
      signal: controller.signal,
      dispose: () => clearTimeout(timer),
    };
  }

  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') {
    return {
      signal: (AbortSignal as any).timeout(timeoutMs),
      dispose: () => undefined,
    };
  }

  return {
    signal: undefined,
    dispose: () => undefined,
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

  const timeoutSignal = createTimeoutAbortSignal(JOB_SKILL_GAP_TIMEOUT_MS);

  try {
    return await buildJobSkillGap({
      db: params.db,
      currentUserId,
      viewer: params.viewer,
      job: params.job,
      signal: timeoutSignal.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') return null;
    console.warn('Job skill gap analysis error:', error);
    return null;
  } finally {
    timeoutSignal.dispose();
  }
};

const attachHeatFieldsToSingleJobResponse = async (params: {
  db: any;
  job: Record<string, unknown>;
}): Promise<Record<string, unknown>> => {
  const jobsWithHeat = await attachHeatFieldsToJobResponses({
    db: params.db,
    jobs: [params.job],
  });
  return Array.isArray(jobsWithHeat) && jobsWithHeat.length > 0
    ? jobsWithHeat[0]
    : params.job;
};

const buildJobDetailResponse = async (params: {
  db: any;
  job: any;
  currentUserId: string;
  viewer: any;
}) => {
  const skillGap = params.currentUserId
    ? await resolveJobSkillGap({
        db: params.db,
        currentUserId: params.currentUserId,
        viewer: params.viewer,
        job: params.job,
      })
    : null;

  const [jobWithSavedState] = await attachSavedStateToJobResponses({
    db: params.db,
    currentUserId: params.currentUserId,
    jobs: [
      {
        ...toJobResponse(params.job),
        ...(skillGap ? { skillGap } : {}),
      },
    ],
  });

  return attachHeatFieldsToSingleJobResponse({
    db: params.db,
    job: jobWithSavedState || {
      ...toJobResponse(params.job),
      ...(skillGap ? { skillGap } : {}),
    },
  });
};

const indexPulseSnapshotsByJobId = (
  snapshots: Awaited<ReturnType<typeof listJobPulseSnapshots>>,
): Map<string, (typeof snapshots)[number]> =>
  new Map(
    snapshots
      .map((snapshot) => [readString(snapshot?.jobId, 120), snapshot] as const)
      .filter(([jobId]) => jobId.length > 0),
  );

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

  // GET /api/jobs/hot
  listHotJobs: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 6, total: 0, pages: 0 },
        });
      }

      const db = getDB();
      const limit = parsePositiveInt((req.query as any)?.limit, 6, 1, 12);
      const snapshots = await listJobPulseSnapshots({
        db,
        limit,
        sortBy: 'heat',
      });
      const hotJobIds = snapshots
        .map((snapshot) => readString(snapshot?.jobId, 120))
        .filter((jobId) => jobId.length > 0);
      if (hotJobIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit, total: 0, pages: 0 },
        });
      }

      const jobs = await db.collection(JOBS_COLLECTION)
        .find({
          id: { $in: hotJobIds },
          status: 'open',
        })
        .toArray();
      const jobsById = new Map(
        jobs.map((job: any) => [readString(job?.id, 120), job] as const).filter(([jobId]) => jobId.length > 0),
      );
      const snapshotsByJobId = indexPulseSnapshotsByJobId(snapshots);
      const data = hotJobIds
        .map((jobId) => jobsById.get(jobId))
        .filter(Boolean)
        .map((job) => ({
          ...toJobResponse(job),
          ...buildJobHeatResponseFields({ snapshot: snapshotsByJobId.get(readString(job?.id, 120)) }),
        }));

      return res.json({
        success: true,
        data,
        pagination: {
          page: 1,
          limit,
          total: data.length,
          pages: 1,
        },
      });
    } catch (error) {
      console.error('List hot jobs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch hot jobs' });
    }
  },

  // GET /api/jobs/slug/:jobSlug
  getJobBySlug: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const rawRequestedSlug = readString(req.params.jobSlug, 220).toLowerCase();
      const requestedSlug = normalizeJobSlugValue(rawRequestedSlug, 220);
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
          return res.json({
            success: true,
            data: await buildJobDetailResponse({
              db,
              job: byId,
              currentUserId,
              viewer: req.user,
            }),
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

      return res.json({
        success: true,
        data: await buildJobDetailResponse({
          db,
          job: bySlug,
          currentUserId,
          viewer: req.user,
        }),
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

      return res.json({
        success: true,
        data: await buildJobDetailResponse({
          db,
          job,
          currentUserId,
          viewer: req.user,
        }),
      });
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

      if (!requestedCompanyId) {
        return res.status(400).json({ success: false, error: 'companyId is required' });
      }

      const access = await resolveOwnerAdminCompanyAccess(requestedCompanyId, currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const db = getDB();
      const job = await createCompanyJob({
        db,
        actorId: requestedCompanyId,
        currentUserId,
        company: access.company,
        payload: (req.body as Record<string, unknown>) || {},
        io: req.app.get('io'),
        emitInsightsUpdate: () => emitAuthorInsightsUpdate(req.app, requestedCompanyId, 'company'),
      });

      return res.status(201).json({
        success: true,
        data: toJobResponse(job),
      });
    } catch (error: any) {
      if (Number.isFinite(Number(error?.statusCode)) && error?.message) {
        return res.status(Number(error.statusCode)).json({ success: false, error: String(error.message) });
      }
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

      const updatedJob = await updateCompanyJob({
        db,
        existingJob,
        payload: (req.body as Record<string, unknown>) || {},
      });

      return res.json({
        success: true,
        data: toJobResponse(updatedJob),
      });
    } catch (error: any) {
      if (Number.isFinite(Number(error?.statusCode)) && error?.message) {
        return res.status(Number(error.statusCode)).json({ success: false, error: String(error.message) });
      }
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

      const db = getDB();
      const existingJob = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });
      if (!existingJob) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }

      const access = await resolveOwnerAdminCompanyAccess(String(existingJob.companyId || ''), currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const updatedJob = await updateCompanyJobStatus({
        db,
        existingJob,
        nextStatus,
      });

      return res.json({ success: true, data: toJobResponse(updatedJob) });
    } catch (error: any) {
      if (Number.isFinite(Number(error?.statusCode)) && error?.message) {
        return res.status(Number(error.statusCode)).json({ success: false, error: String(error.message) });
      }
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
