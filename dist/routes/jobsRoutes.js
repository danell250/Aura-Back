"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const jobsController_1 = require("../controllers/jobsController");
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
// Public company jobs feed (v1 discovery surface)
router.get('/companies/:companyId/jobs', authMiddleware_1.optionalAuth, jobsController_1.jobsController.listCompanyJobs);
router.get('/companies/:companyId/job-applications/attention-count', authMiddleware_1.requireAuth, jobsController_1.jobsController.getCompanyApplicationAttentionCount);
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
router.get('/applications/:applicationId', authMiddleware_1.requireAuth, jobsController_1.jobsController.getJobApplicationById);
router.patch('/applications/:applicationId/status', authMiddleware_1.requireAuth, jobsController_1.jobsController.updateJobApplicationStatus);
router.get('/applications/:applicationId/resume/view-url', authMiddleware_1.requireAuth, jobsController_1.jobsController.getApplicationResumeViewUrl);
router.post('/applications/:applicationId/withdraw', authMiddleware_1.requireAuth, jobsController_1.jobsController.withdrawMyApplication);
router.post('/applications/review-portal/resolve', authMiddleware_1.requireAuth, jobsController_1.jobsController.resolveApplicationReviewPortalToken);
// Personal dashboard scope
router.get('/me/job-applications', authMiddleware_1.requireAuth, jobsController_1.jobsController.getMyJobApplications);
exports.default = router;
