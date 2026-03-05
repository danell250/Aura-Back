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
const roomNames_1 = require("../realtime/roomNames");
const jobSkillGapService_1 = require("../services/jobSkillGapService");
const companyJobAnalyticsService_1 = require("../services/companyJobAnalyticsService");
const jobApplicationReviewService_1 = require("../services/jobApplicationReviewService");
const jobSyndicationService_1 = require("../services/jobSyndicationService");
const resumeParsingService_1 = require("../services/resumeParsingService");
const resumeEnrichmentQueueService_1 = require("../services/resumeEnrichmentQueueService");
const userBadgeService_1 = require("../services/userBadgeService");
const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const JOB_APPLICATION_NOTES_COLLECTION = 'application_notes';
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
const MAX_NETWORK_COUNT_SCAN_IDS = 5000;
const MAX_NETWORK_COUNT_QUERY_BATCH_SIZE = 500;
const JOB_SKILL_GAP_TIMEOUT_MS = 180;
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
const resolveJobSkillGap = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = readString(params.currentUserId, 120);
    if (!currentUserId)
        return null;
    const supportsTimeoutSignal = typeof AbortSignal !== 'undefined' &&
        typeof AbortSignal.timeout === 'function';
    const signal = supportsTimeoutSignal
        ? AbortSignal.timeout(JOB_SKILL_GAP_TIMEOUT_MS)
        : undefined;
    try {
        return yield (0, jobSkillGapService_1.buildJobSkillGap)({
            db: params.db,
            currentUserId,
            viewer: params.viewer,
            job: params.job,
            signal,
        });
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.name) === 'AbortError')
            return null;
        console.warn('Job skill gap analysis error:', error);
        return null;
    }
});
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
const escapeRegexPattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sanitizeSearchRegex = (raw) => {
    const trimmed = readString(raw, 100);
    if (!trimmed)
        return null;
    const escaped = escapeRegexPattern(trimmed);
    return new RegExp(escaped, 'i');
};
const normalizeSlugValue = (value, maxLength = 220) => {
    const raw = readString(String(value || ''), maxLength)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (!raw)
        return '';
    return raw
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
};
const parseDelimitedAllowedValues = (raw, allowed) => raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0 && allowed.has(item));
let jobsTextIndexEnsured = false;
const ensureJobsTextIndex = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (jobsTextIndexEnsured)
        return true;
    try {
        yield db.collection(JOBS_COLLECTION).createIndex({
            title: 'text',
            summary: 'text',
            description: 'text',
            locationText: 'text',
            companyName: 'text',
            companyHandle: 'text',
            tags: 'text',
        }, {
            name: 'jobs_public_search_text_idx',
            weights: {
                title: 10,
                companyName: 8,
                tags: 6,
                summary: 4,
                description: 2,
                locationText: 2,
                companyHandle: 1,
            },
        });
        jobsTextIndexEnsured = true;
        return true;
    }
    catch (error) {
        const message = String((error === null || error === void 0 ? void 0 : error.message) || '').toLowerCase();
        if (message.includes('already exists') ||
            message.includes('index with name') ||
            message.includes('equivalent index already exists')) {
            jobsTextIndexEnsured = true;
            return true;
        }
        console.error('Failed to ensure jobs text index:', error);
        return false;
    }
});
const buildPublicJobsQuerySpec = (params) => {
    const workModels = params.workModelRaw
        ? parseDelimitedAllowedValues(params.workModelRaw, ALLOWED_WORK_MODELS)
        : [];
    const employmentTypes = params.employmentTypeRaw
        ? parseDelimitedAllowedValues(params.employmentTypeRaw, ALLOWED_EMPLOYMENT_TYPES)
        : [];
    const locationRegex = sanitizeSearchRegex(params.locationRaw);
    const searchText = readString(params.searchRaw, 120);
    const andClauses = [];
    if (params.status === 'all') {
        andClauses.push({ status: { $ne: 'archived' } });
    }
    else {
        andClauses.push({ status: params.status });
    }
    if (workModels.length > 0) {
        andClauses.push({ workModel: { $in: workModels } });
    }
    if (employmentTypes.length > 0) {
        andClauses.push({ employmentType: { $in: employmentTypes } });
    }
    if (locationRegex) {
        andClauses.push({ locationText: locationRegex });
    }
    if (Number.isFinite(params.minSalary) && params.minSalary > 0) {
        andClauses.push({
            $or: [
                { salaryMax: { $gte: params.minSalary } },
                { salaryMin: { $gte: params.minSalary } },
            ],
        });
    }
    const usesTextSearch = searchText.length > 0 && params.allowTextSearch;
    if (usesTextSearch) {
        andClauses.push({ $text: { $search: searchText } });
    }
    const filter = andClauses.length === 1
        ? andClauses[0]
        : andClauses.length > 1
            ? { $and: andClauses }
            : {};
    const sortByNormalized = readString(params.sortBy, 40).toLowerCase();
    const sort = sortByNormalized === 'salary_desc'
        ? Object.assign(Object.assign({ salaryMax: -1, salaryMin: -1 }, (usesTextSearch ? { score: { $meta: 'textScore' } } : {})), { publishedAt: -1, createdAt: -1 }) : sortByNormalized === 'salary_asc'
        ? Object.assign(Object.assign({ salaryMin: 1, salaryMax: 1 }, (usesTextSearch ? { score: { $meta: 'textScore' } } : {})), { publishedAt: -1, createdAt: -1 }) : usesTextSearch
        ? { score: { $meta: 'textScore' }, publishedAt: -1, createdAt: -1 }
        : { publishedAt: -1, createdAt: -1 };
    return {
        filter: filter,
        sort,
        usesTextSearch,
        searchText,
    };
};
const slugifySegment = (value, maxLength = 80) => {
    const normalized = readString(String(value || ''), 240)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized.slice(0, maxLength).replace(/-+$/g, '');
};
const buildJobSlug = (job) => {
    const titlePart = slugifySegment(job === null || job === void 0 ? void 0 : job.title, 90);
    const locationPart = slugifySegment(job === null || job === void 0 ? void 0 : job.locationText, 70);
    const companyPart = slugifySegment((job === null || job === void 0 ? void 0 : job.companyName) || (job === null || job === void 0 ? void 0 : job.companyHandle), 70);
    const parts = [titlePart, locationPart || companyPart].filter((part) => part.length > 0);
    return parts.join('-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
};
const buildPersistentJobSlug = (job) => {
    if (!job || typeof job !== 'object')
        return 'job';
    const stored = normalizeSlugValue(job === null || job === void 0 ? void 0 : job.slug, 220);
    if (stored)
        return stored;
    const baseSlug = buildJobSlug(job) || 'job';
    const idSlug = slugifySegment(job === null || job === void 0 ? void 0 : job.id, 120);
    const rawSlug = idSlug ? `${baseSlug}--${idSlug}` : baseSlug;
    return normalizeSlugValue(rawSlug, 220) || 'job';
};
const normalizeExternalUrl = (value) => {
    const raw = readString(String(value || ''), 600);
    if (!raw)
        return null;
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const parsed = new URL(withProtocol);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return null;
        return parsed.toString();
    }
    catch (_a) {
        return null;
    }
};
const normalizeEmailAddress = (value) => {
    const raw = readString(String(value || ''), 200).toLowerCase();
    if (!raw)
        return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))
        return null;
    return raw;
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
const incrementApplicantApplicationCount = (db, userId, nowIso) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const updateResult = yield db.collection(USERS_COLLECTION).findOneAndUpdate({ id: userId }, {
            $inc: { jobApplicationsCount: 1 },
            $set: { updatedAt: nowIso },
        }, {
            returnDocument: 'after',
            projection: { jobApplicationsCount: 1 },
        });
        const updatedUser = (_a = updateResult === null || updateResult === void 0 ? void 0 : updateResult.value) !== null && _a !== void 0 ? _a : updateResult;
        const parsedCount = Number(updatedUser === null || updatedUser === void 0 ? void 0 : updatedUser.jobApplicationsCount);
        return Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : null;
    }
    catch (counterError) {
        console.error('Increment user jobApplicationsCount error:', counterError);
        return null;
    }
});
const emitNewApplicationEvent = (req, params) => {
    const io = req.app.get('io');
    const targetCompanyId = readString(params.companyId, 120);
    if (!io || !targetCompanyId)
        return;
    io.to((0, roomNames_1.getCompanyApplicationRoom)(targetCompanyId)).emit('new_application', {
        applicationId: params.applicationId,
        jobTitle: params.jobTitle,
        applicantName: params.applicantName,
        companyId: targetCompanyId,
        createdAt: params.createdAt,
    });
};
const scheduleApplicationPostCreateEffects = (params) => {
    var _a;
    void (0, userBadgeService_1.awardApplicationMilestoneBadges)({
        db: params.db,
        userId: params.currentUserId,
        applicationId: params.application.id,
        applicationCount: (_a = params.applicantApplicationCount) !== null && _a !== void 0 ? _a : undefined,
    }).catch((badgeError) => {
        console.error('Award application milestone badges error:', badgeError);
    });
    emitNewApplicationEvent(params.req, {
        companyId: String(params.job.companyId || ''),
        applicationId: String(params.application.id || ''),
        jobTitle: String(params.job.title || ''),
        applicantName: String(params.application.applicantName || ''),
        createdAt: params.nowIso,
    });
    // Fire-and-forget: notify company owner/admin reviewers by email with a secure portal link.
    (0, jobApplicationReviewService_1.queueJobApplicationReviewEmails)({
        db: params.db,
        companyId: String(params.job.companyId || ''),
        jobId: params.jobId,
        application: params.application,
        job: params.job,
    }).catch((emailError) => {
        console.error('Job application review email dispatch error:', emailError);
    });
    setImmediate(() => {
        (0, resumeEnrichmentQueueService_1.enqueueResumeEnrichmentJob)(() => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            yield (0, resumeParsingService_1.enrichUserProfileFromResume)({
                db: params.db,
                userId: params.currentUserId,
                resumeKey: readString((_a = params.application) === null || _a === void 0 ? void 0 : _a.resumeKey, 600),
                resumeMimeType: readString((_b = params.application) === null || _b === void 0 ? void 0 : _b.resumeMimeType, 120).toLowerCase(),
                resumeFileName: readString((_c = params.application) === null || _c === void 0 ? void 0 : _c.resumeFileName, 200),
                source: 'job_application_submission',
            });
        }));
    });
};
const toJobResponse = (job) => ({
    id: String((job === null || job === void 0 ? void 0 : job.id) || ''),
    slug: buildPersistentJobSlug(job),
    companyId: String((job === null || job === void 0 ? void 0 : job.companyId) || ''),
    companyName: String((job === null || job === void 0 ? void 0 : job.companyName) || ''),
    companyHandle: String((job === null || job === void 0 ? void 0 : job.companyHandle) || ''),
    companyIsVerified: Boolean(job === null || job === void 0 ? void 0 : job.companyIsVerified),
    companyWebsite: readStringOrNull(job === null || job === void 0 ? void 0 : job.companyWebsite, 600),
    companyEmail: readStringOrNull(job === null || job === void 0 ? void 0 : job.companyEmail, 200),
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
    applicationUrl: readStringOrNull(job === null || job === void 0 ? void 0 : job.applicationUrl, 600),
    applicationEmail: readStringOrNull(job === null || job === void 0 ? void 0 : job.applicationEmail, 200),
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
    // GET /api/jobs
    listPublicJobs: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit: 20, total: 0, pages: 0 },
                });
            }
            const db = (0, db_1.getDB)();
            const statusRaw = readString(req.query.status, 40).toLowerCase() || 'open';
            const status = statusRaw === 'all' ? 'all' : statusRaw;
            if (status !== 'all' && !ALLOWED_JOB_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status filter' });
            }
            const workModelRaw = readString(req.query.workModel, 80).toLowerCase();
            const employmentTypeRaw = readString(req.query.employmentType, 80).toLowerCase();
            const locationRaw = readString(req.query.location, 100);
            const searchRaw = readString(req.query.q, 120);
            const minSalary = Number(req.query.salaryMin);
            const sortBy = readString(req.query.sort, 40).toLowerCase() || 'latest';
            const pagination = getPagination(req.query);
            const allowTextSearch = yield ensureJobsTextIndex(db);
            if (searchRaw && !allowTextSearch) {
                return res.status(503).json({
                    success: false,
                    error: 'Search index is warming up. Please retry in a moment.',
                });
            }
            const querySpec = buildPublicJobsQuerySpec({
                status,
                workModelRaw,
                employmentTypeRaw,
                locationRaw,
                searchRaw,
                minSalary,
                sortBy,
                allowTextSearch,
            });
            const [items, total] = yield Promise.all([
                db.collection(JOBS_COLLECTION)
                    .find(querySpec.filter, querySpec.usesTextSearch
                    ? {
                        projection: { score: { $meta: 'textScore' } },
                    }
                    : undefined)
                    .sort(querySpec.sort)
                    .skip(pagination.skip)
                    .limit(pagination.limit)
                    .toArray(),
                db.collection(JOBS_COLLECTION).countDocuments(querySpec.filter),
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
            console.error('List public jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
        }
    }),
    // GET /api/partner/jobs
    getJobsForSyndication: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const db = (0, db_1.getDB)();
            const limit = parsePositiveInt((_a = req.query) === null || _a === void 0 ? void 0 : _a.limit, 100, 1, 250);
            const statusRaw = readString((_b = req.query) === null || _b === void 0 ? void 0 : _b.status, 40).toLowerCase();
            const status = statusRaw || 'open';
            const filter = {};
            if (status === 'all') {
                filter.status = { $ne: 'archived' };
            }
            else if (ALLOWED_JOB_STATUSES.has(status)) {
                filter.status = status;
            }
            else {
                return res.status(400).json({ success: false, error: 'Invalid status filter' });
            }
            const jobs = yield db.collection(JOBS_COLLECTION)
                .find(filter)
                .sort({ publishedAt: -1, createdAt: -1 })
                .limit(limit)
                .toArray();
            const feed = (0, jobSyndicationService_1.buildJobsSyndicationFeed)(jobs.map(toJobResponse));
            res.setHeader('Content-Type', 'application/feed+json; charset=utf-8');
            return res.status(200).json(feed);
        }
        catch (error) {
            console.error('Get jobs for syndication error:', error);
            return res.status(500).json({ success: false, error: 'Failed to build jobs syndication feed' });
        }
    }),
    // GET /api/jobs/salary-insights
    getSalaryInsights: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const jobTitle = readString(req.query.jobTitle, 140);
            const location = readString(req.query.location, 140);
            if (!jobTitle || !location) {
                return res.status(400).json({ success: false, error: 'jobTitle and location are required' });
            }
            const db = (0, db_1.getDB)();
            const allowTextSearch = yield ensureJobsTextIndex(db);
            if (!allowTextSearch) {
                return res.status(503).json({
                    success: false,
                    error: 'Search index is warming up. Please retry in a moment.',
                });
            }
            const searchText = `${jobTitle} ${location}`.trim();
            const missingMinSentinel = Number.MAX_SAFE_INTEGER;
            const missingMaxSentinel = -1;
            const [aggregated] = yield db.collection(JOBS_COLLECTION)
                .aggregate([
                {
                    $match: {
                        status: 'open',
                        $text: { $search: searchText },
                        $or: [
                            { salaryMin: { $type: 'number' } },
                            { salaryMax: { $type: 'number' } },
                        ],
                    },
                },
                {
                    $group: {
                        _id: null,
                        sampleSize: { $sum: 1 },
                        avgMin: {
                            $avg: {
                                $cond: [{ $isNumber: '$salaryMin' }, '$salaryMin', null],
                            },
                        },
                        avgMax: {
                            $avg: {
                                $cond: [{ $isNumber: '$salaryMax' }, '$salaryMax', null],
                            },
                        },
                        minSalaryCandidate: {
                            $min: {
                                $cond: [{ $isNumber: '$salaryMin' }, '$salaryMin', missingMinSentinel],
                            },
                        },
                        maxSalaryCandidate: {
                            $max: {
                                $cond: [{ $isNumber: '$salaryMax' }, '$salaryMax', missingMaxSentinel],
                            },
                        },
                    },
                },
                {
                    $project: {
                        sampleSize: 1,
                        avgMin: 1,
                        avgMax: 1,
                        minSalary: {
                            $cond: [{ $eq: ['$minSalaryCandidate', missingMinSentinel] }, null, '$minSalaryCandidate'],
                        },
                        maxSalary: {
                            $cond: [{ $eq: ['$maxSalaryCandidate', missingMaxSentinel] }, null, '$maxSalaryCandidate'],
                        },
                    },
                },
            ])
                .toArray();
            return res.json({
                success: true,
                data: {
                    sampleSize: Number.isFinite(aggregated === null || aggregated === void 0 ? void 0 : aggregated.sampleSize) ? Number(aggregated.sampleSize) : 0,
                    avgMin: Number.isFinite(aggregated === null || aggregated === void 0 ? void 0 : aggregated.avgMin) ? Number(aggregated.avgMin) : null,
                    avgMax: Number.isFinite(aggregated === null || aggregated === void 0 ? void 0 : aggregated.avgMax) ? Number(aggregated.avgMax) : null,
                    minSalary: Number.isFinite(aggregated === null || aggregated === void 0 ? void 0 : aggregated.minSalary) ? Number(aggregated.minSalary) : null,
                    maxSalary: Number.isFinite(aggregated === null || aggregated === void 0 ? void 0 : aggregated.maxSalary) ? Number(aggregated.maxSalary) : null,
                },
            });
        }
        catch (error) {
            console.error('Get salary insights error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch salary insights' });
        }
    }),
    // GET /api/jobs/slug/:jobSlug
    getJobBySlug: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const rawRequestedSlug = readString(req.params.jobSlug, 220).toLowerCase();
            const requestedSlug = normalizeSlugValue(rawRequestedSlug, 220);
            if (!requestedSlug) {
                return res.status(400).json({ success: false, error: 'Invalid job slug' });
            }
            const db = (0, db_1.getDB)();
            const currentUserId = readString((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            const slugIdMatch = rawRequestedSlug.match(/(?:^|--)(job-[a-z0-9-]+)$/i);
            const slugJobId = (slugIdMatch === null || slugIdMatch === void 0 ? void 0 : slugIdMatch[1]) || '';
            if (slugJobId) {
                const byId = yield db.collection(JOBS_COLLECTION).findOne({ id: slugJobId, status: { $ne: 'archived' } });
                if (byId) {
                    const skillGap = currentUserId
                        ? yield resolveJobSkillGap({
                            db,
                            currentUserId,
                            viewer: req.user,
                            job: byId,
                        })
                        : null;
                    return res.json({
                        success: true,
                        data: Object.assign(Object.assign({}, toJobResponse(byId)), (skillGap ? { skillGap } : {})),
                    });
                }
            }
            const bySlug = yield db.collection(JOBS_COLLECTION).findOne({
                slug: requestedSlug,
                status: { $ne: 'archived' },
            });
            if (!bySlug) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const skillGap = currentUserId
                ? yield resolveJobSkillGap({
                    db,
                    currentUserId,
                    viewer: req.user,
                    job: bySlug,
                })
                : null;
            return res.json({
                success: true,
                data: Object.assign(Object.assign({}, toJobResponse(bySlug)), (skillGap ? { skillGap } : {})),
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
            const currentUserId = readString((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            if (!job || job.status === 'archived') {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const skillGap = currentUserId
                ? yield resolveJobSkillGap({
                    db,
                    currentUserId,
                    viewer: req.user,
                    job,
                })
                : null;
            return res.json({
                success: true,
                data: Object.assign(Object.assign({}, toJobResponse(job)), (skillGap ? { skillGap } : {})),
            });
        }
        catch (error) {
            console.error('Get job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch job' });
        }
    }),
    // GET /api/jobs/:jobId/network-count
    getJobNetworkCount: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const jobId = readString(req.params.jobId, 120);
            if (!jobId) {
                return res.status(400).json({ success: false, error: 'jobId is required' });
            }
            const db = (0, db_1.getDB)();
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId, status: { $ne: 'archived' } }, { projection: { id: 1, companyId: 1 } });
            if (!job) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const companyId = readString(job.companyId, 120);
            if (!companyId) {
                return res.json({ success: true, data: { count: 0, companyId: '' } });
            }
            const currentUser = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId }, { projection: { acquaintances: 1 } });
            const acquaintanceIds = Array.isArray(currentUser === null || currentUser === void 0 ? void 0 : currentUser.acquaintances)
                ? Array.from(new Set(currentUser.acquaintances
                    .map((value) => readString(value, 120))
                    .filter((value) => value.length > 0)))
                : [];
            if (acquaintanceIds.length === 0) {
                return res.json({ success: true, data: { count: 0, companyId } });
            }
            const scannedAcquaintanceIds = acquaintanceIds.slice(0, MAX_NETWORK_COUNT_SCAN_IDS);
            const batches = [];
            for (let index = 0; index < scannedAcquaintanceIds.length; index += MAX_NETWORK_COUNT_QUERY_BATCH_SIZE) {
                const batch = scannedAcquaintanceIds.slice(index, index + MAX_NETWORK_COUNT_QUERY_BATCH_SIZE);
                if (batch.length > 0) {
                    batches.push(batch);
                }
            }
            const maxConcurrentBatchQueries = 4;
            const partialCounts = new Array(batches.length);
            let batchCursor = 0;
            const runBatchWorker = () => __awaiter(void 0, void 0, void 0, function* () {
                while (batchCursor < batches.length) {
                    const nextIndex = batchCursor;
                    batchCursor += 1;
                    const batch = batches[nextIndex];
                    partialCounts[nextIndex] = yield db.collection(COMPANY_MEMBERS_COLLECTION).countDocuments({
                        companyId,
                        userId: { $in: batch },
                    });
                }
            });
            yield Promise.all(Array.from({ length: Math.min(maxConcurrentBatchQueries, batches.length) }, () => runBatchWorker()));
            const count = partialCounts.reduce((sum, value) => sum + value, 0);
            return res.json({
                success: true,
                data: {
                    count,
                    companyId,
                },
            });
        }
        catch (error) {
            console.error('Get job network count error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch network count' });
        }
    }),
    // POST /api/jobs
    createJob: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6;
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
            const hasApplicationUrlPayload = ((_p = req.body) === null || _p === void 0 ? void 0 : _p.applicationUrl) !== undefined;
            const hasApplicationEmailPayload = ((_q = req.body) === null || _q === void 0 ? void 0 : _q.applicationEmail) !== undefined;
            const applicationUrl = normalizeExternalUrl((_r = req.body) === null || _r === void 0 ? void 0 : _r.applicationUrl);
            const applicationEmail = normalizeEmailAddress((_s = req.body) === null || _s === void 0 ? void 0 : _s.applicationEmail);
            const announceInFeed = Boolean((_t = req.body) === null || _t === void 0 ? void 0 : _t.announceInFeed);
            if (salaryMin != null && salaryMin < 0) {
                return res.status(400).json({ success: false, error: 'salaryMin cannot be negative' });
            }
            if (salaryMax != null && salaryMax < 0) {
                return res.status(400).json({ success: false, error: 'salaryMax cannot be negative' });
            }
            if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) {
                return res.status(400).json({ success: false, error: 'salaryMax cannot be less than salaryMin' });
            }
            if (hasApplicationUrlPayload && !applicationUrl) {
                return res.status(400).json({ success: false, error: 'applicationUrl must be a valid http(s) URL' });
            }
            if (hasApplicationEmailPayload && !applicationEmail) {
                return res.status(400).json({ success: false, error: 'applicationEmail must be a valid email address' });
            }
            const nowIso = new Date().toISOString();
            const jobId = `job-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
            const job = {
                id: jobId,
                slug: '',
                companyId: actor.id,
                companyName: readString((_u = access.company) === null || _u === void 0 ? void 0 : _u.name, 120) || 'Company',
                companyHandle: readString((_v = access.company) === null || _v === void 0 ? void 0 : _v.handle, 80),
                companyIsVerified: Boolean((_w = access.company) === null || _w === void 0 ? void 0 : _w.isVerified),
                companyWebsite: normalizeExternalUrl((_x = access.company) === null || _x === void 0 ? void 0 : _x.website),
                companyEmail: normalizeEmailAddress((_y = access.company) === null || _y === void 0 ? void 0 : _y.email),
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
                applicationUrl,
                applicationEmail,
                applicationCount: 0,
            };
            job.slug = buildPersistentJobSlug(job);
            const db = (0, db_1.getDB)();
            let announcementPostId = null;
            if (announceInFeed) {
                const nowTimestamp = Date.now();
                const postId = `post-job-${nowTimestamp}-${crypto_1.default.randomBytes(4).toString('hex')}`;
                const announcementContent = buildJobAnnouncementContent({
                    title,
                    companyName: readString((_z = access.company) === null || _z === void 0 ? void 0 : _z.name, 120) || 'Company',
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
                        firstName: readString((_0 = access.company) === null || _0 === void 0 ? void 0 : _0.name, 120) || 'Company',
                        lastName: '',
                        name: readString((_1 = access.company) === null || _1 === void 0 ? void 0 : _1.name, 120) || 'Company',
                        handle: readString((_2 = access.company) === null || _2 === void 0 ? void 0 : _2.handle, 80) || '',
                        avatar: readString((_3 = access.company) === null || _3 === void 0 ? void 0 : _3.avatar, 500) || '',
                        avatarKey: readString((_4 = access.company) === null || _4 === void 0 ? void 0 : _4.avatarKey, 500) || '',
                        avatarType: ((_5 = access.company) === null || _5 === void 0 ? void 0 : _5.avatarType) === 'video' ? 'video' : 'image',
                        activeGlow: ((_6 = access.company) === null || _6 === void 0 ? void 0 : _6.activeGlow) || 'none',
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
            if (req.body.applicationUrl !== undefined) {
                const parsedUrl = normalizeExternalUrl(req.body.applicationUrl);
                const raw = readString(String(req.body.applicationUrl || ''), 600);
                if (raw && !parsedUrl) {
                    return res.status(400).json({ success: false, error: 'applicationUrl must be a valid http(s) URL' });
                }
                updates.applicationUrl = parsedUrl;
            }
            if (req.body.applicationEmail !== undefined) {
                const parsedEmail = normalizeEmailAddress(req.body.applicationEmail);
                const raw = readString(String(req.body.applicationEmail || ''), 200);
                if (raw && !parsedEmail) {
                    return res.status(400).json({ success: false, error: 'applicationEmail must be a valid email address' });
                }
                updates.applicationEmail = parsedEmail;
            }
            if (req.body.tags !== undefined) {
                updates.tags = readStringList(req.body.tags, 10, 40);
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ success: false, error: 'No valid fields to update' });
            }
            if (!normalizeSlugValue(existingJob === null || existingJob === void 0 ? void 0 : existingJob.slug, 220)) {
                updates.slug = buildPersistentJobSlug(Object.assign(Object.assign(Object.assign({}, existingJob), updates), { id: existingJob.id }));
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
    // POST /api/jobs/:jobId/applications
    createJobApplication: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
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
            const useProfile = Boolean((_b = req.body) === null || _b === void 0 ? void 0 : _b.useProfile);
            const profileUser = useProfile
                ? yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId }, {
                    projection: {
                        firstName: 1,
                        lastName: 1,
                        name: 1,
                        email: 1,
                        defaultResumeKey: 1,
                        defaultResumeFileName: 1,
                        defaultResumeMimeType: 1,
                        defaultResumeSize: 1,
                    },
                })
                : null;
            let applicantName = readString((_c = req.body) === null || _c === void 0 ? void 0 : _c.applicantName, 120);
            let applicantEmail = readString((_d = req.body) === null || _d === void 0 ? void 0 : _d.applicantEmail, 160).toLowerCase();
            const applicantPhone = readStringOrNull((_e = req.body) === null || _e === void 0 ? void 0 : _e.applicantPhone, 40);
            const coverLetter = readStringOrNull((_f = req.body) === null || _f === void 0 ? void 0 : _f.coverLetter, 5000);
            const portfolioUrl = readStringOrNull((_g = req.body) === null || _g === void 0 ? void 0 : _g.portfolioUrl, 300);
            let resumeKey = readString((_h = req.body) === null || _h === void 0 ? void 0 : _h.resumeKey, 500);
            let resumeFileName = readString((_j = req.body) === null || _j === void 0 ? void 0 : _j.resumeFileName, 200);
            let resumeMimeType = readString((_k = req.body) === null || _k === void 0 ? void 0 : _k.resumeMimeType, 120);
            let resumeSize = Number((_l = req.body) === null || _l === void 0 ? void 0 : _l.resumeSize);
            if (profileUser) {
                const derivedProfileName = `${readString(profileUser === null || profileUser === void 0 ? void 0 : profileUser.firstName, 80)} ${readString(profileUser === null || profileUser === void 0 ? void 0 : profileUser.lastName, 80)}`.trim()
                    || readString(profileUser === null || profileUser === void 0 ? void 0 : profileUser.name, 120);
                const derivedProfileEmail = readString(profileUser === null || profileUser === void 0 ? void 0 : profileUser.email, 160).toLowerCase();
                if (derivedProfileName) {
                    applicantName = derivedProfileName;
                }
                if (derivedProfileEmail) {
                    applicantEmail = derivedProfileEmail;
                }
                const defaultResumeKey = readString(profileUser === null || profileUser === void 0 ? void 0 : profileUser.defaultResumeKey, 500);
                if (defaultResumeKey) {
                    resumeKey = defaultResumeKey;
                    resumeFileName = readString(profileUser === null || profileUser === void 0 ? void 0 : profileUser.defaultResumeFileName, 200);
                    resumeMimeType = readString(profileUser === null || profileUser === void 0 ? void 0 : profileUser.defaultResumeMimeType, 120);
                    resumeSize = Number(profileUser === null || profileUser === void 0 ? void 0 : profileUser.defaultResumeSize);
                }
            }
            if (useProfile && (!resumeKey || !resumeFileName || !resumeMimeType || !Number.isFinite(resumeSize) || resumeSize <= 0)) {
                return res.status(400).json({
                    success: false,
                    error: 'No default resume found on your Aura profile. Add one in your profile and retry.',
                });
            }
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
            const nowDate = new Date(nowIso);
            const application = {
                id: `jobapp-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`,
                jobId,
                companyId: String(job.companyId || ''),
                jobTitleSnapshot: readString(job.title, 180) || null,
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
                createdAtDate: nowDate,
                updatedAt: nowIso,
                updatedAtDate: nowDate,
                reviewedByUserId: null,
                reviewedAt: null,
                reviewedAtDate: null,
                statusNote: null,
            };
            yield db.collection(JOB_APPLICATIONS_COLLECTION).insertOne(application);
            yield db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $inc: { applicationCount: 1 }, $set: { updatedAt: nowIso } });
            (0, companyJobAnalyticsService_1.invalidateCompanyJobAnalyticsCache)(String(job.companyId || ''));
            const applicantApplicationCount = yield incrementApplicantApplicationCount(db, currentUserId, nowIso);
            scheduleApplicationPostCreateEffects({
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
    // GET /api/companies/:companyId/job-analytics
    getJobAnalytics: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({ success: true, data: companyJobAnalyticsService_1.EMPTY_COMPANY_JOB_ANALYTICS });
            }
            const currentUserId = readString((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
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
            const nowDate = new Date(nowIso);
            yield db.collection(JOB_APPLICATIONS_COLLECTION).updateOne({ id: applicationId }, {
                $set: {
                    status: 'withdrawn',
                    updatedAt: nowIso,
                    updatedAtDate: nowDate,
                    statusNote: readStringOrNull((_b = req.body) === null || _b === void 0 ? void 0 : _b.statusNote, 1000),
                },
            });
            (0, companyJobAnalyticsService_1.invalidateCompanyJobAnalyticsCache)(String(application.companyId || ''));
            const updated = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId });
            return res.json({ success: true, data: toApplicationResponse(updated) });
        }
        catch (error) {
            console.error('Withdraw application error:', error);
            return res.status(500).json({ success: false, error: 'Failed to withdraw application' });
        }
    }),
};
