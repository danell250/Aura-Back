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
exports.jobsController = exports.registerJobViewCountShutdownHooks = exports.toApplicationResponse = exports.toJobResponse = exports.buildPublicJobsQuerySpec = exports.ensureJobsTextIndex = exports.sanitizeSearchRegex = exports.hashSecureToken = exports.getPagination = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const identityUtils_1 = require("../utils/identityUtils");
const postsController_1 = require("./postsController");
const hashtagUtils_1 = require("../utils/hashtagUtils");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobSkillGapService_1 = require("../services/jobSkillGapService");
const jobRecommendationService_1 = require("../services/jobRecommendationService");
const companyJobAnalyticsService_1 = require("../services/companyJobAnalyticsService");
const jobApplicationLifecycleService_1 = require("../services/jobApplicationLifecycleService");
const jobPulseService_1 = require("../services/jobPulseService");
const jobPulseSnapshotService_1 = require("../services/jobPulseSnapshotService");
const reverseJobMatchService_1 = require("../services/reverseJobMatchService");
const jobRecommendationProfileCacheService_1 = require("../services/jobRecommendationProfileCacheService");
const userBadgeService_1 = require("../services/userBadgeService");
const contactNormalization_1 = require("../utils/contactNormalization");
const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const JOB_APPLICATION_NOTES_COLLECTION = 'application_notes';
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
const JOB_SKILL_GAP_TIMEOUT_MS = 180;
const CAREER_PAGE_SOURCE_SITES = new Set(['greenhouse', 'lever', 'workday', 'smartrecruiters', 'careers']);
const JOB_VIEW_FLUSH_INTERVAL_MS = 5000;
const JOB_VIEW_BUFFER_MAX_KEYS = 400;
const JOB_VIEW_FLUSH_BATCH_SIZE = 100;
const JOB_DISCOVERED_WINDOW_MINUTES = 30;
const JOB_DISCOVERED_COUNT_CACHE_TTL_MS = 60000;
const JOB_DISCOVERED_COUNT_CACHE_MAX_KEYS = 200;
const AURA_PUBLIC_WEB_BASE_URL = ((0, inputSanitizers_1.readString)(process.env.AURA_PUBLIC_WEB_URL, 320)
    || (0, inputSanitizers_1.readString)(process.env.FRONTEND_URL, 320)
    || (0, inputSanitizers_1.readString)(process.env.VITE_FRONTEND_URL, 320)
    || 'https://aura.social').replace(/\/+$/, '');
