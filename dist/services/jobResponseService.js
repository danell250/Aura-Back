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
exports.attachHeatFieldsToJobResponses = exports.toJobResponse = exports.buildPersistentJobSlug = void 0;
const jobPulseSnapshotService_1 = require("./jobPulseSnapshotService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const CAREER_PAGE_SOURCE_SITES = new Set(['greenhouse', 'lever', 'workday', 'smartrecruiters', 'careers']);
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
exports.buildPersistentJobSlug = buildPersistentJobSlug;
const parseSourceSite = (value) => {
    const source = (0, inputSanitizers_1.readString)(value, 120).toLowerCase();
    if (!source)
        return '';
    const [, suffix = source] = source.split(':', 2);
    return (0, inputSanitizers_1.readString)(suffix, 120).toLowerCase();
};
const toJobResponse = (job) => ({
    id: String((job === null || job === void 0 ? void 0 : job.id) || ''),
    slug: (0, exports.buildPersistentJobSlug)(job),
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
    return params.jobs.map((job) => (Object.assign(Object.assign({}, job), (0, jobPulseSnapshotService_1.buildJobHeatResponseFields)({ snapshot: pulseSnapshotsByJobId.get((0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120)) }))));
});
exports.attachHeatFieldsToJobResponses = attachHeatFieldsToJobResponses;
