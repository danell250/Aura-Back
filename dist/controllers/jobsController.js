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
exports.jobsController = exports.ALLOWED_JOB_STATUSES = exports.JOBS_COLLECTION = void 0;
const db_1 = require("../db");
const postsController_1 = require("./postsController");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobSkillGapService_1 = require("../services/jobSkillGapService");
const companyJobAnalyticsService_1 = require("../services/companyJobAnalyticsService");
const jobDiscoveryQueryService_1 = require("../services/jobDiscoveryQueryService");
const jobResponseService_1 = require("../services/jobResponseService");
const jobSlugService_1 = require("../services/jobSlugService");
const jobViewBufferService_1 = require("../services/jobViewBufferService");
const jobWriteService_1 = require("../services/jobWriteService");
const jobApplicationViewerStateService_1 = require("../services/jobApplicationViewerStateService");
const savedJobsService_1 = require("../services/savedJobsService");
const jobApplicationLifecycleService_1 = require("../services/jobApplicationLifecycleService");
const jobPulseSnapshotService_1 = require("../services/jobPulseSnapshotService");
exports.JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const JOB_APPLICATION_NOTES_COLLECTION = 'application_notes';
const USERS_COLLECTION = 'users';
exports.ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const JOB_SKILL_GAP_TIMEOUT_MS = 180;
const CAREER_PAGE_SOURCE_SITES = new Set(['greenhouse', 'lever', 'workday', 'smartrecruiters', 'careers']);
const createTimeoutAbortSignal = (timeoutMs) => {
    if (typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, timeoutMs);
        if (typeof (timer === null || timer === void 0 ? void 0 : timer.unref) === 'function') {
            timer.unref();
        }
        return {
            signal: controller.signal,
            dispose: () => clearTimeout(timer),
        };
    }
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return {
            signal: AbortSignal.timeout(timeoutMs),
            dispose: () => undefined,
        };
    }
    return {
        signal: undefined,
        dispose: () => undefined,
    };
};
const resolveJobSkillGap = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    if (!currentUserId)
        return null;
    const timeoutSignal = createTimeoutAbortSignal(JOB_SKILL_GAP_TIMEOUT_MS);
    try {
        return yield (0, jobSkillGapService_1.buildJobSkillGap)({
            db: params.db,
            currentUserId,
            viewer: params.viewer,
            job: params.job,
            signal: timeoutSignal.signal,
        });
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.name) === 'AbortError')
            return null;
        console.warn('Job skill gap analysis error:', error);
        return null;
    }
    finally {
        timeoutSignal.dispose();
    }
});
const attachHeatFieldsToSingleJobResponse = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const jobsWithHeat = yield (0, jobResponseService_1.attachHeatFieldsToJobResponses)({
        db: params.db,
        jobs: [params.job],
    });
    return Array.isArray(jobsWithHeat) && jobsWithHeat.length > 0
        ? jobsWithHeat[0]
        : params.job;
});
const buildJobDetailResponse = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const skillGap = params.currentUserId
        ? yield resolveJobSkillGap({
            db: params.db,
            currentUserId: params.currentUserId,
            viewer: params.viewer,
            job: params.job,
        })
        : null;
    const baseJobResponse = Object.assign(Object.assign({}, (0, jobResponseService_1.toJobResponse)(params.job)), (skillGap ? { skillGap } : {}));
    const [jobWithViewerState] = yield (0, jobApplicationViewerStateService_1.attachViewerApplicationStateToJobResponses)({
        db: params.db,
        currentUserId: params.currentUserId,
        jobs: yield (0, savedJobsService_1.attachSavedStateToJobResponses)({
            db: params.db,
            currentUserId: params.currentUserId,
            jobs: [baseJobResponse],
        }),
    });
    return attachHeatFieldsToSingleJobResponse({
        db: params.db,
        job: jobWithViewerState || baseJobResponse,
    });
});
const indexPulseSnapshotsByJobId = (snapshots) => new Map(snapshots
    .map((snapshot) => [(0, inputSanitizers_1.readString)(snapshot === null || snapshot === void 0 ? void 0 : snapshot.jobId, 120), snapshot])
    .filter(([jobId]) => jobId.length > 0));