const readStringList = (value, maxItems = 10, maxLength = 40) => {
    if (!Array.isArray(value))
        return [];
    const deduped = new Set();
    const next = [];
    for (const item of value) {
        const normalized = (0, inputSanitizers_1.readString)(item, maxLength).toLowerCase();
        if (!normalized || deduped.has(normalized))
            continue;
        deduped.add(normalized);
        next.push(normalized);
        if (next.length >= maxItems)
            break;
    }
    return next;
};
const getPagination = (query) => {
    const page = (0, inputSanitizers_1.parsePositiveInt)(query.page, 1, 1, 100000);
    const limit = (0, inputSanitizers_1.parsePositiveInt)(query.limit, 20, 1, 100);
    return {
        page,
        limit,
        skip: (page - 1) * limit,
    };
};
exports.getPagination = getPagination;
const resolveJobSkillGap = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
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
    const asString = (0, inputSanitizers_1.readString)(String(value), 100);
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
exports.hashSecureToken = hashSecureToken;
const escapeRegexPattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sanitizeSearchRegex = (raw) => {
    const trimmed = (0, inputSanitizers_1.readString)(raw, 100);
    if (!trimmed)
        return null;
    const escaped = escapeRegexPattern(trimmed);
    return new RegExp(escaped, 'i');
};
exports.sanitizeSearchRegex = sanitizeSearchRegex;
const normalizeSlugValue = (value, maxLength = 220) => {
    const raw = (0, inputSanitizers_1.readString)(String(value || ''), maxLength)
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
const parseSourceSite = (value) => {
    const source = (0, inputSanitizers_1.readString)(value, 120).toLowerCase();
    if (!source)
        return '';
    const [, suffix = source] = source.split(':', 2);
    return (0, inputSanitizers_1.readString)(suffix, 120).toLowerCase();
};
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
exports.ensureJobsTextIndex = ensureJobsTextIndex;
const buildPublicJobsQuerySpec = (params) => {
    const workModels = params.workModelRaw
        ? parseDelimitedAllowedValues(params.workModelRaw, ALLOWED_WORK_MODELS)
        : [];
    const employmentTypes = params.employmentTypeRaw
        ? parseDelimitedAllowedValues(params.employmentTypeRaw, ALLOWED_EMPLOYMENT_TYPES)
        : [];
    const locationRegex = (0, exports.sanitizeSearchRegex)(params.locationRaw);
    const companyRegex = (0, exports.sanitizeSearchRegex)(params.companyRaw);
    const searchText = (0, inputSanitizers_1.readString)(params.searchRaw, 120);
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
    if (companyRegex) {
        andClauses.push({ companyName: companyRegex });
    }
    if (Number.isFinite(params.minSalary) && params.minSalary > 0) {
        andClauses.push({
            $or: [
                { salaryMax: { $gte: params.minSalary } },
                { salaryMin: { $gte: params.minSalary } },
            ],
        });
    }
    if (Number.isFinite(params.maxSalary) && params.maxSalary > 0) {
        andClauses.push({
            $or: [
                { salaryMin: { $lte: params.maxSalary } },
                { salaryMax: { $lte: params.maxSalary } },
            ],
        });
    }
    if (Number.isFinite(params.postedWithinHours) && params.postedWithinHours > 0) {
        const thresholdIso = new Date(Date.now() - (params.postedWithinHours * 60 * 60 * 1000)).toISOString();
        andClauses.push({
            $or: [
                { publishedAt: { $gte: thresholdIso } },
                { createdAt: { $gte: thresholdIso } },
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
    const sortByNormalized = (0, inputSanitizers_1.readString)(params.sortBy, 40).toLowerCase();
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
exports.buildPublicJobsQuerySpec = buildPublicJobsQuerySpec;
const slugifySegment = (value, maxLength = 80) => {
    const normalized = (0, inputSanitizers_1.readString)(String(value || ''), 240)
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
const toJobResponse = (job) => ({
    id: String((job === null || job === void 0 ? void 0 : job.id) || ''),
    slug: buildPersistentJobSlug(job),
    source: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.source, 120) || null,
    sourceSite: parseSourceSite(job === null || job === void 0 ? void 0 : job.source) || null,
    isCareerPageSource: CAREER_PAGE_SOURCE_SITES.has(parseSourceSite(job === null || job === void 0 ? void 0 : job.source)),
    companyId: String((job === null || job === void 0 ? void 0 : job.companyId) || ''),
    companyName: String((job === null || job === void 0 ? void 0 : job.companyName) || ''),
    companyHandle: String((job === null || job === void 0 ? void 0 : job.companyHandle) || ''),
    companyIsVerified: Boolean(job === null || job === void 0 ? void 0 : job.companyIsVerified),
    companyWebsite: (0, inputSanitizers_1.readStringOrNull)(job === null || job === void 0 ? void 0 : job.companyWebsite, 600),
    companyEmail: (0, inputSanitizers_1.readStringOrNull)(job === null || job === void 0 ? void 0 : job.companyEmail, 200),
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
    discoveredAt: (job === null || job === void 0 ? void 0 : job.discoveredAt) || null,
    updatedAt: (job === null || job === void 0 ? void 0 : job.updatedAt) || null,
    publishedAt: (job === null || job === void 0 ? void 0 : job.publishedAt) || null,
    announcementPostId: (job === null || job === void 0 ? void 0 : job.announcementPostId) || null,
    applicationUrl: (0, inputSanitizers_1.readStringOrNull)(job === null || job === void 0 ? void 0 : job.applicationUrl, 600),
    applicationEmail: (0, inputSanitizers_1.readStringOrNull)(job === null || job === void 0 ? void 0 : job.applicationEmail, 200),
    applicationCount: Number.isFinite(job === null || job === void 0 ? void 0 : job.applicationCount) ? Number(job.applicationCount) : 0,
    viewCount: Number.isFinite(job === null || job === void 0 ? void 0 : job.viewCount) ? Number(job.viewCount) : 0,
});
exports.toJobResponse = toJobResponse;
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
exports.toApplicationResponse = toApplicationResponse;
const indexPulseSnapshotsByJobId = (snapshots) => new Map(snapshots.map((snapshot) => [(0, inputSanitizers_1.readString)(snapshot === null || snapshot === void 0 ? void 0 : snapshot.jobId, 120), snapshot]).filter(([jobId]) => jobId.length > 0));
const attachHeatFieldsToJobResponses = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const jobIds = params.jobs
        .map((job) => (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120))
        .filter((jobId) => jobId.length > 0);
    if (jobIds.length === 0)
        return params.jobs;
    const pulseSnapshotsByJobId = indexPulseSnapshotsByJobId(yield (0, jobPulseSnapshotService_1.listJobPulseSnapshots)({
        db: params.db,
        requestedJobIds: jobIds,
        limit: jobIds.length,
    }));
    return params.jobs.map((job) => (Object.assign(Object.assign({}, job), (0, jobPulseSnapshotService_1.buildJobHeatResponseFields)(pulseSnapshotsByJobId.get((0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120))))));
});
const attachHeatFieldsToJobResponse = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const [jobWithHeat] = yield attachHeatFieldsToJobResponses({
        db: params.db,
        jobs: [params.job],
    });
    return jobWithHeat || params.job;
});
const pendingJobViewCount = new Map();
let isJobViewFlushScheduled = false;
let isJobViewShutdownHookRegistered = false;
const discoveredCountCache = new Map();
const takePendingJobViewCountBatch = () => {
    const snapshot = [];
    const iterator = pendingJobViewCount.entries();
    while (snapshot.length < JOB_VIEW_FLUSH_BATCH_SIZE) {
        const next = iterator.next();
        if (next.done)
            break;
        const [jobId, count] = next.value;
        pendingJobViewCount.delete(jobId);
        snapshot.push([jobId, count]);
    }
    return snapshot;
};
const flushJobViewCountBuffer = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (pendingJobViewCount.size === 0)
        return;
    const snapshot = takePendingJobViewCountBatch();
    if (snapshot.length === 0)
        return;
    const operations = snapshot.map(([jobId, count]) => ({
        updateOne: {
            filter: { id: jobId, status: { $ne: 'archived' } },
            update: { $inc: { viewCount: count } },
        },
    }));
    try {
        yield db.collection(JOBS_COLLECTION).bulkWrite(operations, { ordered: false });
    }
    catch (error) {
        for (const [jobId, count] of snapshot) {
            pendingJobViewCount.set(jobId, (pendingJobViewCount.get(jobId) || 0) + count);
        }
        console.warn('Flush job view count buffer error:', error);
    }
    finally {
        if (pendingJobViewCount.size > 0) {
            scheduleJobViewCountFlush(db);
        }
    }
});
const scheduleJobViewCountFlush = (db) => {
    if (isJobViewFlushScheduled)
        return;
    isJobViewFlushScheduled = true;
    setTimeout(() => {
        isJobViewFlushScheduled = false;
        void flushJobViewCountBuffer(db);
    }, JOB_VIEW_FLUSH_INTERVAL_MS);
};
const registerJobViewCountShutdownHooks = (dbProvider = db_1.getDB) => {
    if (isJobViewShutdownHookRegistered)
        return;
    isJobViewShutdownHookRegistered = true;
    const flushOnShutdown = () => {
        if (!(0, db_1.isDBConnected)())
            return;
        void flushJobViewCountBuffer(dbProvider());
    };
    process.once('SIGINT', flushOnShutdown);
    process.once('SIGTERM', flushOnShutdown);
    process.once('beforeExit', flushOnShutdown);
};
exports.registerJobViewCountShutdownHooks = registerJobViewCountShutdownHooks;
const incrementJobViewCountAsync = (db, jobId, userId) => {
    if (!jobId)
        return;
    pendingJobViewCount.set(jobId, (pendingJobViewCount.get(jobId) || 0) + 1);
    const viewEvent = {
        jobId,
        type: 'job_viewed',
        userId,
    };
    (0, jobPulseService_1.recordJobPulseEventAsync)(db, viewEvent);
    if (pendingJobViewCount.size >= JOB_VIEW_BUFFER_MAX_KEYS) {
        void flushJobViewCountBuffer(db);
        return;
    }
    scheduleJobViewCountFlush(db);
};
const withOptimisticViewCount = (job) => (Object.assign(Object.assign({}, job), { viewCount: Number.isFinite(job === null || job === void 0 ? void 0 : job.viewCount)
        ? Number(job.viewCount) + 1
        : 1 }));
