import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, optionalAuth } from '../middleware/authMiddleware';
import { jobsController } from '../controllers/jobsController';
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

// Public company jobs feed (v1 discovery surface)
router.get('/companies/:companyId/jobs', optionalAuth, jobsController.listCompanyJobs);
router.get('/companies/:companyId/job-applications/attention-count', requireAuth, jobsController.getCompanyApplicationAttentionCount);

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
router.get('/applications/:applicationId', requireAuth, jobsController.getJobApplicationById);
router.patch('/applications/:applicationId/status', requireAuth, jobsController.updateJobApplicationStatus);
router.get('/applications/:applicationId/resume/view-url', requireAuth, jobsController.getApplicationResumeViewUrl);
router.post('/applications/:applicationId/withdraw', requireAuth, jobsController.withdrawMyApplication);
router.post('/applications/review-portal/resolve', requireAuth, jobsController.resolveApplicationReviewPortalToken);

// Personal dashboard scope
router.get('/me/job-applications', requireAuth, jobsController.getMyJobApplications);

export default router;
