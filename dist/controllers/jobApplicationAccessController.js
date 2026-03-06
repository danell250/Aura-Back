"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobApplicationAccessController = void 0;
const db_1 = require("../db");
const jobApplicationResponseService_1 = require("../services/jobApplicationResponseService");
const jobDiscoveryQueryService_1 = require("../services/jobDiscoveryQueryService");
const jobApplicationListService_1 = require("../services/jobApplicationListService");
const jobApplicationLifecycleService_1 = require("../services/jobApplicationLifecycleService");
const jobResumeStorageService_1 = require("../services/jobResumeStorageService");
const companyJobAnalyticsService_1 = require("../services/companyJobAnalyticsService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const identityUtils_1 = require("../utils/identityUtils");
const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const WITHDRAWABLE_APPLICATION_STATUSES = new Set(['submitted', 'in_review']);
exports.jobApplicationAccessController = {
    // GET /api/applications/:applicationId
    getJobApplicationById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { applicationId } = req.params;
            const db = (0, db_1.getDB)();
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            if (String(application.applicantUserId || '') === currentUserId) {
                return res.json({ success: true, data: (0, jobApplicationResponseService_1.toApplicationResponse)(application) });
            }
            const companyId = (0, inputSanitizers_1.readString)(application === null || application === void 0 ? void 0 : application.companyId, 120);
            if (!companyId) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(companyId, currentUserId);
            if (!access.allowed) {
                return res.status(403).json({ success: false, error: access.error || 'Unauthorized' });
            }
            return res.json({ success: true, data: (0, jobApplicationResponseService_1.toApplicationResponse)(application) });
        }
        catch (error) {
            console.error('Get job application error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch application' });
        }
    }),
    // GET /api/applications/:applicationId/resume/view-url
    getApplicationResumeViewUrl: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { applicationId } = req.params;
            const db = (0, db_1.getDB)();
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            const allowed = yield (0, jobApplicationLifecycleService_1.canReadJobApplication)(application, currentUserId);
            if (!allowed) {
                return res.status(403).json({ success: false, error: 'Unauthorized to access this resume' });
            }
            const resumeKey = (0, inputSanitizers_1.readString)(application.resumeKey, 500);
            if (!resumeKey) {
                return res.status(404).json({ success: false, error: 'Resume key not available for this application' });
            }
            const expiresInSeconds = 600;
            const url = yield (0, jobResumeStorageService_1.getApplicationResumeSignedUrl)(resumeKey, expiresInSeconds);
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
        }
        catch (error) {
            console.error('Get resume view URL error:', error);
            return res.status(500).json({ success: false, error: 'Failed to generate resume view URL' });
        }
    }),
    // POST /api/applications/review-portal/resolve
    resolveApplicationReviewPortalToken: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const token = (0, inputSanitizers_1.readString)((_b = req.body) === null || _b === void 0 ? void 0 : _b.token, 400);
            if (!token) {
                return res.status(400).json({ success: false, error: 'Review token is required' });
            }
            const db = (0, db_1.getDB)();
            const link = yield db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).findOne({
                tokenHash: (0, jobApplicationResponseService_1.hashSecureToken)(token),
            });
            if (!link) {
                return res.status(404).json({ success: false, error: 'Invalid review link' });
            }
            const expiresAtTs = new Date(link.expiresAt || '').getTime();
            if (!Number.isFinite(expiresAtTs) || expiresAtTs < Date.now()) {
                return res.status(410).json({ success: false, error: 'This review link has expired' });
            }
            const applicationId = (0, inputSanitizers_1.readString)(link.applicationId, 120);
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application for this review link was not found' });
            }
            const recipientUserId = (0, inputSanitizers_1.readString)(link === null || link === void 0 ? void 0 : link.recipientUserId, 120);
            if (recipientUserId && recipientUserId !== currentUserId) {
                return res.status(403).json({ success: false, error: 'This review link is not assigned to your account' });
            }
            const companyId = (0, inputSanitizers_1.readString)(application.companyId, 120);
            const linkedCompanyId = (0, inputSanitizers_1.readString)(link.companyId, 120);
            if (!companyId || (linkedCompanyId && linkedCompanyId !== companyId)) {
                return res.status(403).json({ success: false, error: 'This review link is no longer valid' });
            }
            const jobId = (0, inputSanitizers_1.readString)(application.jobId, 120);
            const linkedJobId = (0, inputSanitizers_1.readString)(link.jobId, 120);
            if (!jobId || (linkedJobId && linkedJobId !== jobId)) {
                return res.status(403).json({ success: false, error: 'This review link is no longer valid' });
            }
            const [access, job] = yield Promise.all([
                (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(companyId, currentUserId),
                db.collection(JOBS_COLLECTION).findOne({ id: jobId }),
            ]);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const nowIso = new Date().toISOString();
            yield db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).updateOne({ id: String(link.id || '') }, {
                $set: {
                    lastResolvedAt: nowIso,
                    lastResolvedByUserId: currentUserId,
                },
            });
            return res.json({
                success: true,
                data: {
                    companyId,
                    jobId,
                    applicationId,
                    jobTitle: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 160),
                    applicantName: (0, inputSanitizers_1.readString)(application === null || application === void 0 ? void 0 : application.applicantName, 160),
                    status: (0, inputSanitizers_1.readString)(application === null || application === void 0 ? void 0 : application.status, 40),
                    expiresAt: (0, inputSanitizers_1.readString)(link === null || link === void 0 ? void 0 : link.expiresAt, 80) || null,
                    portal: {
                        view: 'profile',
                        targetId: companyId,
                        tab: 'jobs',
                    },
                },
            });
        }
        catch (error) {
            console.error('Resolve application review portal token error:', error);
            return res.status(500).json({ success: false, error: 'Failed to resolve review link' });
        }
    }),
    // GET /api/companies/:companyId/job-applications/attention-count
    getCompanyApplicationAttentionCount: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: {
                        pendingReviewCount: 0,
                        activePipelineCount: 0,
                        totalOpenJobs: 0,
                    },
                });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const companyId = (0, inputSanitizers_1.readString)(req.params.companyId, 120);
            if (!companyId) {
                return res.status(400).json({ success: false, error: 'companyId is required' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(companyId, currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const db = (0, db_1.getDB)();
            const [pendingReviewCount, activePipelineCount, totalOpenJobs] = yield Promise.all([
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
        }
        catch (error) {
            console.error('Get company application attention count error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch application attention count' });
        }
    }),
    // GET /api/me/job-applications
    getMyJobApplications: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit: 20, total: 0, pages: 0 },
                });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUserId, {
                ownerType: (0, inputSanitizers_1.readString)(req.headers['x-identity-type'] || 'user', 20),
                ownerId: (0, inputSanitizers_1.readString)(req.headers['x-identity-id'] || currentUserId, 120),
            }, req.headers);
            if (!actor || actor.type !== 'user' || actor.id !== currentUserId) {
                return res.status(403).json({ success: false, error: 'This endpoint is only available for personal identity' });
            }
            const pagination = (0, jobDiscoveryQueryService_1.getPagination)(req.query);
            const status = (0, inputSanitizers_1.readString)(req.query.status, 40).toLowerCase();
            if (status && !jobApplicationResponseService_1.ALLOWED_APPLICATION_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid application status filter' });
            }
            const db = (0, db_1.getDB)();
            const { items, total } = yield (0, jobApplicationListService_1.listApplicantJobApplications)({
                db,
                applicantUserId: currentUserId,
                status: status || undefined,
                skip: pagination.skip,
                limit: pagination.limit,
            });
            return res.json({
                success: true,
                data: items,
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total,
                    pages: Math.ceil(total / pagination.limit),
                },
            });
        }
        catch (error) {
            console.error('Get my job applications error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch your applications' });
        }
    }),
    // POST /api/applications/:applicationId/withdraw
    withdrawMyApplication: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { applicationId } = req.params;
            const db = (0, db_1.getDB)();
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            if (String(application.applicantUserId || '') !== currentUserId) {
                return res.status(403).json({ success: false, error: 'Only the applicant can withdraw this application' });
            }
            const currentStatus = (0, inputSanitizers_1.readString)(application.status, 40).toLowerCase();
            if (!WITHDRAWABLE_APPLICATION_STATUSES.has(currentStatus)) {
                return res.status(409).json({
                    success: false,
                    error: 'This application can no longer be withdrawn',
                });
            }
            const jobId = (0, inputSanitizers_1.readString)(application.jobId, 120);
            const companyId = (0, inputSanitizers_1.readString)(application.companyId, 120);
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId }, { projection: { companyId: 1, status: 1 } });
            if (!job) {
                return res.status(404).json({ success: false, error: 'Job not found for this application' });
            }
            if ((0, inputSanitizers_1.readString)(job.companyId, 120) !== companyId) {
                return res.status(403).json({ success: false, error: 'Application company context is invalid' });
            }
            if ((0, inputSanitizers_1.readString)(job.status, 40).toLowerCase() === 'archived') {
                return res.status(409).json({ success: false, error: 'This application can no longer be withdrawn' });
            }
            const nowIso = new Date().toISOString();
            const nowDate = new Date(nowIso);
            const updateResult = yield db.collection(JOB_APPLICATIONS_COLLECTION).updateOne({
                id: applicationId,
                applicantUserId: currentUserId,
                status: { $in: Array.from(WITHDRAWABLE_APPLICATION_STATUSES) },
            }, {
                $set: {
                    status: 'withdrawn',
                    updatedAt: nowIso,
                    updatedAtDate: nowDate,
                    statusNote: (0, inputSanitizers_1.readStringOrNull)((_b = req.body) === null || _b === void 0 ? void 0 : _b.statusNote, 1000),
                },
            });
            if (!updateResult.matchedCount) {
                return res.status(409).json({
                    success: false,
                    error: 'This application can no longer be withdrawn',
                });
            }
            (0, companyJobAnalyticsService_1.invalidateCompanyJobAnalyticsCache)(companyId);
            const updated = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            return res.json({ success: true, data: (0, jobApplicationResponseService_1.toApplicationResponse)(updated) });
        }
        catch (error) {
            console.error('Withdraw application error:', error);
            return res.status(500).json({ success: false, error: 'Failed to withdraw application' });
        }
    }),
};
