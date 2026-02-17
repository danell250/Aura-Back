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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobsController = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const identityUtils_1 = require("../utils/identityUtils");
const postsController_1 = require("./postsController");
const hashtagUtils_1 = require("../utils/hashtagUtils");
const emailService_1 = require("../services/emailService");
const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const COMPANIES_COLLECTION = 'companies';
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';
const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
const ALLOWED_APPLICATION_STATUSES = new Set(['submitted', 'in_review', 'shortlisted', 'rejected', 'hired', 'withdrawn']);
const ALLOWED_RESUME_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const readStringOrNull = (value, maxLength = 10000) => {
    const normalized = readString(value, maxLength);
    return normalized.length > 0 ? normalized : null;
};
const readStringList = (value, maxItems = 10, maxLength = 40) => {
    if (!Array.isArray(value))
        return [];
    const deduped = new Set();
    const next = [];
    for (const item of value) {
        const normalized = readString(item, maxLength).toLowerCase();
        if (!normalized || deduped.has(normalized))
            continue;
        deduped.add(normalized);
        next.push(normalized);
        if (next.length >= maxItems)
            break;
    }
    return next;
};
const parsePositiveInt = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    const rounded = Math.round(parsed);
    if (rounded < min)
        return min;
    if (rounded > max)
        return max;
    return rounded;
};
const getPagination = (query) => {
    const page = parsePositiveInt(query.page, 1, 1, 100000);
    const limit = parsePositiveInt(query.limit, 20, 1, 100);
    return {
        page,
        limit,
        skip: (page - 1) * limit,
    };
};
const parseIsoOrNull = (value) => {
    if (value == null)
        return null;
    const asString = readString(String(value), 100);
    if (!asString)
        return null;
    const parsed = new Date(asString);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed.toISOString();
};
const hashSecureToken = (token) => {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
};
const getReviewLinkTtlHours = () => {
    const raw = Number(process.env.JOB_REVIEW_LINK_TTL_HOURS || 72);
    if (!Number.isFinite(raw))
        return 72;
    return Math.min(168, Math.max(1, Math.round(raw)));
};
const getReviewPortalBaseUrl = () => {
    const configured = readString(process.env.FRONTEND_URL || '', 300) ||
        readString(process.env.VITE_FRONTEND_URL || '', 300);
    return configured ? configured.replace(/\/$/, '') : 'https://www.aura.net.za';
};
const buildReviewPortalUrl = (rawToken) => {
    const baseUrl = getReviewPortalBaseUrl();
    return `${baseUrl}/company/manage?applicationReviewToken=${encodeURIComponent(rawToken)}`;
};
const sanitizeSearchRegex = (raw) => {
    const trimmed = readString(raw, 100);
    if (!trimmed)
        return null;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
};
const toAnnouncementTag = (tag) => tag.replace(/[^a-z0-9]/gi, '').toLowerCase();
const buildJobAnnouncementContent = (job) => {
    const normalizedTags = Array.from(new Set((job.tags || [])
        .map(toAnnouncementTag)
        .filter((value) => value.length > 0))).slice(0, 5);
    const hashtagList = Array.from(new Set(['hiring', 'jobs', ...normalizedTags]))
        .map((tag) => `#${tag}`)
        .join(' ');
    return [
        `We're hiring: ${job.title}`,
        '',
        `${job.companyName} is opening a new role.`,
        `Location: ${job.locationText} • ${job.workModel.replace('_', ' ')} • ${job.employmentType.replace('_', ' ')}`,
        '',
        job.summary,
        '',
        'Apply directly from our Jobs tab on Aura.',
        hashtagList,
    ].join('\n');
};
const resolveOwnerAdminCompanyAccess = (companyId, authenticatedUserId) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const company = yield db.collection(COMPANIES_COLLECTION).findOne({
        id: companyId,
        legacyArchived: { $ne: true },
    });
    if (!company) {
        return { allowed: false, status: 404, error: 'Company not found' };
    }
    if (company.ownerId === authenticatedUserId) {
        return { allowed: true, status: 200, company };
    }
    const membership = yield db.collection(COMPANY_MEMBERS_COLLECTION).findOne({
        companyId,
        userId: authenticatedUserId,
        role: { $in: ['owner', 'admin'] },
    });
    if (!membership) {
        return { allowed: false, status: 403, error: 'Only company owner/admin can perform this action' };
    }
    return { allowed: true, status: 200, company };
});
const canReadApplication = (application, authenticatedUserId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!application)
        return false;
    if (application.applicantUserId === authenticatedUserId)
        return true;
    const access = yield resolveOwnerAdminCompanyAccess(String(application.companyId || ''), authenticatedUserId);
    return access.allowed;
});
const resolveJobReviewRecipients = (db, companyId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!companyId) {
        return { company: null, recipients: [] };
    }
    const company = yield db.collection(COMPANIES_COLLECTION).findOne({ id: companyId, legacyArchived: { $ne: true } }, { projection: { id: 1, name: 1, ownerId: 1 } });
    if (!company) {
        return { company: null, recipients: [] };
    }
    const memberRows = yield db.collection(COMPANY_MEMBERS_COLLECTION)
        .find({
        companyId,
        role: { $in: ['owner', 'admin'] },
    })
        .project({ userId: 1 })
        .toArray();
    const reviewerIds = Array.from(new Set([
        String(company.ownerId || '').trim(),
        ...memberRows.map((row) => String((row === null || row === void 0 ? void 0 : row.userId) || '').trim()),
    ].filter((id) => id.length > 0)));
    if (reviewerIds.length === 0) {
        return { company, recipients: [] };
    }
    const reviewerUsers = yield db.collection(USERS_COLLECTION)
        .find({ id: { $in: reviewerIds } })
        .project({ id: 1, email: 1, name: 1, firstName: 1, lastName: 1 })
        .toArray();
    const emailDedupe = new Set();
    const recipients = [];
    for (const reviewer of reviewerUsers) {
        const email = readString(reviewer === null || reviewer === void 0 ? void 0 : reviewer.email, 160).toLowerCase();
        if (!email || emailDedupe.has(email))
            continue;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            continue;
        emailDedupe.add(email);
        const displayName = readString(reviewer === null || reviewer === void 0 ? void 0 : reviewer.name, 120) ||
            `${readString(reviewer === null || reviewer === void 0 ? void 0 : reviewer.firstName, 80)} ${readString(reviewer === null || reviewer === void 0 ? void 0 : reviewer.lastName, 80)}`.trim() ||
            'Team';
        recipients.push({
            userId: String((reviewer === null || reviewer === void 0 ? void 0 : reviewer.id) || ''),
            email,
            displayName,
        });
    }
    return { company, recipients };
});
const sendApplicationReviewEmails = (db, params) => __awaiter(void 0, void 0, void 0, function* () {
    const companyId = readString(params.companyId, 120);
    const jobId = readString(params.jobId, 120);
    const application = params.application;
    const job = params.job;
    if (!companyId || !jobId || !application || !job)
        return;
    const { company, recipients } = yield resolveJobReviewRecipients(db, companyId);
    if (!company || recipients.length === 0)
        return;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const ttlHours = getReviewLinkTtlHours();
    const expiresAtIso = new Date(now + ttlHours * 60 * 60 * 1000).toISOString();
    const linkRows = [];
    for (const recipient of recipients) {
        const rawToken = crypto_1.default.randomBytes(32).toString('hex');
        linkRows.push({
            recipient,
            rawToken,
            record: {
                id: `jobreview-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`,
                tokenHash: hashSecureToken(rawToken),
                companyId,
                jobId,
                applicationId: String((application === null || application === void 0 ? void 0 : application.id) || ''),
                recipientUserId: recipient.userId,
                recipientEmail: recipient.email,
                createdAt: nowIso,
                expiresAt: expiresAtIso,
                lastResolvedAt: null,
                lastResolvedByUserId: null,
            },
        });
    }
    if (linkRows.length === 0)
        return;
    yield db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).insertMany(linkRows.map((row) => row.record));
    yield Promise.allSettled(linkRows.map((row) => (0, emailService_1.sendJobApplicationReviewEmail)(row.recipient.email, {
        reviewerName: row.recipient.displayName,
        companyName: readString(company === null || company === void 0 ? void 0 : company.name, 160) || readString(job === null || job === void 0 ? void 0 : job.companyName, 160) || 'Aura Company',
        jobTitle: readString(job === null || job === void 0 ? void 0 : job.title, 160) || 'Open role',
        applicantName: readString(application === null || application === void 0 ? void 0 : application.applicantName, 160) || 'Applicant',
        applicantEmail: readString(application === null || application === void 0 ? void 0 : application.applicantEmail, 160),
        applicantPhone: readString(application === null || application === void 0 ? void 0 : application.applicantPhone, 60),
        submittedAt: readString(application === null || application === void 0 ? void 0 : application.createdAt, 80) || nowIso,
        securePortalUrl: buildReviewPortalUrl(row.rawToken),
        expiresAt: expiresAtIso,
    })));
});
const toJobResponse = (job) => ({
    id: String((job === null || job === void 0 ? void 0 : job.id) || ''),
    companyId: String((job === null || job === void 0 ? void 0 : job.companyId) || ''),
    companyName: String((job === null || job === void 0 ? void 0 : job.companyName) || ''),
    companyHandle: String((job === null || job === void 0 ? void 0 : job.companyHandle) || ''),
    title: String((job === null || job === void 0 ? void 0 : job.title) || ''),
    summary: String((job === null || job === void 0 ? void 0 : job.summary) || ''),
    description: String((job === null || job === void 0 ? void 0 : job.description) || ''),
    locationText: String((job === null || job === void 0 ? void 0 : job.locationText) || ''),
    workModel: String((job === null || job === void 0 ? void 0 : job.workModel) || 'onsite'),
    employmentType: String((job === null || job === void 0 ? void 0 : job.employmentType) || 'full_time'),
    salaryMin: typeof (job === null || job === void 0 ? void 0 : job.salaryMin) === 'number' ? job.salaryMin : null,
    salaryMax: typeof (job === null || job === void 0 ? void 0 : job.salaryMax) === 'number' ? job.salaryMax : null,
    salaryCurrency: String((job === null || job === void 0 ? void 0 : job.salaryCurrency) || ''),
    applicationDeadline: (job === null || job === void 0 ? void 0 : job.applicationDeadline) || null,
    status: String((job === null || job === void 0 ? void 0 : job.status) || 'open'),
    tags: Array.isArray(job === null || job === void 0 ? void 0 : job.tags) ? job.tags : [],
    createdByUserId: String((job === null || job === void 0 ? void 0 : job.createdByUserId) || ''),
    createdAt: (job === null || job === void 0 ? void 0 : job.createdAt) || null,
    updatedAt: (job === null || job === void 0 ? void 0 : job.updatedAt) || null,
    publishedAt: (job === null || job === void 0 ? void 0 : job.publishedAt) || null,
    announcementPostId: (job === null || job === void 0 ? void 0 : job.announcementPostId) || null,
    applicationCount: Number.isFinite(job === null || job === void 0 ? void 0 : job.applicationCount) ? Number(job.applicationCount) : 0,
});
const toApplicationResponse = (application) => ({
    id: String((application === null || application === void 0 ? void 0 : application.id) || ''),
    jobId: String((application === null || application === void 0 ? void 0 : application.jobId) || ''),
    companyId: String((application === null || application === void 0 ? void 0 : application.companyId) || ''),
    applicantUserId: String((application === null || application === void 0 ? void 0 : application.applicantUserId) || ''),
    applicantName: String((application === null || application === void 0 ? void 0 : application.applicantName) || ''),
    applicantEmail: String((application === null || application === void 0 ? void 0 : application.applicantEmail) || ''),
    applicantPhone: String((application === null || application === void 0 ? void 0 : application.applicantPhone) || ''),
    coverLetter: String((application === null || application === void 0 ? void 0 : application.coverLetter) || ''),
    portfolioUrl: String((application === null || application === void 0 ? void 0 : application.portfolioUrl) || ''),
    resumeKey: String((application === null || application === void 0 ? void 0 : application.resumeKey) || ''),
    resumeFileName: String((application === null || application === void 0 ? void 0 : application.resumeFileName) || ''),
    resumeMimeType: String((application === null || application === void 0 ? void 0 : application.resumeMimeType) || ''),
    resumeSize: Number.isFinite(application === null || application === void 0 ? void 0 : application.resumeSize) ? Number(application.resumeSize) : 0,
    status: String((application === null || application === void 0 ? void 0 : application.status) || 'submitted'),
    createdAt: (application === null || application === void 0 ? void 0 : application.createdAt) || null,
    updatedAt: (application === null || application === void 0 ? void 0 : application.updatedAt) || null,
    reviewedByUserId: (application === null || application === void 0 ? void 0 : application.reviewedByUserId) || null,
    reviewedAt: (application === null || application === void 0 ? void 0 : application.reviewedAt) || null,
    statusNote: (application === null || application === void 0 ? void 0 : application.statusNote) || null,
});
let s3Client = null;
const getS3Client = () => {
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (!region || !accessKeyId || !secretAccessKey)
        return null;
    if (s3Client)
        return s3Client;
    s3Client = new client_s3_1.S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
    });
    return s3Client;
};
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
            const statusRaw = readString(req.query.status, 40).toLowerCase() || 'open';
            const status = statusRaw === 'all' ? 'all' : statusRaw;
            if (status !== 'all' && !ALLOWED_JOB_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status filter' });
            }
            const pagination = getPagination(req.query);
            const filter = { companyId };
            if (status === 'all') {
                filter.status = { $ne: 'archived' };
            }
            else {
                filter.status = status;
            }
            const [items, total] = yield Promise.all([
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
        }
        catch (error) {
            console.error('List company jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
        }
    }),
    // GET /api/jobs/:jobId
    getJobById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const { jobId } = req.params;
            const db = (0, db_1.getDB)();
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            if (!job || job.status === 'archived') {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            return res.json({ success: true, data: toJobResponse(job) });
        }
        catch (error) {
            console.error('Get job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch job' });
        }
    }),
    // POST /api/jobs
    createJob: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const requestedCompanyId = readString((_b = req.body) === null || _b === void 0 ? void 0 : _b.companyId, 120) ||
                readString(req.headers['x-identity-id'] || '', 120);
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUserId, { ownerType: 'company', ownerId: requestedCompanyId });
            if (!actor || actor.type !== 'company') {
                return res.status(403).json({ success: false, error: 'Company identity context is required' });
            }
            const access = yield resolveOwnerAdminCompanyAccess(actor.id, currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const title = readString((_c = req.body) === null || _c === void 0 ? void 0 : _c.title, 120);
            const summary = readString((_d = req.body) === null || _d === void 0 ? void 0 : _d.summary, 240);
            const description = readString((_e = req.body) === null || _e === void 0 ? void 0 : _e.description, 15000);
            const locationText = readString((_f = req.body) === null || _f === void 0 ? void 0 : _f.locationText, 160);
            const workModel = readString((_g = req.body) === null || _g === void 0 ? void 0 : _g.workModel, 40).toLowerCase();
            const employmentType = readString((_h = req.body) === null || _h === void 0 ? void 0 : _h.employmentType, 40).toLowerCase();
            const tags = readStringList((_j = req.body) === null || _j === void 0 ? void 0 : _j.tags, 10, 40);
            if (!title || !summary || !description || !locationText) {
                return res.status(400).json({
                    success: false,
                    error: 'title, summary, description, and locationText are required',
                });
            }
            if (!ALLOWED_WORK_MODELS.has(workModel)) {
                return res.status(400).json({ success: false, error: 'Invalid workModel' });
            }
            if (!ALLOWED_EMPLOYMENT_TYPES.has(employmentType)) {
                return res.status(400).json({ success: false, error: 'Invalid employmentType' });
            }
            const salaryMinRaw = (_k = req.body) === null || _k === void 0 ? void 0 : _k.salaryMin;
            const salaryMaxRaw = (_l = req.body) === null || _l === void 0 ? void 0 : _l.salaryMax;
            const salaryMin = Number.isFinite(Number(salaryMinRaw)) ? Number(salaryMinRaw) : null;
            const salaryMax = Number.isFinite(Number(salaryMaxRaw)) ? Number(salaryMaxRaw) : null;
            const salaryCurrency = readString((_m = req.body) === null || _m === void 0 ? void 0 : _m.salaryCurrency, 10).toUpperCase();
            const applicationDeadline = parseIsoOrNull((_o = req.body) === null || _o === void 0 ? void 0 : _o.applicationDeadline);
            const announceInFeed = Boolean((_p = req.body) === null || _p === void 0 ? void 0 : _p.announceInFeed);
            if (salaryMin != null && salaryMin < 0) {
                return res.status(400).json({ success: false, error: 'salaryMin cannot be negative' });
            }
            if (salaryMax != null && salaryMax < 0) {
                return res.status(400).json({ success: false, error: 'salaryMax cannot be negative' });
            }
            if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) {
                return res.status(400).json({ success: false, error: 'salaryMax cannot be less than salaryMin' });
            }
            const nowIso = new Date().toISOString();
            const job = {
                id: `job-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`,
                companyId: actor.id,
                companyName: readString((_q = access.company) === null || _q === void 0 ? void 0 : _q.name, 120) || 'Company',
                companyHandle: readString((_r = access.company) === null || _r === void 0 ? void 0 : _r.handle, 80),
                title,
                summary,
                description,
                locationText,
                workModel,
                employmentType,
                salaryMin,
                salaryMax,
                salaryCurrency,
                applicationDeadline,
                status: 'open',
                tags,
                createdByUserId: currentUserId,
                createdAt: nowIso,
                updatedAt: nowIso,
                publishedAt: nowIso,
                announcementPostId: null,
                applicationCount: 0,
            };
            const db = (0, db_1.getDB)();
            let announcementPostId = null;
            if (announceInFeed) {
                const nowTimestamp = Date.now();
                const postId = `post-job-${nowTimestamp}-${crypto_1.default.randomBytes(4).toString('hex')}`;
                const announcementContent = buildJobAnnouncementContent({
                    title,
                    companyName: readString((_s = access.company) === null || _s === void 0 ? void 0 : _s.name, 120) || 'Company',
                    locationText,
                    workModel,
                    employmentType,
                    summary,
                    tags,
                });
                const hashtags = (0, hashtagUtils_1.getHashtagsFromText)(announcementContent);
                const announcementPost = {
                    id: postId,
                    author: {
                        id: actor.id,
                        firstName: readString((_t = access.company) === null || _t === void 0 ? void 0 : _t.name, 120) || 'Company',
                        lastName: '',
                        name: readString((_u = access.company) === null || _u === void 0 ? void 0 : _u.name, 120) || 'Company',
                        handle: readString((_v = access.company) === null || _v === void 0 ? void 0 : _v.handle, 80) || '',
                        avatar: readString((_w = access.company) === null || _w === void 0 ? void 0 : _w.avatar, 500) || '',
                        avatarKey: readString((_x = access.company) === null || _x === void 0 ? void 0 : _x.avatarKey, 500) || '',
                        avatarType: ((_y = access.company) === null || _y === void 0 ? void 0 : _y.avatarType) === 'video' ? 'video' : 'image',
                        activeGlow: ((_z = access.company) === null || _z === void 0 ? void 0 : _z.activeGlow) || 'none',
                        type: 'company',
                    },
                    authorId: actor.id,
                    ownerId: actor.id,
                    ownerType: 'company',
                    content: announcementContent,
                    energy: '🪐 Neutral',
                    radiance: 0,
                    timestamp: nowTimestamp,
                    visibility: 'public',
                    reactions: {},
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    viewCount: 0,
                    hashtags,
                    taggedUserIds: [],
                    jobMeta: {
                        jobId: job.id,
                        companyId: actor.id,
                        title,
                        locationText,
                        workModel,
                        employmentType,
                    },
                };
                try {
                    yield db.collection('posts').insertOne(announcementPost);
                    const io = req.app.get('io');
                    if (io) {
                        io.emit('new_post', announcementPost);
                    }
                    (0, postsController_1.emitAuthorInsightsUpdate)(req.app, actor.id, 'company').catch(() => undefined);
                    announcementPostId = postId;
                }
                catch (announcementError) {
                    console.error('Create job announcement post error:', announcementError);
                }
            }
            if (announcementPostId) {
                job.announcementPostId = announcementPostId;
            }
            yield db.collection(JOBS_COLLECTION).insertOne(job);
            return res.status(201).json({
                success: true,
                data: toJobResponse(job),
            });
        }
        catch (error) {
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
            const existingJob = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            if (!existingJob) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const access = yield resolveOwnerAdminCompanyAccess(String(existingJob.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const updates = {};
            if (req.body.title !== undefined) {
                const value = readString(req.body.title, 120);
                if (!value)
                    return res.status(400).json({ success: false, error: 'title cannot be empty' });
                updates.title = value;
            }
            if (req.body.summary !== undefined) {
                const value = readString(req.body.summary, 240);
                if (!value)
                    return res.status(400).json({ success: false, error: 'summary cannot be empty' });
                updates.summary = value;
            }
            if (req.body.description !== undefined) {
                const value = readString(req.body.description, 15000);
                if (!value)
                    return res.status(400).json({ success: false, error: 'description cannot be empty' });
                updates.description = value;
            }
            if (req.body.locationText !== undefined) {
                const value = readString(req.body.locationText, 160);
                if (!value)
                    return res.status(400).json({ success: false, error: 'locationText cannot be empty' });
                updates.locationText = value;
            }
            if (req.body.workModel !== undefined) {
                const value = readString(req.body.workModel, 40).toLowerCase();
                if (!ALLOWED_WORK_MODELS.has(value))
                    return res.status(400).json({ success: false, error: 'Invalid workModel' });
                updates.workModel = value;
            }
            if (req.body.employmentType !== undefined) {
                const value = readString(req.body.employmentType, 40).toLowerCase();
                if (!ALLOWED_EMPLOYMENT_TYPES.has(value)) {
                    return res.status(400).json({ success: false, error: 'Invalid employmentType' });
                }
                updates.employmentType = value;
            }
            if (req.body.salaryMin !== undefined) {
                const value = Number(req.body.salaryMin);
                if (!Number.isFinite(value) || value < 0) {
                    return res.status(400).json({ success: false, error: 'salaryMin must be a non-negative number' });
                }
                updates.salaryMin = value;
            }
            if (req.body.salaryMax !== undefined) {
                const value = Number(req.body.salaryMax);
                if (!Number.isFinite(value) || value < 0) {
                    return res.status(400).json({ success: false, error: 'salaryMax must be a non-negative number' });
                }
                updates.salaryMax = value;
            }
            const nextSalaryMin = updates.salaryMin !== undefined
                ? Number(updates.salaryMin)
                : (Number.isFinite(existingJob.salaryMin) ? Number(existingJob.salaryMin) : null);
            const nextSalaryMax = updates.salaryMax !== undefined
                ? Number(updates.salaryMax)
                : (Number.isFinite(existingJob.salaryMax) ? Number(existingJob.salaryMax) : null);
            if (nextSalaryMin != null && nextSalaryMax != null && nextSalaryMax < nextSalaryMin) {
                return res.status(400).json({ success: false, error: 'salaryMax cannot be less than salaryMin' });
            }
            if (req.body.salaryCurrency !== undefined) {
                updates.salaryCurrency = readString(req.body.salaryCurrency, 10).toUpperCase();
            }
            if (req.body.applicationDeadline !== undefined) {
                const parsed = parseIsoOrNull(req.body.applicationDeadline);
                updates.applicationDeadline = parsed;
            }
            if (req.body.tags !== undefined) {
                updates.tags = readStringList(req.body.tags, 10, 40);
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ success: false, error: 'No valid fields to update' });
            }
            updates.updatedAt = new Date().toISOString();
            yield db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $set: updates });
            const updatedJob = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            return res.json({
                success: true,
                data: toJobResponse(updatedJob),
            });
        }
        catch (error) {
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
            const nextStatus = readString((_b = req.body) === null || _b === void 0 ? void 0 : _b.status, 40).toLowerCase();
            if (!ALLOWED_JOB_STATUSES.has(nextStatus)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }
            const db = (0, db_1.getDB)();
            const existingJob = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            if (!existingJob) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const access = yield resolveOwnerAdminCompanyAccess(String(existingJob.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const nextUpdate = {
                status: nextStatus,
                updatedAt: new Date().toISOString(),
            };
            if (nextStatus === 'open' && !existingJob.publishedAt) {
                nextUpdate.publishedAt = new Date().toISOString();
            }
            yield db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $set: nextUpdate });
            const updatedJob = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            return res.json({ success: true, data: toJobResponse(updatedJob) });
        }
        catch (error) {
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
            const existingJob = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            if (!existingJob) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const companyId = readString(existingJob.companyId, 120);
            const access = yield resolveOwnerAdminCompanyAccess(companyId, currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const announcementPostId = readString(existingJob.announcementPostId, 120);
            const postDeleteFilter = announcementPostId
                ? { $or: [{ id: announcementPostId }, { 'jobMeta.jobId': jobId }] }
                : { 'jobMeta.jobId': jobId };
            yield Promise.all([
                db.collection(JOBS_COLLECTION).deleteOne({ id: jobId }),
                db.collection(JOB_APPLICATIONS_COLLECTION).deleteMany({ jobId }),
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
    // POST /api/jobs/:jobId/applications
    createJobApplication: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUserId, {
                ownerType: readString(req.headers['x-identity-type'] || 'user', 20),
                ownerId: readString(req.headers['x-identity-id'] || currentUserId, 120),
            }, req.headers);
            if (!actor || actor.type !== 'user' || actor.id !== currentUserId) {
                return res.status(403).json({ success: false, error: 'Applications must be submitted from personal identity' });
            }
            const { jobId } = req.params;
            const db = (0, db_1.getDB)();
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            if (!job || job.status !== 'open') {
                return res.status(404).json({ success: false, error: 'Job not available for applications' });
            }
            const duplicate = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({
                jobId,
                applicantUserId: currentUserId,
            });
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    error: 'You have already applied to this job',
                });
            }
            const applicantName = readString((_b = req.body) === null || _b === void 0 ? void 0 : _b.applicantName, 120);
            const applicantEmail = readString((_c = req.body) === null || _c === void 0 ? void 0 : _c.applicantEmail, 160).toLowerCase();
            const applicantPhone = readStringOrNull((_d = req.body) === null || _d === void 0 ? void 0 : _d.applicantPhone, 40);
            const coverLetter = readStringOrNull((_e = req.body) === null || _e === void 0 ? void 0 : _e.coverLetter, 5000);
            const portfolioUrl = readStringOrNull((_f = req.body) === null || _f === void 0 ? void 0 : _f.portfolioUrl, 300);
            const resumeKey = readString((_g = req.body) === null || _g === void 0 ? void 0 : _g.resumeKey, 500);
            const resumeFileName = readString((_h = req.body) === null || _h === void 0 ? void 0 : _h.resumeFileName, 200);
            const resumeMimeType = readString((_j = req.body) === null || _j === void 0 ? void 0 : _j.resumeMimeType, 120);
            const resumeSize = Number((_k = req.body) === null || _k === void 0 ? void 0 : _k.resumeSize);
            if (!applicantName || !applicantEmail || !resumeKey || !resumeFileName || !resumeMimeType) {
                return res.status(400).json({
                    success: false,
                    error: 'applicantName, applicantEmail, resumeKey, resumeFileName and resumeMimeType are required',
                });
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) {
                return res.status(400).json({ success: false, error: 'Invalid applicantEmail format' });
            }
            if (!ALLOWED_RESUME_MIME_TYPES.has(resumeMimeType)) {
                return res.status(400).json({ success: false, error: 'Unsupported resume file type' });
            }
            if (!Number.isFinite(resumeSize) || resumeSize <= 0 || resumeSize > 10 * 1024 * 1024) {
                return res.status(400).json({ success: false, error: 'resumeSize must be between 1 byte and 10MB' });
            }
            const nowIso = new Date().toISOString();
            const application = {
                id: `jobapp-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`,
                jobId,
                companyId: String(job.companyId || ''),
                applicantUserId: currentUserId,
                applicantName,
                applicantEmail,
                applicantPhone,
                coverLetter,
                portfolioUrl,
                resumeKey,
                resumeFileName,
                resumeMimeType,
                resumeSize,
                status: 'submitted',
                createdAt: nowIso,
                updatedAt: nowIso,
                reviewedByUserId: null,
                reviewedAt: null,
                statusNote: null,
            };
            yield db.collection(JOB_APPLICATIONS_COLLECTION).insertOne(application);
            yield db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $inc: { applicationCount: 1 }, $set: { updatedAt: nowIso } });
            // Fire-and-forget: notify company owner/admin reviewers by email with a secure portal link.
            sendApplicationReviewEmails(db, {
                companyId: String(job.companyId || ''),
                jobId,
                application,
                job,
            }).catch((emailError) => {
                console.error('Job application review email dispatch error:', emailError);
            });
            return res.status(201).json({
                success: true,
                data: toApplicationResponse(application),
            });
        }
        catch (error) {
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
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { jobId } = req.params;
            const db = (0, db_1.getDB)();
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            if (!job) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const access = yield resolveOwnerAdminCompanyAccess(String(job.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const status = readString(req.query.status, 40).toLowerCase();
            if (status && !ALLOWED_APPLICATION_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid application status filter' });
            }
            const pagination = getPagination(req.query);
            const searchRegex = sanitizeSearchRegex(readString(req.query.q, 100));
            const filter = { jobId };
            if (status)
                filter.status = status;
            if (searchRegex) {
                filter.$or = [
                    { applicantName: searchRegex },
                    { applicantEmail: searchRegex },
                ];
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
                data: items.map(toApplicationResponse),
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
            const allowed = yield canReadApplication(application, currentUserId);
            if (!allowed) {
                return res.status(403).json({ success: false, error: 'Unauthorized to view this application' });
            }
            return res.json({ success: true, data: toApplicationResponse(application) });
        }
        catch (error) {
            console.error('Get job application error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch application' });
        }
    }),
    // PATCH /api/applications/:applicationId/status
    updateJobApplicationStatus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { applicationId } = req.params;
            const nextStatus = readString((_b = req.body) === null || _b === void 0 ? void 0 : _b.status, 40).toLowerCase();
            const statusNote = readStringOrNull((_c = req.body) === null || _c === void 0 ? void 0 : _c.statusNote, 1000);
            if (!ALLOWED_APPLICATION_STATUSES.has(nextStatus) || nextStatus === 'withdrawn') {
                return res.status(400).json({ success: false, error: 'Invalid application status' });
            }
            const db = (0, db_1.getDB)();
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            const access = yield resolveOwnerAdminCompanyAccess(String(application.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const nowIso = new Date().toISOString();
            const updates = {
                status: nextStatus,
                statusNote,
                updatedAt: nowIso,
                reviewedByUserId: currentUserId,
                reviewedAt: nowIso,
            };
            yield db.collection(JOB_APPLICATIONS_COLLECTION).updateOne({ id: applicationId }, { $set: updates });
            const updated = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            return res.json({ success: true, data: toApplicationResponse(updated) });
        }
        catch (error) {
            console.error('Update application status error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update application status' });
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
            const allowed = yield canReadApplication(application, currentUserId);
            if (!allowed) {
                return res.status(403).json({ success: false, error: 'Unauthorized to access this resume' });
            }
            const resumeKey = readString(application.resumeKey, 500);
            if (!resumeKey) {
                return res.status(404).json({ success: false, error: 'Resume key not available for this application' });
            }
            const bucketName = process.env.S3_BUCKET_NAME;
            const client = getS3Client();
            if (!bucketName || !client) {
                return res.status(503).json({
                    success: false,
                    error: 'Resume preview service is not configured',
                });
            }
            const command = new client_s3_1.GetObjectCommand({
                Bucket: bucketName,
                Key: resumeKey,
            });
            const url = yield (0, s3_request_presigner_1.getSignedUrl)(client, command, { expiresIn: 600 });
            return res.json({
                success: true,
                data: {
                    url,
                    expiresIn: 600,
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
            const token = readString((_b = req.body) === null || _b === void 0 ? void 0 : _b.token, 400);
            if (!token) {
                return res.status(400).json({ success: false, error: 'Review token is required' });
            }
            const db = (0, db_1.getDB)();
            const link = yield db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).findOne({
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
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application for this review link was not found' });
            }
            const companyId = readString(application.companyId || link.companyId, 120);
            const access = yield resolveOwnerAdminCompanyAccess(companyId, currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const jobId = readString(application.jobId || link.jobId, 120);
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
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
                    jobTitle: readString(job === null || job === void 0 ? void 0 : job.title, 160),
                    applicantName: readString(application === null || application === void 0 ? void 0 : application.applicantName, 160),
                    status: readString(application === null || application === void 0 ? void 0 : application.status, 40),
                    expiresAt: readString(link === null || link === void 0 ? void 0 : link.expiresAt, 80) || null,
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
            const companyId = readString(req.params.companyId, 120);
            if (!companyId) {
                return res.status(400).json({ success: false, error: 'companyId is required' });
            }
            const access = yield resolveOwnerAdminCompanyAccess(companyId, currentUserId);
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
                ownerType: readString(req.headers['x-identity-type'] || 'user', 20),
                ownerId: readString(req.headers['x-identity-id'] || currentUserId, 120),
            }, req.headers);
            if (!actor || actor.type !== 'user' || actor.id !== currentUserId) {
                return res.status(403).json({ success: false, error: 'This endpoint is only available for personal identity' });
            }
            const pagination = getPagination(req.query);
            const status = readString(req.query.status, 40).toLowerCase();
            if (status && !ALLOWED_APPLICATION_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid application status filter' });
            }
            const db = (0, db_1.getDB)();
            const filter = {
                applicantUserId: currentUserId,
            };
            if (status)
                filter.status = status;
            const [items, total] = yield Promise.all([
                db.collection(JOB_APPLICATIONS_COLLECTION)
                    .find(filter)
                    .sort({ createdAt: -1 })
                    .skip(pagination.skip)
                    .limit(pagination.limit)
                    .toArray(),
                db.collection(JOB_APPLICATIONS_COLLECTION).countDocuments(filter),
            ]);
            const jobIds = Array.from(new Set(items
                .map((item) => String((item === null || item === void 0 ? void 0 : item.jobId) || '').trim())
                .filter((id) => id.length > 0)));
            const jobs = yield db.collection(JOBS_COLLECTION).find({ id: { $in: jobIds } }).toArray();
            const jobsById = new Map(jobs.map((job) => [String(job.id), job]));
            const companyIds = Array.from(new Set(jobs
                .map((job) => String((job === null || job === void 0 ? void 0 : job.companyId) || '').trim())
                .filter((id) => id.length > 0)));
            const companies = yield db.collection(COMPANIES_COLLECTION)
                .find({ id: { $in: companyIds }, legacyArchived: { $ne: true } })
                .project({ id: 1, name: 1, handle: 1, avatar: 1, avatarType: 1 })
                .toArray();
            const companiesById = new Map(companies.map((company) => [String(company.id), company]));
            const data = items.map((application) => {
                const job = jobsById.get(String(application.jobId || ''));
                const company = companiesById.get(String((job === null || job === void 0 ? void 0 : job.companyId) || ''));
                return Object.assign(Object.assign({}, toApplicationResponse(application)), { job: job ? toJobResponse(job) : null, company: company
                        ? {
                            id: String(company.id || ''),
                            name: String(company.name || ''),
                            handle: String(company.handle || ''),
                            avatar: String(company.avatar || ''),
                            avatarType: String(company.avatarType || 'image'),
                        }
                        : null });
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
            const nowIso = new Date().toISOString();
            yield db.collection(JOB_APPLICATIONS_COLLECTION).updateOne({ id: applicationId }, {
                $set: {
                    status: 'withdrawn',
                    updatedAt: nowIso,
                    statusNote: readStringOrNull((_b = req.body) === null || _b === void 0 ? void 0 : _b.statusNote, 1000),
                },
            });
            const updated = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            return res.json({ success: true, data: toApplicationResponse(updated) });
        }
        catch (error) {
            console.error('Withdraw application error:', error);
            return res.status(500).json({ success: false, error: 'Failed to withdraw application' });
        }
    }),
};