exports.jobsController = {
    // GET /api/companies/:companyId/jobs
    listCompanyJobs: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit: 20, total: 0, pages: 0 },
                });
            }
            const { companyId } = req.params;
            const db = (0, db_1.getDB)();
            const statusRaw = (0, inputSanitizers_1.readString)(req.query.status, 40).toLowerCase() || 'open';
            const status = statusRaw === 'all' ? 'all' : statusRaw;
            if (status !== 'all' && !exports.ALLOWED_JOB_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status filter' });
            }
            const pagination = (0, jobDiscoveryQueryService_1.getPagination)(req.query);
            const filter = { companyId };
            if (status === 'all') {
                filter.status = { $ne: 'archived' };
            }
            else {
                filter.status = status;
            }
            const [items, total] = yield Promise.all([
                db.collection(exports.JOBS_COLLECTION)
                    .find(filter)
                    .sort({ publishedAt: -1, createdAt: -1 })
                    .skip(pagination.skip)
                    .limit(pagination.limit)
                    .toArray(),
                db.collection(exports.JOBS_COLLECTION).countDocuments(filter),
            ]);
            return res.json({
                success: true,
                data: items.map(jobResponseService_1.toJobResponse),
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total,
                    pages: Math.ceil(total / pagination.limit),
                },
            });
        }
        catch (error) {
            console.error('List company jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
        }
    }),
    // GET /api/jobs/hot
    listHotJobs: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit: 6, total: 0, pages: 0 },
                });
            }
            const db = (0, db_1.getDB)();
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_a = req.query) === null || _a === void 0 ? void 0 : _a.limit, 6, 1, 12);
            const snapshots = yield (0, jobPulseSnapshotService_1.listJobPulseSnapshots)({
                db,
                limit,
                sortBy: 'heat',
            });
            const hotJobIds = snapshots
                .map((snapshot) => (0, inputSanitizers_1.readString)(snapshot === null || snapshot === void 0 ? void 0 : snapshot.jobId, 120))
                .filter((jobId) => jobId.length > 0);
            if (hotJobIds.length === 0) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit, total: 0, pages: 0 },
                });
            }
            const jobs = yield db.collection(exports.JOBS_COLLECTION)
                .find({
                id: { $in: hotJobIds },
                status: 'open',
            })
                .toArray();
            const jobsById = new Map(jobs.map((job) => [(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120), job]).filter(([jobId]) => jobId.length > 0));
            const snapshotsByJobId = indexPulseSnapshotsByJobId(snapshots);
            const data = hotJobIds
                .map((jobId) => jobsById.get(jobId))
                .filter(Boolean)
                .map((job) => (Object.assign(Object.assign({}, (0, jobResponseService_1.toJobResponse)(job)), (0, jobPulseSnapshotService_1.buildJobHeatResponseFields)({ snapshot: snapshotsByJobId.get((0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120)) }))));
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
        }
        catch (error) {
            console.error('List hot jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch hot jobs' });
        }
    }),
    // GET /api/jobs/slug/:jobSlug
    getJobBySlug: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const rawRequestedSlug = (0, inputSanitizers_1.readString)(req.params.jobSlug, 220).toLowerCase();
            const requestedSlug = (0, jobSlugService_1.normalizeJobSlugValue)(rawRequestedSlug, 220);
            if (!requestedSlug) {
                return res.status(400).json({ success: false, error: 'Invalid job slug' });
            }
            const db = (0, db_1.getDB)();
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            const slugIdMatch = rawRequestedSlug.match(/(?:^|--)(job-[a-z0-9-]+)$/i);
            const slugJobId = (slugIdMatch === null || slugIdMatch === void 0 ? void 0 : slugIdMatch[1]) || '';
            if (slugJobId) {
                const byId = yield db.collection(exports.JOBS_COLLECTION).findOne({ id: slugJobId, status: { $ne: 'archived' } });
                if (byId) {
                    (0, jobViewBufferService_1.incrementJobViewCountAsync)(db, slugJobId, currentUserId);
                    return res.json({
                        success: true,
                        data: yield buildJobDetailResponse({
                            db,
                            job: byId,
                            currentUserId,
                            viewer: req.user,
                        }),
                    });
                }
            }
            const bySlug = yield db.collection(exports.JOBS_COLLECTION).findOne({
                slug: requestedSlug,
                status: { $ne: 'archived' },
            });
            if (!bySlug) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            (0, jobViewBufferService_1.incrementJobViewCountAsync)(db, (0, inputSanitizers_1.readString)(bySlug === null || bySlug === void 0 ? void 0 : bySlug.id, 120), currentUserId);
            return res.json({
                success: true,
                data: yield buildJobDetailResponse({
                    db,
                    job: bySlug,
                    currentUserId,
                    viewer: req.user,
                }),
            });
        }
        catch (error) {
            console.error('Get job by slug error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch job' });
        }
    }),
    // GET /api/jobs/:jobId
    getJobById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const { jobId } = req.params;
            const db = (0, db_1.getDB)();
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            const job = yield db.collection(exports.JOBS_COLLECTION).findOne({ id: jobId, status: { $ne: 'archived' } });
            if (!job) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            (0, jobViewBufferService_1.incrementJobViewCountAsync)(db, jobId, currentUserId);
            return res.json({
                success: true,
                data: yield buildJobDetailResponse({
                    db,
                    job,
                    currentUserId,
                    viewer: req.user,
                }),
            });
        }
        catch (error) {
            console.error('Get job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch job' });
        }
    }),
    // POST /api/jobs
    createJob: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const requestedCompanyId = (0, inputSanitizers_1.readString)((_b = req.body) === null || _b === void 0 ? void 0 : _b.companyId, 120) ||
                (0, inputSanitizers_1.readString)(req.headers['x-identity-id'] || '', 120);
            if (!requestedCompanyId) {
                return res.status(400).json({ success: false, error: 'companyId is required' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(requestedCompanyId, currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const db = (0, db_1.getDB)();
            const job = yield (0, jobWriteService_1.createCompanyJob)({
                db,
                actorId: requestedCompanyId,
                currentUserId,
                company: access.company,
                payload: req.body || {},
                io: req.app.get('io'),
                emitInsightsUpdate: () => (0, postsController_1.emitAuthorInsightsUpdate)(req.app, requestedCompanyId, 'company'),
            });
            return res.status(201).json({
                success: true,
                data: (0, jobResponseService_1.toJobResponse)(job),
            });
        }
        catch (error) {
            if (Number.isFinite(Number(error === null || error === void 0 ? void 0 : error.statusCode)) && (error === null || error === void 0 ? void 0 : error.message)) {
                return res.status(Number(error.statusCode)).json({ success: false, error: String(error.message) });
            }
            console.error('Create job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to create job' });
        }
    }),
    // PUT /api/jobs/:jobId
    updateJob: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { jobId } = req.params;
            const db = (0, db_1.getDB)();
            const existingJob = yield db.collection(exports.JOBS_COLLECTION).findOne({ id: jobId });
            if (!existingJob) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(String(existingJob.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const updatedJob = yield (0, jobWriteService_1.updateCompanyJob)({
                db,
                existingJob,
                payload: req.body || {},
            });
            return res.json({
                success: true,
                data: (0, jobResponseService_1.toJobResponse)(updatedJob),
            });
        }
        catch (error) {
            if (Number.isFinite(Number(error === null || error === void 0 ? void 0 : error.statusCode)) && (error === null || error === void 0 ? void 0 : error.message)) {
                return res.status(Number(error.statusCode)).json({ success: false, error: String(error.message) });
            }
            console.error('Update job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update job' });
        }
    }),
    // PATCH /api/jobs/:jobId/status
    updateJobStatus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { jobId } = req.params;
            const nextStatus = (0, inputSanitizers_1.readString)((_b = req.body) === null || _b === void 0 ? void 0 : _b.status, 40).toLowerCase();
            const db = (0, db_1.getDB)();
            const existingJob = yield db.collection(exports.JOBS_COLLECTION).findOne({ id: jobId });
            if (!existingJob) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(String(existingJob.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const updatedJob = yield (0, jobWriteService_1.updateCompanyJobStatus)({
                db,
                existingJob,
                nextStatus,
            });
            return res.json({ success: true, data: (0, jobResponseService_1.toJobResponse)(updatedJob) });
        }
        catch (error) {
            if (Number.isFinite(Number(error === null || error === void 0 ? void 0 : error.statusCode)) && (error === null || error === void 0 ? void 0 : error.message)) {
                return res.status(Number(error.statusCode)).json({ success: false, error: String(error.message) });
            }
            console.error('Update job status error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update job status' });
        }
    }),
    // DELETE /api/jobs/:jobId
    deleteJob: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { jobId } = req.params;
            const db = (0, db_1.getDB)();
            const existingJob = yield db.collection(exports.JOBS_COLLECTION).findOne({ id: jobId });
            if (!existingJob) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const companyId = (0, inputSanitizers_1.readString)(existingJob.companyId, 120);
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(companyId, currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const announcementPostId = (0, inputSanitizers_1.readString)(existingJob.announcementPostId, 120);
            const postDeleteFilter = announcementPostId
                ? { $or: [{ id: announcementPostId }, { 'jobMeta.jobId': jobId }] }
                : { 'jobMeta.jobId': jobId };
            yield Promise.all([
                db.collection(exports.JOBS_COLLECTION).deleteOne({ id: jobId }),
                db.collection(JOB_APPLICATIONS_COLLECTION).deleteMany({ jobId }),
                db.collection(JOB_APPLICATION_NOTES_COLLECTION).deleteMany({ jobId }),
                db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).deleteMany({ jobId }),
                db.collection('posts').deleteMany(postDeleteFilter),
            ]);
            (0, postsController_1.emitAuthorInsightsUpdate)(req.app, companyId, 'company').catch(() => undefined);
            return res.json({
                success: true,
                data: {
                    id: jobId,
                    companyId,
                    announcementPostId: announcementPostId || null,
                },
            });
        }
        catch (error) {
            console.error('Delete job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to delete job' });
        }
    }),
    // GET /api/companies/:companyId/job-analytics
    getJobAnalytics: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({ success: true, data: companyJobAnalyticsService_1.EMPTY_COMPANY_JOB_ANALYTICS });
            }
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
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
            const data = yield (0, companyJobAnalyticsService_1.buildCompanyJobAnalytics)(db, companyId);
            return res.json({
                success: true,
                data,
            });
        }
        catch (error) {
            console.error('Get company job analytics error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch company job analytics' });
        }
    }),
};
