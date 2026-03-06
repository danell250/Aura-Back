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
exports.updateCompanyJobStatus = exports.updateCompanyJob = exports.createCompanyJob = void 0;
const crypto_1 = __importDefault(require("crypto"));
const jobRecommendationService_1 = require("./jobRecommendationService");
const openToWorkDemandService_1 = require("./openToWorkDemandService");
const jobResponseService_1 = require("./jobResponseService");
const jobCreateHooksService_1 = require("./jobCreateHooksService");
const jobPulseService_1 = require("./jobPulseService");
const jobMarketDemandSeedContextRegistryService_1 = require("./jobMarketDemandSeedContextRegistryService");
const jobSlugService_1 = require("./jobSlugService");
const contactNormalization_1 = require("../utils/contactNormalization");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const JOBS_COLLECTION = 'jobs';
const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
const createJobWriteError = (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};
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
const buildRecommendationSource = (source) => ({
    id: source.id,
    title: (0, inputSanitizers_1.readString)(source.title, 120),
    summary: (0, inputSanitizers_1.readString)(source.summary, 240),
    description: (0, inputSanitizers_1.readString)(source.description, 15000),
    locationText: (0, inputSanitizers_1.readString)(source.locationText, 160),
    tags: Array.isArray(source.tags) ? source.tags : [],
    workModel: (0, inputSanitizers_1.readString)(source.workModel, 40),
    salaryMin: source.salaryMin,
    salaryMax: source.salaryMax,
    createdAt: source.createdAt,
    publishedAt: source.publishedAt,
});
const applyJobPrecomputedFields = (job) => {
    const recommendationSource = buildRecommendationSource({
        id: job.id,
        title: job.title,
        summary: job.summary,
        description: job.description,
        locationText: job.locationText,
        tags: job.tags,
        workModel: job.workModel,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        createdAt: job.createdAt,
        publishedAt: job.publishedAt,
    });
    Object.assign(job, (0, jobRecommendationService_1.buildJobRecommendationPrecomputedFields)(recommendationSource));
    Object.assign(job, (0, openToWorkDemandService_1.buildDemandRoleFields)(job.title) || {});
    Object.assign(job, (0, openToWorkDemandService_1.buildJobMarketDemandPrecomputedFields)(recommendationSource));
};
const persistCreatedJob = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield params.db.collection(JOBS_COLLECTION).insertOne(params.job);
    void (0, jobMarketDemandSeedContextRegistryService_1.registerJobMarketDemandSeedContexts)({
        db: params.db,
        jobs: [{
                locationText: params.job.locationText,
                workModel: params.job.workModel,
                status: params.job.status,
            }],
    }).catch((error) => {
        console.warn('Register job market demand seed context error:', error);
    });
    (0, jobPulseService_1.recordJobPulseEventAsync)(params.db, {
        jobId: params.job.id,
        type: 'job_discovered',
        userId: params.currentUserId,
        createdAt: params.job.createdAt,
    });
});
const buildCompanyJobUpdatePatch = (params) => {
    var _a;
    const updates = {};
    if (params.payload.title !== undefined) {
        const value = (0, inputSanitizers_1.readString)(params.payload.title, 120);
        if (!value)
            throw createJobWriteError(400, 'title cannot be empty');
        updates.title = value;
    }
    if (params.payload.summary !== undefined) {
        const value = (0, inputSanitizers_1.readString)(params.payload.summary, 240);
        if (!value)
            throw createJobWriteError(400, 'summary cannot be empty');
        updates.summary = value;
    }
    if (params.payload.description !== undefined) {
        const value = (0, inputSanitizers_1.readString)(params.payload.description, 15000);
        if (!value)
            throw createJobWriteError(400, 'description cannot be empty');
        updates.description = value;
    }
    if (params.payload.locationText !== undefined) {
        const value = (0, inputSanitizers_1.readString)(params.payload.locationText, 160);
        if (!value)
            throw createJobWriteError(400, 'locationText cannot be empty');
        updates.locationText = value;
    }
    if (params.payload.workModel !== undefined) {
        const value = (0, inputSanitizers_1.readString)(params.payload.workModel, 40).toLowerCase();
        if (!ALLOWED_WORK_MODELS.has(value))
            throw createJobWriteError(400, 'Invalid workModel');
        updates.workModel = value;
    }
    if (params.payload.employmentType !== undefined) {
        const value = (0, inputSanitizers_1.readString)(params.payload.employmentType, 40).toLowerCase();
        if (!ALLOWED_EMPLOYMENT_TYPES.has(value)) {
            throw createJobWriteError(400, 'Invalid employmentType');
        }
        updates.employmentType = value;
    }
    if (params.payload.salaryMin !== undefined) {
        const value = Number(params.payload.salaryMin);
        if (!Number.isFinite(value) || value < 0) {
            throw createJobWriteError(400, 'salaryMin must be a non-negative number');
        }
        updates.salaryMin = value;
    }
    if (params.payload.salaryMax !== undefined) {
        const value = Number(params.payload.salaryMax);
        if (!Number.isFinite(value) || value < 0) {
            throw createJobWriteError(400, 'salaryMax must be a non-negative number');
        }
        updates.salaryMax = value;
    }
    const nextSalaryMin = updates.salaryMin !== undefined
        ? Number(updates.salaryMin)
        : (Number.isFinite(params.existingJob.salaryMin) ? Number(params.existingJob.salaryMin) : null);
    const nextSalaryMax = updates.salaryMax !== undefined
        ? Number(updates.salaryMax)
        : (Number.isFinite(params.existingJob.salaryMax) ? Number(params.existingJob.salaryMax) : null);
    if (nextSalaryMin != null && nextSalaryMax != null && nextSalaryMax < nextSalaryMin) {
        throw createJobWriteError(400, 'salaryMax cannot be less than salaryMin');
    }
    if (params.payload.salaryCurrency !== undefined) {
        updates.salaryCurrency = (0, inputSanitizers_1.readString)(params.payload.salaryCurrency, 10).toUpperCase();
    }
    if (params.payload.applicationDeadline !== undefined) {
        updates.applicationDeadline = parseIsoOrNull(params.payload.applicationDeadline);
    }
    if (params.payload.applicationUrl !== undefined) {
        const parsedUrl = (0, contactNormalization_1.normalizeExternalUrl)(params.payload.applicationUrl);
        const raw = (0, inputSanitizers_1.readString)(String(params.payload.applicationUrl || ''), 600);
        if (raw && !parsedUrl) {
            throw createJobWriteError(400, 'applicationUrl must be a valid http(s) URL');
        }
        updates.applicationUrl = parsedUrl;
    }
    if (params.payload.applicationEmail !== undefined) {
        const parsedEmail = (0, contactNormalization_1.normalizeEmailAddress)(params.payload.applicationEmail);
        const raw = (0, inputSanitizers_1.readString)(String(params.payload.applicationEmail || ''), 200);
        if (raw && !parsedEmail) {
            throw createJobWriteError(400, 'applicationEmail must be a valid email address');
        }
        updates.applicationEmail = parsedEmail;
    }
    if (params.payload.tags !== undefined) {
        updates.tags = readStringList(params.payload.tags, 10, 40);
    }
    if (Object.keys(updates).length === 0) {
        throw createJobWriteError(400, 'No valid fields to update');
    }
    if (!(0, jobSlugService_1.normalizeJobSlugValue)((_a = params.existingJob) === null || _a === void 0 ? void 0 : _a.slug, 220)) {
        updates.slug = (0, jobResponseService_1.buildPersistentJobSlug)(Object.assign(Object.assign(Object.assign({}, params.existingJob), updates), { id: params.existingJob.id }));
    }
    return updates;
};
const applyUpdatedJobDerivedFields = (params) => {
    var _a, _b, _c, _d, _e;
    const recommendationSource = buildRecommendationSource({
        id: params.existingJob.id,
        title: (_a = params.updates.title) !== null && _a !== void 0 ? _a : params.existingJob.title,
        summary: (_b = params.updates.summary) !== null && _b !== void 0 ? _b : params.existingJob.summary,
        description: (_c = params.updates.description) !== null && _c !== void 0 ? _c : params.existingJob.description,
        locationText: (_d = params.updates.locationText) !== null && _d !== void 0 ? _d : params.existingJob.locationText,
        tags: Array.isArray(params.updates.tags) ? params.updates.tags : params.existingJob.tags,
        workModel: (_e = params.updates.workModel) !== null && _e !== void 0 ? _e : params.existingJob.workModel,
        salaryMin: params.updates.salaryMin !== undefined ? params.updates.salaryMin : params.existingJob.salaryMin,
        salaryMax: params.updates.salaryMax !== undefined ? params.updates.salaryMax : params.existingJob.salaryMax,
        createdAt: params.existingJob.createdAt,
        publishedAt: params.updates.publishedAt !== undefined ? params.updates.publishedAt : params.existingJob.publishedAt,
    });
    params.updates.updatedAt = new Date().toISOString();
    Object.assign(params.updates, (0, jobRecommendationService_1.buildJobRecommendationPrecomputedFields)(recommendationSource));
    if (params.updates.title !== undefined
        || !(0, inputSanitizers_1.readString)(params.existingJob.demandRoleFamily, 120)
        || !(0, inputSanitizers_1.readString)(params.existingJob.demandRoleLabel, 120)) {
        Object.assign(params.updates, (0, openToWorkDemandService_1.buildDemandRoleFields)(recommendationSource.title) || {});
    }
    if (params.updates.salaryMin !== undefined
        || params.updates.salaryMax !== undefined
        || params.updates.publishedAt !== undefined
        || !Number.isFinite(Number(params.existingJob.marketDemandFreshnessTs))
        || params.existingJob.marketDemandSalaryValue == null) {
        Object.assign(params.updates, (0, openToWorkDemandService_1.buildJobMarketDemandPrecomputedFields)(recommendationSource));
    }
};
const persistUpdatedJob = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    yield params.db.collection(JOBS_COLLECTION).updateOne({ id: params.existingJob.id }, { $set: params.updates });
    const updatedJob = yield params.db.collection(JOBS_COLLECTION).findOne({ id: params.existingJob.id });
    void (0, jobMarketDemandSeedContextRegistryService_1.registerJobMarketDemandSeedContexts)({
        db: params.db,
        jobs: [{
                locationText: (_b = (_a = updatedJob === null || updatedJob === void 0 ? void 0 : updatedJob.locationText) !== null && _a !== void 0 ? _a : params.updates.locationText) !== null && _b !== void 0 ? _b : params.existingJob.locationText,
                workModel: (_d = (_c = updatedJob === null || updatedJob === void 0 ? void 0 : updatedJob.workModel) !== null && _c !== void 0 ? _c : params.updates.workModel) !== null && _d !== void 0 ? _d : params.existingJob.workModel,
                status: (_f = (_e = updatedJob === null || updatedJob === void 0 ? void 0 : updatedJob.status) !== null && _e !== void 0 ? _e : params.updates.status) !== null && _f !== void 0 ? _f : params.existingJob.status,
            }],
    }).catch((error) => {
        console.warn('Register job market demand seed context error:', error);
    });
    return updatedJob;
});
const validateCreateCompanyJobInput = (payload) => {
    var _a;
    const title = (0, inputSanitizers_1.readString)(payload === null || payload === void 0 ? void 0 : payload.title, 120);
    const summary = (0, inputSanitizers_1.readString)(payload === null || payload === void 0 ? void 0 : payload.summary, 240);
    const description = (0, inputSanitizers_1.readString)(payload === null || payload === void 0 ? void 0 : payload.description, 15000);
    const locationText = (0, inputSanitizers_1.readString)(payload === null || payload === void 0 ? void 0 : payload.locationText, 160);
    const workModel = (0, inputSanitizers_1.readString)(payload === null || payload === void 0 ? void 0 : payload.workModel, 40).toLowerCase();
    const employmentType = (0, inputSanitizers_1.readString)(payload === null || payload === void 0 ? void 0 : payload.employmentType, 40).toLowerCase();
    const tags = readStringList(payload === null || payload === void 0 ? void 0 : payload.tags, 10, 40);
    if (!title || !summary || !description || !locationText) {
        throw createJobWriteError(400, 'title, summary, description, and locationText are required');
    }
    if (!ALLOWED_WORK_MODELS.has(workModel)) {
        throw createJobWriteError(400, 'Invalid workModel');
    }
    if (!ALLOWED_EMPLOYMENT_TYPES.has(employmentType)) {
        throw createJobWriteError(400, 'Invalid employmentType');
    }
    const salaryMinRaw = payload === null || payload === void 0 ? void 0 : payload.salaryMin;
    const salaryMaxRaw = payload === null || payload === void 0 ? void 0 : payload.salaryMax;
    const salaryMin = Number.isFinite(Number(salaryMinRaw)) ? Number(salaryMinRaw) : null;
    const salaryMax = Number.isFinite(Number(salaryMaxRaw)) ? Number(salaryMaxRaw) : null;
    const salaryCurrency = (0, inputSanitizers_1.readString)(payload === null || payload === void 0 ? void 0 : payload.salaryCurrency, 10).toUpperCase();
    const applicationDeadline = parseIsoOrNull(payload === null || payload === void 0 ? void 0 : payload.applicationDeadline);
    const hasApplicationUrlPayload = (payload === null || payload === void 0 ? void 0 : payload.applicationUrl) !== undefined;
    const hasApplicationEmailPayload = (payload === null || payload === void 0 ? void 0 : payload.applicationEmail) !== undefined;
    const applicationUrl = (0, contactNormalization_1.normalizeExternalUrl)(payload === null || payload === void 0 ? void 0 : payload.applicationUrl);
    const applicationEmail = (0, contactNormalization_1.normalizeEmailAddress)(payload === null || payload === void 0 ? void 0 : payload.applicationEmail);
    const createAnnouncement = Boolean((_a = payload === null || payload === void 0 ? void 0 : payload.createAnnouncement) !== null && _a !== void 0 ? _a : payload === null || payload === void 0 ? void 0 : payload.announceInFeed);
    if (salaryMin != null && salaryMin < 0) {
        throw createJobWriteError(400, 'salaryMin cannot be negative');
    }
    if (salaryMax != null && salaryMax < 0) {
        throw createJobWriteError(400, 'salaryMax cannot be negative');
    }
    if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) {
        throw createJobWriteError(400, 'salaryMax cannot be less than salaryMin');
    }
    if (hasApplicationUrlPayload && !applicationUrl) {
        throw createJobWriteError(400, 'applicationUrl must be a valid http(s) URL');
    }
    if (hasApplicationEmailPayload && !applicationEmail) {
        throw createJobWriteError(400, 'applicationEmail must be a valid email address');
    }
    return {
        title,
        summary,
        description,
        locationText,
        workModel,
        employmentType,
        tags,
        salaryMin,
        salaryMax,
        salaryCurrency,
        applicationDeadline,
        applicationUrl,
        applicationEmail,
        createAnnouncement,
    };
};
const buildCompanyJobDocument = (params) => {
    var _a, _b, _c, _d, _e;
    const jobId = `job-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
    const job = {
        id: jobId,
        slug: '',
        companyId: params.actorId,
        companyName: (0, inputSanitizers_1.readString)((_a = params.company) === null || _a === void 0 ? void 0 : _a.name, 120) || 'Company',
        companyHandle: (0, inputSanitizers_1.readString)((_b = params.company) === null || _b === void 0 ? void 0 : _b.handle, 80),
        companyIsVerified: Boolean((_c = params.company) === null || _c === void 0 ? void 0 : _c.isVerified),
        companyWebsite: (0, contactNormalization_1.normalizeExternalUrl)((_d = params.company) === null || _d === void 0 ? void 0 : _d.website),
        companyEmail: (0, contactNormalization_1.normalizeEmailAddress)((_e = params.company) === null || _e === void 0 ? void 0 : _e.email),
        title: params.validatedInput.title,
        summary: params.validatedInput.summary,
        description: params.validatedInput.description,
        locationText: params.validatedInput.locationText,
        workModel: params.validatedInput.workModel,
        employmentType: params.validatedInput.employmentType,
        salaryMin: params.validatedInput.salaryMin,
        salaryMax: params.validatedInput.salaryMax,
        salaryCurrency: params.validatedInput.salaryCurrency,
        applicationDeadline: params.validatedInput.applicationDeadline,
        status: 'open',
        source: 'aura:company',
        tags: params.validatedInput.tags,
        createdByUserId: params.currentUserId,
        createdAt: params.nowIso,
        discoveredAt: params.nowIso,
        updatedAt: params.nowIso,
        publishedAt: params.nowIso,
        announcementPostId: null,
        applicationUrl: params.validatedInput.applicationUrl,
        applicationEmail: params.validatedInput.applicationEmail,
        applicationCount: 0,
        viewCount: 0,
    };
    job.slug = (0, jobResponseService_1.buildPersistentJobSlug)(job);
    return job;
};
const finalizeCreatedCompanyJob = (params) => __awaiter(void 0, void 0, void 0, function* () {
    applyJobPrecomputedFields(params.job);
    yield persistCreatedJob({
        db: params.db,
        job: params.job,
        currentUserId: params.currentUserId,
    });
});
const createCompanyJob = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const validatedInput = validateCreateCompanyJobInput(params.payload);
    const nowIso = new Date().toISOString();
    const job = buildCompanyJobDocument({
        actorId: params.actorId,
        currentUserId: params.currentUserId,
        company: params.company,
        validatedInput,
        nowIso,
    });
    yield finalizeCreatedCompanyJob({
        db: params.db,
        job,
        currentUserId: params.currentUserId,
    });
    yield (0, jobCreateHooksService_1.runCompanyJobPostCreateHooks)({
        db: params.db,
        actorId: params.actorId,
        company: params.company,
        validatedInput,
        job,
        io: params.io,
        emitInsightsUpdate: params.emitInsightsUpdate,
    });
    return job;
});
exports.createCompanyJob = createCompanyJob;
const updateCompanyJob = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const updates = buildCompanyJobUpdatePatch(params);
    applyUpdatedJobDerivedFields({
        existingJob: params.existingJob,
        updates,
    });
    return persistUpdatedJob({
        db: params.db,
        existingJob: params.existingJob,
        updates,
    });
});
exports.updateCompanyJob = updateCompanyJob;
const updateCompanyJobStatus = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    if (!ALLOWED_JOB_STATUSES.has(params.nextStatus)) {
        throw createJobWriteError(400, 'Invalid status');
    }
    const nextUpdate = {
        status: params.nextStatus,
        updatedAt: new Date().toISOString(),
    };
    if (params.nextStatus === 'open' && !params.existingJob.publishedAt) {
        nextUpdate.publishedAt = new Date().toISOString();
    }
    const recommendationSource = {
        id: params.existingJob.id,
        title: (0, inputSanitizers_1.readString)(params.existingJob.title, 120),
        summary: (0, inputSanitizers_1.readString)(params.existingJob.summary, 240),
        description: (0, inputSanitizers_1.readString)(params.existingJob.description, 15000),
        locationText: (0, inputSanitizers_1.readString)(params.existingJob.locationText, 160),
        tags: Array.isArray(params.existingJob.tags) ? params.existingJob.tags : [],
        workModel: (0, inputSanitizers_1.readString)(params.existingJob.workModel, 40),
        salaryMin: params.existingJob.salaryMin,
        salaryMax: params.existingJob.salaryMax,
        createdAt: params.existingJob.createdAt,
        publishedAt: params.nextStatus === 'open'
            ? (nextUpdate.publishedAt !== undefined ? nextUpdate.publishedAt : params.existingJob.publishedAt)
            : null,
    };
    if (params.nextStatus === 'open') {
        Object.assign(nextUpdate, (0, jobRecommendationService_1.buildJobRecommendationPrecomputedFields)(recommendationSource));
    }
    if (!(0, inputSanitizers_1.readString)(params.existingJob.demandRoleFamily, 120) || !(0, inputSanitizers_1.readString)(params.existingJob.demandRoleLabel, 120)) {
        Object.assign(nextUpdate, (0, openToWorkDemandService_1.buildDemandRoleFields)(recommendationSource.title) || {});
    }
    if (params.nextStatus === 'open'
        && (nextUpdate.publishedAt !== undefined || !Number.isFinite(Number(params.existingJob.marketDemandFreshnessTs)))) {
        Object.assign(nextUpdate, (0, openToWorkDemandService_1.buildJobMarketDemandPrecomputedFields)(recommendationSource));
    }
    else if (params.nextStatus !== 'open') {
        nextUpdate.marketDemandFreshnessTs = 0;
    }
    yield params.db.collection(JOBS_COLLECTION).updateOne({ id: params.existingJob.id }, { $set: nextUpdate });
    const updatedJob = yield params.db.collection(JOBS_COLLECTION).findOne({ id: params.existingJob.id });
    void (0, jobMarketDemandSeedContextRegistryService_1.registerJobMarketDemandSeedContexts)({
        db: params.db,
        jobs: [{
                locationText: (_a = updatedJob === null || updatedJob === void 0 ? void 0 : updatedJob.locationText) !== null && _a !== void 0 ? _a : params.existingJob.locationText,
                workModel: (_b = updatedJob === null || updatedJob === void 0 ? void 0 : updatedJob.workModel) !== null && _b !== void 0 ? _b : params.existingJob.workModel,
                status: (_d = (_c = updatedJob === null || updatedJob === void 0 ? void 0 : updatedJob.status) !== null && _c !== void 0 ? _c : nextUpdate.status) !== null && _d !== void 0 ? _d : params.existingJob.status,
            }],
    }).catch((error) => {
        console.warn('Register job market demand seed context error:', error);
    });
    return updatedJob;
});
exports.updateCompanyJobStatus = updateCompanyJobStatus;
