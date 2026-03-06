import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, optionalAuth } from '../middleware/authMiddleware';
import { partnerAuth } from '../middleware/partnerAuth';
import { internalApiAuth } from '../middleware/internalApiAuth';
import { jobPulseController } from '../controllers/jobPulseController';
import { jobApplicationAccessController } from '../controllers/jobApplicationAccessController';
import { jobsController } from '../controllers/jobsController';
import { jobSyndicationController } from '../controllers/jobSyndicationController';
import { internalJobsController } from '../controllers/internalJobsController';
import { jobRecommendationsController } from '../controllers/jobRecommendationsController';
import { applicationNotesController } from '../controllers/applicationNotesController';
import { logSecurityEvent } from '../utils/securityLogger';

const router = Router();

const jobsWriteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/jobs',
      metadata: {
        key: 'jobs_write',
        max: 20,
        windowMs: 60 * 1000,
      },
    });

    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many job write actions, please slow down',
    });
  },
});

const jobsApplyRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/jobs/:jobId/applications',
      metadata: {
        key: 'jobs_apply_hourly',
        max: 5,
        windowMs: 60 * 60 * 1000,
      },
    });

    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many job applications submitted. Please try again later.',
    });
  },
});

const internalJobsIngestRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/internal/jobs/aggregated',
      metadata: {
        key: 'internal_jobs_ingest',
        max: 30,
        windowMs: 60 * 1000,
      },
    });

    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many internal jobs ingestion requests. Please slow down.',
    });
  },
});

const openJobsFeedRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/jobs/open-feed',
      metadata: {
        key: 'jobs_open_feed_read',
        max: 120,
        windowMs: 60 * 1000,
      },
    });

    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many open feed requests. Please retry shortly.',
    });
  },
});

const jobsPulseRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/jobs/pulse',
      metadata: {
        key: 'jobs_pulse_read',
        max: 180,
        windowMs: 60 * 1000,
      },
    });

    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many jobs pulse requests. Please retry shortly.',
    });
  },
});

const jobsPreviewRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/jobs/for-you',
      metadata: {
        key: 'jobs_for_you_read',
        max: 120,
        windowMs: 60 * 1000,
      },
    });

    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many preview recommendation requests. Please retry shortly.',
    });
  },
});

// Public company jobs feed (v1 discovery surface)
router.post('/internal/jobs/aggregated', internalJobsIngestRateLimiter, internalApiAuth, internalJobsController.ingestAggregatedJobs);
router.get('/companies/:companyId/jobs', optionalAuth, jobsController.listCompanyJobs);
router.get('/partner/jobs', partnerAuth, jobSyndicationController.getJobsForSyndication);
router.get('/companies/:companyId/job-analytics', requireAuth, jobsController.getJobAnalytics);
router.get('/companies/:companyId/job-applications/attention-count', requireAuth, jobApplicationAccessController.getCompanyApplicationAttentionCount);
router.get('/jobs', optionalAuth, jobsController.listPublicJobs);
router.get('/jobs/hot', jobsPulseRateLimiter, optionalAuth, jobsController.listHotJobs);
router.get('/jobs/for-you', jobsPreviewRateLimiter, optionalAuth, jobRecommendationsController.listPreviewJobs);
router.get('/jobs/pulse', jobsPulseRateLimiter, optionalAuth, jobPulseController.getJobsPulse);
router.options('/jobs/open-feed', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  return res.status(204).send();
});
router.get('/jobs/open-feed', openJobsFeedRateLimiter, jobSyndicationController.getOpenJobsFeed);
router.get('/jobs/recommended', requireAuth, jobRecommendationsController.listRecommendedJobs);
router.get('/jobs/matches/:handle', optionalAuth, jobsController.getPublicJobMatchesByHandle);
router.get('/jobs/salary-insights', optionalAuth, jobsController.getSalaryInsights);
router.get('/jobs/slug/:jobSlug', optionalAuth, jobsController.getJobBySlug);
router.get('/jobs/:jobId/network-count', requireAuth, jobsController.getJobNetworkCount);

// Public job detail
router.get('/jobs/:jobId', optionalAuth, jobsController.getJobById);

// Company owner/admin job management
router.post('/jobs', jobsWriteRateLimiter, requireAuth, jobsController.createJob);
router.put('/jobs/:jobId', jobsWriteRateLimiter, requireAuth, jobsController.updateJob);
router.patch('/jobs/:jobId/status', jobsWriteRateLimiter, requireAuth, jobsController.updateJobStatus);
router.delete('/jobs/:jobId', jobsWriteRateLimiter, requireAuth, jobsController.deleteJob);

// Applications
router.post('/jobs/:jobId/applications', jobsApplyRateLimiter, requireAuth, jobsController.createJobApplication);
router.get('/jobs/:jobId/applications', requireAuth, jobsController.listJobApplications);
router.get('/applications/:applicationId', requireAuth, jobApplicationAccessController.getJobApplicationById);
router.get('/applications/:applicationId/notes', requireAuth, applicationNotesController.listApplicationNotes);
router.post('/applications/:applicationId/notes', requireAuth, applicationNotesController.createApplicationNote);
router.patch('/applications/:applicationId/status', requireAuth, jobsController.updateJobApplicationStatus);
router.get('/applications/:applicationId/resume/view-url', requireAuth, jobApplicationAccessController.getApplicationResumeViewUrl);
router.post('/applications/:applicationId/withdraw', requireAuth, jobApplicationAccessController.withdrawMyApplication);
router.post('/applications/review-portal/resolve', requireAuth, jobApplicationAccessController.resolveApplicationReviewPortalToken);

// Personal dashboard scope
router.get('/me/job-applications', requireAuth, jobApplicationAccessController.getMyJobApplications);

export default router;
