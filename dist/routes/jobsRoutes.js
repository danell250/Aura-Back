"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const partnerAuth_1 = require("../middleware/partnerAuth");
const internalApiAuth_1 = require("../middleware/internalApiAuth");
const jobPulseController_1 = require("../controllers/jobPulseController");
const jobApplicationAccessController_1 = require("../controllers/jobApplicationAccessController");
const jobsController_1 = require("../controllers/jobsController");
const jobSyndicationController_1 = require("../controllers/jobSyndicationController");
const internalJobsController_1 = require("../controllers/internalJobsController");
const jobRecommendationsController_1 = require("../controllers/jobRecommendationsController");
const applicationNotesController_1 = require("../controllers/applicationNotesController");
const securityLogger_1 = require("../utils/securityLogger");
const router = (0, express_1.Router)();
const jobsWriteRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
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
const jobsApplyRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
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
const internalJobsIngestRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
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
const openJobsFeedRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
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
const jobsPulseRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
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
// Public company jobs feed (v1 discovery surface)
router.post('/internal/jobs/aggregated', internalJobsIngestRateLimiter, internalApiAuth_1.internalApiAuth, internalJobsController_1.internalJobsController.ingestAggregatedJobs);
router.get('/companies/:companyId/jobs', authMiddleware_1.optionalAuth, jobsController_1.jobsController.listCompanyJobs);
router.get('/partner/jobs', partnerAuth_1.partnerAuth, jobSyndicationController_1.jobSyndicationController.getJobsForSyndication);
router.get('/companies/:companyId/job-analytics', authMiddleware_1.requireAuth, jobsController_1.jobsController.getJobAnalytics);
router.get('/companies/:companyId/job-applications/attention-count', authMiddleware_1.requireAuth, jobApplicationAccessController_1.jobApplicationAccessController.getCompanyApplicationAttentionCount);
router.get('/jobs', authMiddleware_1.optionalAuth, jobsController_1.jobsController.listPublicJobs);
router.get('/jobs/pulse', jobsPulseRateLimiter, authMiddleware_1.optionalAuth, jobPulseController_1.jobPulseController.getJobsPulse);
router.options('/jobs/open-feed', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    return res.status(204).send();
});
router.get('/jobs/open-feed', openJobsFeedRateLimiter, jobSyndicationController_1.jobSyndicationController.getOpenJobsFeed);
router.get('/jobs/recommended', authMiddleware_1.requireAuth, jobRecommendationsController_1.jobRecommendationsController.listRecommendedJobs);
router.get('/jobs/matches/:handle', authMiddleware_1.optionalAuth, jobsController_1.jobsController.getPublicJobMatchesByHandle);
router.get('/jobs/salary-insights', authMiddleware_1.optionalAuth, jobsController_1.jobsController.getSalaryInsights);
router.get('/jobs/slug/:jobSlug', authMiddleware_1.optionalAuth, jobsController_1.jobsController.getJobBySlug);
router.get('/jobs/:jobId/network-count', authMiddleware_1.requireAuth, jobsController_1.jobsController.getJobNetworkCount);
// Public job detail
router.get('/jobs/:jobId', authMiddleware_1.optionalAuth, jobsController_1.jobsController.getJobById);
// Company owner/admin job management
router.post('/jobs', jobsWriteRateLimiter, authMiddleware_1.requireAuth, jobsController_1.jobsController.createJob);
router.put('/jobs/:jobId', jobsWriteRateLimiter, authMiddleware_1.requireAuth, jobsController_1.jobsController.updateJob);
router.patch('/jobs/:jobId/status', jobsWriteRateLimiter, authMiddleware_1.requireAuth, jobsController_1.jobsController.updateJobStatus);
router.delete('/jobs/:jobId', jobsWriteRateLimiter, authMiddleware_1.requireAuth, jobsController_1.jobsController.deleteJob);
// Applications
router.post('/jobs/:jobId/applications', jobsApplyRateLimiter, authMiddleware_1.requireAuth, jobsController_1.jobsController.createJobApplication);
router.get('/jobs/:jobId/applications', authMiddleware_1.requireAuth, jobsController_1.jobsController.listJobApplications);
router.get('/applications/:applicationId', authMiddleware_1.requireAuth, jobApplicationAccessController_1.jobApplicationAccessController.getJobApplicationById);
router.get('/applications/:applicationId/notes', authMiddleware_1.requireAuth, applicationNotesController_1.applicationNotesController.listApplicationNotes);
router.post('/applications/:applicationId/notes', authMiddleware_1.requireAuth, applicationNotesController_1.applicationNotesController.createApplicationNote);
router.patch('/applications/:applicationId/status', authMiddleware_1.requireAuth, jobsController_1.jobsController.updateJobApplicationStatus);
router.get('/applications/:applicationId/resume/view-url', authMiddleware_1.requireAuth, jobApplicationAccessController_1.jobApplicationAccessController.getApplicationResumeViewUrl);
router.post('/applications/:applicationId/withdraw', authMiddleware_1.requireAuth, jobApplicationAccessController_1.jobApplicationAccessController.withdrawMyApplication);
router.post('/applications/review-portal/resolve', authMiddleware_1.requireAuth, jobApplicationAccessController_1.jobApplicationAccessController.resolveApplicationReviewPortalToken);
// Personal dashboard scope
router.get('/me/job-applications', authMiddleware_1.requireAuth, jobApplicationAccessController_1.jobApplicationAccessController.getMyJobApplications);
exports.default = router;
