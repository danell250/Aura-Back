import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import {
  getPagination,
  hashSecureToken,
  toApplicationResponse,
  toJobResponse,
} from './jobsController';
import {
  canReadJobApplication,
  resolveOwnerAdminCompanyAccess,
} from '../services/jobApplicationLifecycleService';
import { getApplicationResumeSignedUrl } from '../services/jobResumeStorageService';
import { invalidateCompanyJobAnalyticsCache } from '../services/companyJobAnalyticsService';
import { readString, readStringOrNull } from '../utils/inputSanitizers';
import { resolveIdentityActor } from '../utils/identityUtils';

const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const COMPANIES_COLLECTION = 'companies';
const ALLOWED_APPLICATION_STATUSES = new Set(['submitted', 'in_review', 'shortlisted', 'rejected', 'hired', 'withdrawn']);

export const jobApplicationAccessController = {
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
      const applicantApplication = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({
        id: applicationId,
        applicantUserId: currentUserId,
      });
      if (applicantApplication) {
        return res.json({ success: true, data: toApplicationResponse(applicantApplication) });
      }

      const companyProbe = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne(
        { id: applicationId },
        { projection: { companyId: 1 } },
      );
      const companyId = readString(companyProbe?.companyId, 120);
      if (!companyId) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      const access = await resolveOwnerAdminCompanyAccess(companyId, currentUserId);
      if (!access.allowed) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      const application = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({
        id: applicationId,
        companyId,
      });
      if (!application) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      return res.json({ success: true, data: toApplicationResponse(application) });
    } catch (error) {
      console.error('Get job application error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch application' });
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

      const allowed = await canReadJobApplication(application, currentUserId);
      if (!allowed) {
        return res.status(403).json({ success: false, error: 'Unauthorized to access this resume' });
      }

      const resumeKey = readString(application.resumeKey, 500);
      if (!resumeKey) {
        return res.status(404).json({ success: false, error: 'Resume key not available for this application' });
      }

      const expiresInSeconds = 600;
      const url = await getApplicationResumeSignedUrl(resumeKey, expiresInSeconds);
      if (!url) {
        return res.status(503).json({
          success: false,
          error: 'Resume preview service is not configured',
        });
      }

      return res.json({
        success: true,
        data: {
          url,
          expiresIn: expiresInSeconds,
        },
      });
    } catch (error) {
      console.error('Get resume view URL error:', error);
      return res.status(500).json({ success: false, error: 'Failed to generate resume view URL' });
    }
  },

  // POST /api/applications/review-portal/resolve
  resolveApplicationReviewPortalToken: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const token = readString((req.body as any)?.token, 400);
      if (!token) {
        return res.status(400).json({ success: false, error: 'Review token is required' });
      }

      const db = getDB();
      const link = await db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).findOne({
        tokenHash: hashSecureToken(token),
      });

      if (!link) {
        return res.status(404).json({ success: false, error: 'Invalid review link' });
      }

      const expiresAtTs = new Date(link.expiresAt || '').getTime();
      if (!Number.isFinite(expiresAtTs) || expiresAtTs < Date.now()) {
        return res.status(410).json({ success: false, error: 'This review link has expired' });
      }

      const applicationId = readString(link.applicationId, 120);
      const application = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      if (!application) {
        return res.status(404).json({ success: false, error: 'Application for this review link was not found' });
      }

      const companyId = readString(application.companyId, 120);
      const linkedCompanyId = readString(link.companyId, 120);
      if (!companyId || (linkedCompanyId && linkedCompanyId !== companyId)) {
        return res.status(403).json({ success: false, error: 'This review link is no longer valid' });
      }
      const access = await resolveOwnerAdminCompanyAccess(companyId, currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const jobId = readString(application.jobId, 120);
      const linkedJobId = readString(link.jobId, 120);
      if (!jobId || (linkedJobId && linkedJobId !== jobId)) {
        return res.status(403).json({ success: false, error: 'This review link is no longer valid' });
      }
      const job = await db.collection(JOBS_COLLECTION).findOne({ id: jobId });

      const nowIso = new Date().toISOString();
      await db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).updateOne(
        { id: String(link.id || '') },
        {
          $set: {
            lastResolvedAt: nowIso,
            lastResolvedByUserId: currentUserId,
          },
        },
      );

      return res.json({
        success: true,
        data: {
          companyId,
          jobId,
          applicationId,
          jobTitle: readString(job?.title, 160),
          applicantName: readString(application?.applicantName, 160),
          status: readString(application?.status, 40),
          expiresAt: readString(link?.expiresAt, 80) || null,
          portal: {
            view: 'profile',
            targetId: companyId,
            tab: 'jobs',
          },
        },
      });
    } catch (error) {
      console.error('Resolve application review portal token error:', error);
      return res.status(500).json({ success: false, error: 'Failed to resolve review link' });
    }
  },

  // GET /api/companies/:companyId/job-applications/attention-count
  getCompanyApplicationAttentionCount: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: {
            pendingReviewCount: 0,
            activePipelineCount: 0,
            totalOpenJobs: 0,
          },
        });
      }

      const currentUserId = (req.user as any)?.id;
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
      const [pendingReviewCount, activePipelineCount, totalOpenJobs] = await Promise.all([
        db.collection(JOB_APPLICATIONS_COLLECTION).countDocuments({
          companyId,
          status: 'submitted',
        }),
        db.collection(JOB_APPLICATIONS_COLLECTION).countDocuments({
          companyId,
          status: { $in: ['in_review', 'shortlisted'] },
        }),
        db.collection(JOBS_COLLECTION).countDocuments({
          companyId,
          status: 'open',
        }),
      ]);

      return res.json({
        success: true,
        data: {
          pendingReviewCount,
          activePipelineCount,
          totalOpenJobs,
        },
      });
    } catch (error) {
      console.error('Get company application attention count error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch application attention count' });
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
      const nowDate = new Date(nowIso);
      await db.collection(JOB_APPLICATIONS_COLLECTION).updateOne(
        { id: applicationId },
        {
          $set: {
            status: 'withdrawn',
            updatedAt: nowIso,
            updatedAtDate: nowDate,
            statusNote: readStringOrNull((req.body as any)?.statusNote, 1000),
          },
        },
      );
      invalidateCompanyJobAnalyticsCache(String(application.companyId || ''));

      const updated = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
      return res.json({ success: true, data: toApplicationResponse(updated) });
    } catch (error) {
      console.error('Withdraw application error:', error);
      return res.status(500).json({ success: false, error: 'Failed to withdraw application' });
    }
  },
};
