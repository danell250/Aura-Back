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
exports.jobApplicationController = void 0;
const db_1 = require("../db");
const jobDiscoveryQueryService_1 = require("../services/jobDiscoveryQueryService");
const jobApplicationLifecycleService_1 = require("../services/jobApplicationLifecycleService");
const jobApplicationResponseService_1 = require("../services/jobApplicationResponseService");
const jobApplicationWriteService_1 = require("../services/jobApplicationWriteService");
const jobPulseService_1 = require("../services/jobPulseService");
const userBadgeService_1 = require("../services/userBadgeService");
const companyJobAnalyticsService_1 = require("../services/companyJobAnalyticsService");
const identityUtils_1 = require("../utils/identityUtils");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const buildNormalizedPrefixRange = (raw) => {
    const trimmed = (0, inputSanitizers_1.readString)(raw, 100).toLowerCase();
    if (!trimmed)
        return null;
    return {
        $gte: trimmed,
        $lt: `${trimmed}\uffff`,
    };
};
const EMAIL_SEARCH_TERM_PATTERN = /^[^\s@]+@[^\s@]*$/;
const resolveApplicationSearchField = (searchTerm) => EMAIL_SEARCH_TERM_PATTERN.test(searchTerm)
    ? 'applicantEmailNormalized'
    : 'applicantNameNormalized';
exports.jobApplicationController = {
    // POST /api/jobs/:jobId/applications
    createJobApplication: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUserId, {
                ownerType: (0, inputSanitizers_1.readString)(req.headers['x-identity-type'] || 'user', 20),
                ownerId: (0, inputSanitizers_1.readString)(req.headers['x-identity-id'] || currentUserId, 120),
            }, req.headers);
            if (!actor || actor.type !== 'user' || actor.id !== currentUserId) {
                return res.status(403).json({ success: false, error: 'Applications must be submitted from personal identity' });
            }
            const jobId = (0, inputSanitizers_1.readString)(req.params.jobId, 120);
            if (!jobId) {
                return res.status(400).json({ success: false, error: 'jobId is required' });
            }
            const db = (0, db_1.getDB)();
            const { job, application, nowIso } = yield (0, jobApplicationWriteService_1.prepareJobApplicationSubmission)({
                db,
                currentUserId,
                jobId,
                payload: req.body || {},
            });
            yield db.collection(JOB_APPLICATIONS_COLLECTION).insertOne(application);
            yield db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $inc: { applicationCount: 1 }, $set: { updatedAt: nowIso } });
            (0, jobPulseService_1.recordJobPulseEventAsync)(db, {
                jobId,
                type: 'job_applied',
                userId: currentUserId,
                createdAt: nowIso,
            });
            (0, companyJobAnalyticsService_1.invalidateCompanyJobAnalyticsCache)(String(job.companyId || ''));
            const applicantApplicationCount = yield (0, jobApplicationLifecycleService_1.incrementApplicantApplicationCount)(db, currentUserId, nowIso);
            (0, jobApplicationLifecycleService_1.scheduleJobApplicationPostCreateEffects)({
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
                data: (0, jobApplicationResponseService_1.toApplicationResponse)(application),
            });
        }
        catch (error) {
            if (Number.isFinite(Number(error === null || error === void 0 ? void 0 : error.statusCode)) && (error === null || error === void 0 ? void 0 : error.message)) {
                return res.status(Number(error.statusCode)).json({ success: false, error: String(error.message) });
            }
            if ((error === null || error === void 0 ? void 0 : error.code) === 11000) {
                return res.status(409).json({ success: false, error: 'You have already applied to this job' });
            }
            console.error('Create job application error:', error);
            return res.status(500).json({ success: false, error: 'Failed to submit application' });
        }
    }),
    // GET /api/jobs/:jobId/applications
    listJobApplications: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const jobId = (0, inputSanitizers_1.readString)(req.params.jobId, 120);
            if (!jobId) {
                return res.status(400).json({ success: false, error: 'jobId is required' });
            }
            const db = (0, db_1.getDB)();
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId }, { projection: { companyId: 1 } });
            if (!job) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(String(job.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const status = (0, inputSanitizers_1.readString)(req.query.status, 40).toLowerCase();
            if (status && !jobApplicationResponseService_1.ALLOWED_APPLICATION_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid application status filter' });
            }
            const pagination = (0, jobDiscoveryQueryService_1.getPagination)(req.query);
            const searchTerm = (0, inputSanitizers_1.readString)(req.query.q, 100).toLowerCase();
            const searchRange = buildNormalizedPrefixRange(searchTerm);
            const filter = { jobId };
            if (status)
                filter.status = status;
            if (searchRange) {
                filter[resolveApplicationSearchField(searchTerm)] = searchRange;
            }
            const [items, total] = yield Promise.all([
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
                data: items.map(jobApplicationResponseService_1.toApplicationResponse),
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    total,
                    pages: Math.ceil(total / pagination.limit),
                },
            });
        }
        catch (error) {
            console.error('List job applications error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch applications' });
        }
    }),
    // PATCH /api/applications/:applicationId/status
    updateJobApplicationStatus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const applicationId = (0, inputSanitizers_1.readString)(req.params.applicationId, 120);
            if (!applicationId) {
                return res.status(400).json({ success: false, error: 'applicationId is required' });
            }
            const nextStatus = (0, inputSanitizers_1.readString)((_b = req.body) === null || _b === void 0 ? void 0 : _b.status, 40).toLowerCase();
            const statusNote = (0, inputSanitizers_1.readStringOrNull)((_c = req.body) === null || _c === void 0 ? void 0 : _c.statusNote, 1000);
            if (!jobApplicationResponseService_1.ALLOWED_APPLICATION_STATUSES.has(nextStatus)) {
                return res.status(400).json({ success: false, error: 'Invalid application status' });
            }
            const db = (0, db_1.getDB)();
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(String(application.companyId || ''), currentUserId);
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
            yield db.collection(JOB_APPLICATIONS_COLLECTION).updateOne({ id: applicationId }, { $set: updates });
            (0, companyJobAnalyticsService_1.invalidateCompanyJobAnalyticsCache)(String(application.companyId || ''));
            void (0, userBadgeService_1.awardStatusDrivenBadge)({
                db,
                userId: String(application.applicantUserId || ''),
                applicationId,
                nextStatus,
            }).catch((badgeError) => {
                console.error('Award status-driven badge error:', badgeError);
            });
            const updated = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            return res.json({ success: true, data: (0, jobApplicationResponseService_1.toApplicationResponse)(updated) });
        }
        catch (error) {
            console.error('Update application status error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update application status' });
        }
    }),
};
