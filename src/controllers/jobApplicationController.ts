import crypto from 'crypto';
import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { getPagination } from '../services/jobDiscoveryQueryService';
import {
  incrementApplicantApplicationCount,
  resolveOwnerAdminCompanyAccess,
  scheduleJobApplicationPostCreateEffects,
} from '../services/jobApplicationLifecycleService';
import {
  ALLOWED_APPLICATION_STATUSES,
  toApplicationResponse,
} from '../services/jobApplicationResponseService';
import { prepareJobApplicationSubmission } from '../services/jobApplicationWriteService';
import { recordJobPulseEventAsync } from '../services/jobPulseService';
import { awardStatusDrivenBadge } from '../services/userBadgeService';
import { invalidateCompanyJobAnalyticsCache } from '../services/companyJobAnalyticsService';
import { resolveIdentityActor } from '../utils/identityUtils';
import { readString, readStringOrNull } from '../utils/inputSanitizers';

const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';

const buildNormalizedPrefixRange = (raw: string): { $gte: string; $lt: string } | null => {
  const trimmed = readString(raw, 100).toLowerCase();
  if (!trimmed) return null;
  return {
    $gte: trimmed,
    $lt: `${trimmed}\uffff`,
  };
};

const EMAIL_SEARCH_TERM_PATTERN = /^[^\s@]+@[^\s@]*$/;

const resolveApplicationSearchField = (searchTerm: string): 'applicantNameNormalized' | 'applicantEmailNormalized' =>
  EMAIL_SEARCH_TERM_PATTERN.test(searchTerm)
    ? 'applicantEmailNormalized'
    : 'applicantNameNormalized';

export const jobApplicationController = {
  // POST /api/jobs/:jobId/applications
  createJobApplication: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = readString((req.user as any)?.id, 120);
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

      const jobId = readString(req.params.jobId, 120);
      if (!jobId) {
        return res.status(400).json({ success: false, error: 'jobId is required' });
      }

      const db = getDB();
      const { job, application, nowIso } = await prepareJobApplicationSubmission({
        db,
        currentUserId,
        jobId,
        payload: (req.body as Record<string, unknown>) || {},
      });

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
      if (Number.isFinite(Number(error?.statusCode)) && error?.message) {
        return res.status(Number(error.statusCode)).json({ success: false, error: String(error.message) });
      }
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
        { id: jobId },
        { projection: { companyId: 1 } },
      );
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
      const searchTerm = readString((req.query as any).q, 100).toLowerCase();
      const searchRange = buildNormalizedPrefixRange(searchTerm);

      const filter: Record<string, unknown> = { jobId };
      if (status) filter.status = status;
      if (searchRange) {
        filter[resolveApplicationSearchField(searchTerm)] = searchRange;
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

      const currentUserId = readString((req.user as any)?.id, 120);
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const applicationId = readString(req.params.applicationId, 120);
      if (!applicationId) {
        return res.status(400).json({ success: false, error: 'applicationId is required' });
      }

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
};