const buildDiscoveredWindowFilter = (baseFilter, thresholdIso) => {
    const hasBaseFilter = baseFilter && Object.keys(baseFilter).length > 0;
    const discoveredClause = {
        discoveredAt: {
            $type: 'string',
            $gte: thresholdIso,
        },
    };
    if (!hasBaseFilter)
        return discoveredClause;
    return { $and: [baseFilter, discoveredClause] };
};
const buildDiscoveredCountCacheKey = (parts) => {
    const normalizedParts = Object.entries(parts)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value !== null && value !== void 0 ? value : ''))}`)
        .join('&');
    return crypto_1.default.createHash('sha256').update(normalizedParts).digest('hex');
};
const refreshDiscoveredCountCacheEntry = (cacheKey, entry) => {
    discoveredCountCache.delete(cacheKey);
    discoveredCountCache.set(cacheKey, entry);
};
const storeDiscoveredCountCacheEntry = (cacheKey, entry, now) => {
    refreshDiscoveredCountCacheEntry(cacheKey, entry);
    pruneDiscoveredCountCache(now);
};
const pruneDiscoveredCountCache = (now) => {
    for (const [key, cacheValue] of discoveredCountCache.entries()) {
        if (cacheValue.expiresAt <= now) {
            discoveredCountCache.delete(key);
        }
    }
    while (discoveredCountCache.size > JOB_DISCOVERED_COUNT_CACHE_MAX_KEYS) {
        const oldestEntry = discoveredCountCache.keys().next();
        if (oldestEntry.done)
            break;
        discoveredCountCache.delete(oldestEntry.value);
    }
};
const resolveCachedDiscoveredCount = (db, filter, cacheKey) => __awaiter(void 0, void 0, void 0, function* () {
    const now = Date.now();
    pruneDiscoveredCountCache(now);
    const cached = discoveredCountCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        refreshDiscoveredCountCacheEntry(cacheKey, cached);
        return cached.count;
    }
    const count = yield db.collection(JOBS_COLLECTION).countDocuments(filter);
    storeDiscoveredCountCacheEntry(cacheKey, {
        count,
        expiresAt: now + JOB_DISCOVERED_COUNT_CACHE_TTL_MS,
    }, now);
    return count;
});
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
            if (status !== 'all' && !ALLOWED_JOB_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status filter' });
            }
            const pagination = (0, exports.getPagination)(req.query);
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
                data: items.map(exports.toJobResponse),
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
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit: 20, total: 0, pages: 0 },
                });
            }
            const db = (0, db_1.getDB)();
            const statusRaw = (0, inputSanitizers_1.readString)(req.query.status, 40).toLowerCase() || 'open';
            const status = statusRaw === 'all' ? 'all' : statusRaw;
            if (status !== 'all' && !ALLOWED_JOB_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status filter' });
            }
            const workModelRaw = (0, inputSanitizers_1.readString)(req.query.workModel, 80).toLowerCase();
            const employmentTypeRaw = (0, inputSanitizers_1.readString)(req.query.employmentType, 80).toLowerCase();
            const locationRaw = (0, inputSanitizers_1.readString)(req.query.location, 100);
            const companyRaw = (0, inputSanitizers_1.readString)(req.query.company, 100);
            const searchRaw = (0, inputSanitizers_1.readString)(req.query.q, 120);
            const minSalary = Number(req.query.salaryMin);
            const maxSalary = Number(req.query.salaryMax);
            const postedWithinHours = Number(req.query.postedWithinHours);
            const sortBy = (0, inputSanitizers_1.readString)(req.query.sort, 40).toLowerCase() || 'latest';
            const pagination = (0, exports.getPagination)(req.query);
            if (Number.isFinite(minSalary) && Number.isFinite(maxSalary) && minSalary > 0 && maxSalary > 0 && maxSalary < minSalary) {
                return res.status(400).json({ success: false, error: 'salaryMax cannot be less than salaryMin' });
            }
            const allowTextSearch = yield (0, exports.ensureJobsTextIndex)(db);
            if (searchRaw && !allowTextSearch) {
                return res.status(503).json({
                    success: false,
                    error: 'Search index is warming up. Please retry in a moment.',
                });
            }
            const querySpec = (0, exports.buildPublicJobsQuerySpec)({
                status,
                workModelRaw,
                employmentTypeRaw,
                locationRaw,
                companyRaw,
                searchRaw,
                minSalary,
                maxSalary,
                postedWithinHours,
                sortBy,
                allowTextSearch,
            });
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            const recommendationProfilePromise = (0, jobRecommendationProfileCacheService_1.resolveCachedRecommendationProfile)(db, currentUserId);
            const discoveredThresholdIso = new Date(Date.now() - (JOB_DISCOVERED_WINDOW_MINUTES * 60 * 1000)).toISOString();
            const discoveredFilter = buildDiscoveredWindowFilter(querySpec.filter, discoveredThresholdIso);
            const discoveredCountCacheKey = buildDiscoveredCountCacheKey({
                status,
                workModelRaw,
                employmentTypeRaw,
                locationRaw,
                companyRaw,
                searchRaw,
                minSalary: Number.isFinite(minSalary) ? minSalary : '',
                maxSalary: Number.isFinite(maxSalary) ? maxSalary : '',
                postedWithinHours: Number.isFinite(postedWithinHours) ? postedWithinHours : '',
            });
            const [items, total, discoveredLast30Minutes, recommendationProfile] = yield Promise.all([
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
                resolveCachedDiscoveredCount(db, discoveredFilter, discoveredCountCacheKey),
                recommendationProfilePromise,
            ]);
            const jobsWithRecommendations = items.map((item) => {
                const base = (0, exports.toJobResponse)(item);
                if (!recommendationProfile)
                    return base;
                const recommendation = (0, jobRecommendationService_1.buildJobRecommendationScore)(item, recommendationProfile);
                const roundedScore = Math.max(0, Math.round(recommendation.score));
                return Object.assign(Object.assign({}, base), { recommendationScore: roundedScore, recommendationReasons: recommendation.reasons.slice(0, 3), matchedSkills: recommendation.matchedSkills.slice(0, 5), recommendationBreakdown: recommendation.breakdown, matchTier: (0, jobRecommendationService_1.resolveRecommendationMatchTier)(roundedScore) });
            });
            const jobsWithHeat = yield attachHeatFieldsToJobResponses({
                db,
                jobs: jobsWithRecommendations,
            });
            return res.json({
                success: true,
                data: jobsWithHeat,
                meta: {
                    discoveredLast30Minutes: Number.isFinite(discoveredLast30Minutes) && discoveredLast30Minutes > 0
                        ? Number(discoveredLast30Minutes)
                        : 0,
                },
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
            const jobs = yield db.collection(JOBS_COLLECTION)
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
                .map((job) => (Object.assign(Object.assign({}, (0, exports.toJobResponse)(job)), (0, jobPulseSnapshotService_1.buildJobHeatResponseFields)(snapshotsByJobId.get((0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120))))));
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
    // GET /api/jobs/matches/:handle
    getPublicJobMatchesByHandle: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const rawHandle = (0, inputSanitizers_1.readString)(req.params.handle, 120).replace(/^@+/, '');
            if (!rawHandle) {
                return res.status(400).json({ success: false, error: 'Handle is required' });
            }
            const db = (0, db_1.getDB)();
            const handleRegex = new RegExp(`^@?${escapeRegexPattern(rawHandle)}$`, 'i');
            const publicUser = yield db.collection(USERS_COLLECTION).findOne({ handle: handleRegex }, {
                projection: {
                    id: 1,
                    handle: 1,
                    firstName: 1,
                    name: 1,
                    jobMatchShareEnabled: 1,
                },
            });
            if (!publicUser) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            if ((publicUser === null || publicUser === void 0 ? void 0 : publicUser.jobMatchShareEnabled) !== true) {
                return res.status(403).json({ success: false, error: 'This match feed is private' });
            }
            const user = yield db.collection(USERS_COLLECTION).findOne({ id: String((publicUser === null || publicUser === void 0 ? void 0 : publicUser.id) || '') }, {
                projection: {
                    id: 1,
                    handle: 1,
                    firstName: 1,
                    name: 1,
                    title: 1,
                    skills: 1,
                    profileSkills: 1,
                    location: 1,
                    country: 1,
                    industry: 1,
                    remotePreference: 1,
                    workPreference: 1,
                    preferredWorkModel: 1,
                    preferredWorkModels: 1,
                    workPreferences: 1,
                    experienceLevel: 1,
                    seniority: 1,
                    roleLevel: 1,
                    jobSeniorityPreference: 1,
                    yearsOfExperience: 1,
                    experienceYears: 1,
                    totalExperienceYears: 1,
                },
            });
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_a = req.query) === null || _a === void 0 ? void 0 : _a.limit, 20, 1, 40);
            const matchedJobs = yield (0, reverseJobMatchService_1.listTopJobMatchesForUser)({
                db,
                user,
                limit,
            });
            const normalizedHandle = (0, inputSanitizers_1.readString)(publicUser === null || publicUser === void 0 ? void 0 : publicUser.handle, 120) || `@${rawHandle.toLowerCase()}`;
            const matchedJobsWithHeat = yield attachHeatFieldsToJobResponses({
                db,
                jobs: matchedJobs.map((job) => (Object.assign(Object.assign({}, (0, exports.toJobResponse)(job)), { recommendationScore: Number.isFinite(job === null || job === void 0 ? void 0 : job.recommendationScore) && Number(job === null || job === void 0 ? void 0 : job.recommendationScore) > 0
                        ? Number(job.recommendationScore)
                        : 0, recommendationReasons: Array.isArray(job === null || job === void 0 ? void 0 : job.recommendationReasons)
                        ? job.recommendationReasons.slice(0, 3)
                        : [], matchedSkills: Array.isArray(job === null || job === void 0 ? void 0 : job.matchedSkills)
                        ? job.matchedSkills.slice(0, 5)
                        : [], recommendationBreakdown: (job === null || job === void 0 ? void 0 : job.recommendationBreakdown) && typeof job.recommendationBreakdown === 'object'
                        ? job.recommendationBreakdown
                        : undefined, matchTier: (job === null || job === void 0 ? void 0 : job.matchTier) === 'best' || (job === null || job === void 0 ? void 0 : job.matchTier) === 'good' || (job === null || job === void 0 ? void 0 : job.matchTier) === 'other'
                        ? job.matchTier
                        : 'other' }))),
            });
            return res.json({
                success: true,
                data: matchedJobsWithHeat,
                meta: {
                    user: {
                        id: String((publicUser === null || publicUser === void 0 ? void 0 : publicUser.id) || ''),
                        handle: normalizedHandle,
                        name: (0, inputSanitizers_1.readString)(publicUser === null || publicUser === void 0 ? void 0 : publicUser.name, 160)
                            || (0, inputSanitizers_1.readString)(publicUser === null || publicUser === void 0 ? void 0 : publicUser.firstName, 120)
                            || normalizedHandle,
                    },
                    shareUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs/${encodeURIComponent(normalizedHandle)}`,
                },
            });
        }
        catch (error) {
            console.error('Get public job matches by handle error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch public job matches' });
        }
    }),
    // GET /api/jobs/salary-insights
    getSalaryInsights: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const jobTitle = (0, inputSanitizers_1.readString)(req.query.jobTitle, 140);
            const location = (0, inputSanitizers_1.readString)(req.query.location, 140);
            if (!jobTitle || !location) {
                return res.status(400).json({ success: false, error: 'jobTitle and location are required' });
            }
            const db = (0, db_1.getDB)();
            const allowTextSearch = yield (0, exports.ensureJobsTextIndex)(db);
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
            const rawRequestedSlug = (0, inputSanitizers_1.readString)(req.params.jobSlug, 220).toLowerCase();
            const requestedSlug = normalizeSlugValue(rawRequestedSlug, 220);
            if (!requestedSlug) {
                return res.status(400).json({ success: false, error: 'Invalid job slug' });
            }
            const db = (0, db_1.getDB)();
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            const slugIdMatch = rawRequestedSlug.match(/(?:^|--)(job-[a-z0-9-]+)$/i);
            const slugJobId = (slugIdMatch === null || slugIdMatch === void 0 ? void 0 : slugIdMatch[1]) || '';
            if (slugJobId) {
                const byId = yield db.collection(JOBS_COLLECTION).findOne({ id: slugJobId, status: { $ne: 'archived' } });
                if (byId) {
                    incrementJobViewCountAsync(db, slugJobId, currentUserId);
                    const byIdWithView = withOptimisticViewCount(byId);
                    const skillGap = currentUserId
                        ? yield resolveJobSkillGap({
                            db,
                            currentUserId,
                            viewer: req.user,
                            job: byIdWithView,
                        })
                        : null;
                    return res.json({
                        success: true,
                        data: yield attachHeatFieldsToJobResponse({
                            db,
                            job: Object.assign(Object.assign({}, (0, exports.toJobResponse)(byIdWithView)), (skillGap ? { skillGap } : {})),
                        }),
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
            incrementJobViewCountAsync(db, (0, inputSanitizers_1.readString)(bySlug === null || bySlug === void 0 ? void 0 : bySlug.id, 120), currentUserId);
            const bySlugWithView = withOptimisticViewCount(bySlug);
            const skillGap = currentUserId
                ? yield resolveJobSkillGap({
                    db,
                    currentUserId,
                    viewer: req.user,
                    job: bySlugWithView,
                })
                : null;
            return res.json({
                success: true,
                data: yield attachHeatFieldsToJobResponse({
                    db,
                    job: Object.assign(Object.assign({}, (0, exports.toJobResponse)(bySlugWithView)), (skillGap ? { skillGap } : {})),
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
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId, status: { $ne: 'archived' } });
            if (!job) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            incrementJobViewCountAsync(db, jobId, currentUserId);
            const jobWithView = withOptimisticViewCount(job);
            const skillGap = currentUserId
                ? yield resolveJobSkillGap({
                    db,
                    currentUserId,
                    viewer: req.user,
                    job: jobWithView,
                })
                : null;
            return res.json({
                success: true,
                data: yield attachHeatFieldsToJobResponse({
                    db,
                    job: Object.assign(Object.assign({}, (0, exports.toJobResponse)(jobWithView)), (skillGap ? { skillGap } : {})),
                }),
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
            const jobId = (0, inputSanitizers_1.readString)(req.params.jobId, 120);
            if (!jobId) {
                return res.status(400).json({ success: false, error: 'jobId is required' });
            }
            const db = (0, db_1.getDB)();
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId, status: { $ne: 'archived' } }, { projection: { id: 1, companyId: 1 } });
            if (!job) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const companyId = (0, inputSanitizers_1.readString)(job.companyId, 120);
            if (!companyId) {
                return res.json({ success: true, data: { count: 0, companyId: '' } });
            }
            const currentUser = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId }, { projection: { acquaintances: 1 } });
            const acquaintanceIds = Array.isArray(currentUser === null || currentUser === void 0 ? void 0 : currentUser.acquaintances)
                ? Array.from(new Set(currentUser.acquaintances
                    .map((value) => (0, inputSanitizers_1.readString)(value, 120))
                    .filter((value) => value.length > 0)))
                : [];
            if (acquaintanceIds.length === 0) {
                return res.json({ success: true, data: { count: 0, companyId } });
            }
            const scannedAcquaintanceIds = acquaintanceIds.slice(0, MAX_NETWORK_COUNT_SCAN_IDS);
            const count = yield db.collection(COMPANY_MEMBERS_COLLECTION).countDocuments({
                companyId,
                userId: { $in: scannedAcquaintanceIds },
            });
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
            const requestedCompanyId = (0, inputSanitizers_1.readString)((_b = req.body) === null || _b === void 0 ? void 0 : _b.companyId, 120) ||
                (0, inputSanitizers_1.readString)(req.headers['x-identity-id'] || '', 120);
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUserId, { ownerType: 'company', ownerId: requestedCompanyId });
            if (!actor || actor.type !== 'company') {
                return res.status(403).json({ success: false, error: 'Company identity context is required' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(actor.id, currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const title = (0, inputSanitizers_1.readString)((_c = req.body) === null || _c === void 0 ? void 0 : _c.title, 120);
            const summary = (0, inputSanitizers_1.readString)((_d = req.body) === null || _d === void 0 ? void 0 : _d.summary, 240);
            const description = (0, inputSanitizers_1.readString)((_e = req.body) === null || _e === void 0 ? void 0 : _e.description, 15000);
            const locationText = (0, inputSanitizers_1.readString)((_f = req.body) === null || _f === void 0 ? void 0 : _f.locationText, 160);
            const workModel = (0, inputSanitizers_1.readString)((_g = req.body) === null || _g === void 0 ? void 0 : _g.workModel, 40).toLowerCase();
            const employmentType = (0, inputSanitizers_1.readString)((_h = req.body) === null || _h === void 0 ? void 0 : _h.employmentType, 40).toLowerCase();
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
            const salaryCurrency = (0, inputSanitizers_1.readString)((_m = req.body) === null || _m === void 0 ? void 0 : _m.salaryCurrency, 10).toUpperCase();
            const applicationDeadline = parseIsoOrNull((_o = req.body) === null || _o === void 0 ? void 0 : _o.applicationDeadline);
            const hasApplicationUrlPayload = ((_p = req.body) === null || _p === void 0 ? void 0 : _p.applicationUrl) !== undefined;
            const hasApplicationEmailPayload = ((_q = req.body) === null || _q === void 0 ? void 0 : _q.applicationEmail) !== undefined;
            const applicationUrl = (0, contactNormalization_1.normalizeExternalUrl)((_r = req.body) === null || _r === void 0 ? void 0 : _r.applicationUrl);
            const applicationEmail = (0, contactNormalization_1.normalizeEmailAddress)((_s = req.body) === null || _s === void 0 ? void 0 : _s.applicationEmail);
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
                companyName: (0, inputSanitizers_1.readString)((_u = access.company) === null || _u === void 0 ? void 0 : _u.name, 120) || 'Company',
                companyHandle: (0, inputSanitizers_1.readString)((_v = access.company) === null || _v === void 0 ? void 0 : _v.handle, 80),
                companyIsVerified: Boolean((_w = access.company) === null || _w === void 0 ? void 0 : _w.isVerified),
                companyWebsite: (0, contactNormalization_1.normalizeExternalUrl)((_x = access.company) === null || _x === void 0 ? void 0 : _x.website),
                companyEmail: (0, contactNormalization_1.normalizeEmailAddress)((_y = access.company) === null || _y === void 0 ? void 0 : _y.email),
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
                source: 'aura:company',
                tags,
                createdByUserId: currentUserId,
                createdAt: nowIso,
                discoveredAt: nowIso,
                updatedAt: nowIso,
                publishedAt: nowIso,
                announcementPostId: null,
                applicationUrl,
                applicationEmail,
                applicationCount: 0,
                viewCount: 0,
            };
            job.slug = buildPersistentJobSlug(job);
            const db = (0, db_1.getDB)();
            let announcementPostId = null;
            if (announceInFeed) {
                const nowTimestamp = Date.now();
                const postId = `post-job-${nowTimestamp}-${crypto_1.default.randomBytes(4).toString('hex')}`;
                const announcementContent = buildJobAnnouncementContent({
                    title,
                    companyName: (0, inputSanitizers_1.readString)((_z = access.company) === null || _z === void 0 ? void 0 : _z.name, 120) || 'Company',
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
                        firstName: (0, inputSanitizers_1.readString)((_0 = access.company) === null || _0 === void 0 ? void 0 : _0.name, 120) || 'Company',
                        lastName: '',
                        name: (0, inputSanitizers_1.readString)((_1 = access.company) === null || _1 === void 0 ? void 0 : _1.name, 120) || 'Company',
                        handle: (0, inputSanitizers_1.readString)((_2 = access.company) === null || _2 === void 0 ? void 0 : _2.handle, 80) || '',
                        avatar: (0, inputSanitizers_1.readString)((_3 = access.company) === null || _3 === void 0 ? void 0 : _3.avatar, 500) || '',
                        avatarKey: (0, inputSanitizers_1.readString)((_4 = access.company) === null || _4 === void 0 ? void 0 : _4.avatarKey, 500) || '',
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
            const recommendationSource = {
                id: job.id,
                title: (0, inputSanitizers_1.readString)(job.title, 120),
                summary: (0, inputSanitizers_1.readString)(job.summary, 240),
                description: (0, inputSanitizers_1.readString)(job.description, 15000),
                locationText: (0, inputSanitizers_1.readString)(job.locationText, 160),
                tags: Array.isArray(job.tags) ? job.tags : [],
                workModel: (0, inputSanitizers_1.readString)(job.workModel, 40),
                salaryMin: job.salaryMin,
                salaryMax: job.salaryMax,
                createdAt: job.createdAt,
                publishedAt: job.publishedAt,
            };
            Object.assign(job, (0, jobRecommendationService_1.buildJobRecommendationPrecomputedFields)(recommendationSource));
            yield db.collection(JOBS_COLLECTION).insertOne(job);
            (0, jobPulseService_1.recordJobPulseEventAsync)(db, {
                jobId: job.id,
                type: 'job_discovered',
                userId: currentUserId,
                createdAt: nowIso,
            });
            return res.status(201).json({
                success: true,
                data: (0, exports.toJobResponse)(job),
            });
        }
        catch (error) {
            console.error('Create job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to create job' });
        }
    }),
    // PUT /api/jobs/:jobId
    updateJob: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
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
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(String(existingJob.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const updates = {};
            if (req.body.title !== undefined) {
                const value = (0, inputSanitizers_1.readString)(req.body.title, 120);
                if (!value)
                    return res.status(400).json({ success: false, error: 'title cannot be empty' });
                updates.title = value;
            }
            if (req.body.summary !== undefined) {
                const value = (0, inputSanitizers_1.readString)(req.body.summary, 240);
                if (!value)
                    return res.status(400).json({ success: false, error: 'summary cannot be empty' });
                updates.summary = value;
            }
            if (req.body.description !== undefined) {
                const value = (0, inputSanitizers_1.readString)(req.body.description, 15000);
                if (!value)
                    return res.status(400).json({ success: false, error: 'description cannot be empty' });
                updates.description = value;
            }
            if (req.body.locationText !== undefined) {
                const value = (0, inputSanitizers_1.readString)(req.body.locationText, 160);
                if (!value)
                    return res.status(400).json({ success: false, error: 'locationText cannot be empty' });
                updates.locationText = value;
            }
            if (req.body.workModel !== undefined) {
                const value = (0, inputSanitizers_1.readString)(req.body.workModel, 40).toLowerCase();
                if (!ALLOWED_WORK_MODELS.has(value))
                    return res.status(400).json({ success: false, error: 'Invalid workModel' });
                updates.workModel = value;
            }
            if (req.body.employmentType !== undefined) {
                const value = (0, inputSanitizers_1.readString)(req.body.employmentType, 40).toLowerCase();
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
                updates.salaryCurrency = (0, inputSanitizers_1.readString)(req.body.salaryCurrency, 10).toUpperCase();
            }
            if (req.body.applicationDeadline !== undefined) {
                const parsed = parseIsoOrNull(req.body.applicationDeadline);
                updates.applicationDeadline = parsed;
            }
            if (req.body.applicationUrl !== undefined) {
                const parsedUrl = (0, contactNormalization_1.normalizeExternalUrl)(req.body.applicationUrl);
                const raw = (0, inputSanitizers_1.readString)(String(req.body.applicationUrl || ''), 600);
                if (raw && !parsedUrl) {
                    return res.status(400).json({ success: false, error: 'applicationUrl must be a valid http(s) URL' });
                }
                updates.applicationUrl = parsedUrl;
            }
            if (req.body.applicationEmail !== undefined) {
                const parsedEmail = (0, contactNormalization_1.normalizeEmailAddress)(req.body.applicationEmail);
                const raw = (0, inputSanitizers_1.readString)(String(req.body.applicationEmail || ''), 200);
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
            const recommendationSource = {
                id: existingJob.id,
                title: (0, inputSanitizers_1.readString)((_b = updates.title) !== null && _b !== void 0 ? _b : existingJob.title, 120),
                summary: (0, inputSanitizers_1.readString)((_c = updates.summary) !== null && _c !== void 0 ? _c : existingJob.summary, 240),
                description: (0, inputSanitizers_1.readString)((_d = updates.description) !== null && _d !== void 0 ? _d : existingJob.description, 15000),
                locationText: (0, inputSanitizers_1.readString)((_e = updates.locationText) !== null && _e !== void 0 ? _e : existingJob.locationText, 160),
                tags: Array.isArray(updates.tags) ? updates.tags : (Array.isArray(existingJob.tags) ? existingJob.tags : []),
                workModel: (0, inputSanitizers_1.readString)((_f = updates.workModel) !== null && _f !== void 0 ? _f : existingJob.workModel, 40),
                salaryMin: updates.salaryMin !== undefined ? updates.salaryMin : existingJob.salaryMin,
                salaryMax: updates.salaryMax !== undefined ? updates.salaryMax : existingJob.salaryMax,
                createdAt: existingJob.createdAt,
                publishedAt: updates.publishedAt !== undefined ? updates.publishedAt : existingJob.publishedAt,
            };
            updates.updatedAt = new Date().toISOString();
            Object.assign(updates, (0, jobRecommendationService_1.buildJobRecommendationPrecomputedFields)(recommendationSource));
            yield db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $set: updates });
            const updatedJob = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            return res.json({
                success: true,
                data: (0, exports.toJobResponse)(updatedJob),
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
            const nextStatus = (0, inputSanitizers_1.readString)((_b = req.body) === null || _b === void 0 ? void 0 : _b.status, 40).toLowerCase();
            if (!ALLOWED_JOB_STATUSES.has(nextStatus)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }
            const db = (0, db_1.getDB)();
            const existingJob = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            if (!existingJob) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(String(existingJob.companyId || ''), currentUserId);
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
            const recommendationSource = {
                id: existingJob.id,
                title: (0, inputSanitizers_1.readString)(existingJob.title, 120),
                summary: (0, inputSanitizers_1.readString)(existingJob.summary, 240),
                description: (0, inputSanitizers_1.readString)(existingJob.description, 15000),
                locationText: (0, inputSanitizers_1.readString)(existingJob.locationText, 160),
                tags: Array.isArray(existingJob.tags) ? existingJob.tags : [],
                workModel: (0, inputSanitizers_1.readString)(existingJob.workModel, 40),
                salaryMin: existingJob.salaryMin,
                salaryMax: existingJob.salaryMax,
                createdAt: existingJob.createdAt,
                publishedAt: nextStatus === 'open'
                    ? (nextUpdate.publishedAt !== undefined ? nextUpdate.publishedAt : existingJob.publishedAt)
                    : null,
            };
            Object.assign(nextUpdate, (0, jobRecommendationService_1.buildJobRecommendationPrecomputedFields)(recommendationSource));
            yield db.collection(JOBS_COLLECTION).updateOne({ id: jobId }, { $set: nextUpdate });
            const updatedJob = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId });
            return res.json({ success: true, data: (0, exports.toJobResponse)(updatedJob) });
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
                ownerType: (0, inputSanitizers_1.readString)(req.headers['x-identity-type'] || 'user', 20),
                ownerId: (0, inputSanitizers_1.readString)(req.headers['x-identity-id'] || currentUserId, 120),
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
            let applicantName = (0, inputSanitizers_1.readString)((_c = req.body) === null || _c === void 0 ? void 0 : _c.applicantName, 120);
            let applicantEmail = (0, inputSanitizers_1.readString)((_d = req.body) === null || _d === void 0 ? void 0 : _d.applicantEmail, 160).toLowerCase();
            const applicantPhone = (0, inputSanitizers_1.readStringOrNull)((_e = req.body) === null || _e === void 0 ? void 0 : _e.applicantPhone, 40);
            const coverLetter = (0, inputSanitizers_1.readStringOrNull)((_f = req.body) === null || _f === void 0 ? void 0 : _f.coverLetter, 5000);
            const portfolioUrl = (0, inputSanitizers_1.readStringOrNull)((_g = req.body) === null || _g === void 0 ? void 0 : _g.portfolioUrl, 300);
            let resumeKey = (0, inputSanitizers_1.readString)((_h = req.body) === null || _h === void 0 ? void 0 : _h.resumeKey, 500);
            let resumeFileName = (0, inputSanitizers_1.readString)((_j = req.body) === null || _j === void 0 ? void 0 : _j.resumeFileName, 200);
            let resumeMimeType = (0, inputSanitizers_1.readString)((_k = req.body) === null || _k === void 0 ? void 0 : _k.resumeMimeType, 120);
            let resumeSize = Number((_l = req.body) === null || _l === void 0 ? void 0 : _l.resumeSize);
            if (profileUser) {
                const derivedProfileName = `${(0, inputSanitizers_1.readString)(profileUser === null || profileUser === void 0 ? void 0 : profileUser.firstName, 80)} ${(0, inputSanitizers_1.readString)(profileUser === null || profileUser === void 0 ? void 0 : profileUser.lastName, 80)}`.trim()
                    || (0, inputSanitizers_1.readString)(profileUser === null || profileUser === void 0 ? void 0 : profileUser.name, 120);
                const derivedProfileEmail = (0, inputSanitizers_1.readString)(profileUser === null || profileUser === void 0 ? void 0 : profileUser.email, 160).toLowerCase();
                if (derivedProfileName) {
                    applicantName = derivedProfileName;
                }
                if (derivedProfileEmail) {
                    applicantEmail = derivedProfileEmail;
                }
                const defaultResumeKey = (0, inputSanitizers_1.readString)(profileUser === null || profileUser === void 0 ? void 0 : profileUser.defaultResumeKey, 500);
                if (defaultResumeKey) {
                    resumeKey = defaultResumeKey;
                    resumeFileName = (0, inputSanitizers_1.readString)(profileUser === null || profileUser === void 0 ? void 0 : profileUser.defaultResumeFileName, 200);
                    resumeMimeType = (0, inputSanitizers_1.readString)(profileUser === null || profileUser === void 0 ? void 0 : profileUser.defaultResumeMimeType, 120);
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
                jobTitleSnapshot: (0, inputSanitizers_1.readString)(job.title, 180) || null,
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
                data: (0, exports.toApplicationResponse)(application),
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
            const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(String(job.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const status = (0, inputSanitizers_1.readString)(req.query.status, 40).toLowerCase();
            if (status && !ALLOWED_APPLICATION_STATUSES.has(status)) {
                return res.status(400).json({ success: false, error: 'Invalid application status filter' });
            }
            const pagination = (0, exports.getPagination)(req.query);
            const searchRegex = (0, exports.sanitizeSearchRegex)((0, inputSanitizers_1.readString)(req.query.q, 100));
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
                data: items.map(exports.toApplicationResponse),
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
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { applicationId } = req.params;
            const nextStatus = (0, inputSanitizers_1.readString)((_b = req.body) === null || _b === void 0 ? void 0 : _b.status, 40).toLowerCase();
            const statusNote = (0, inputSanitizers_1.readStringOrNull)((_c = req.body) === null || _c === void 0 ? void 0 : _c.statusNote, 1000);
            if (!ALLOWED_APPLICATION_STATUSES.has(nextStatus)) {
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
            return res.json({ success: true, data: (0, exports.toApplicationResponse)(updated) });
        }
        catch (error) {
            console.error('Update application status error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update application status' });
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
