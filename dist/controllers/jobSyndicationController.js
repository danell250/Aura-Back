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
exports.jobSyndicationController = void 0;
const db_1 = require("../db");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobSyndicationService_1 = require("../services/jobSyndicationService");
const jobsController_1 = require("./jobsController");
const JOBS_COLLECTION = 'jobs';
const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const OPEN_JOBS_FEED_DEFAULT_LIMIT = 50;
const OPEN_JOBS_FEED_MAX_LIMIT = 100;
const AURA_PUBLIC_WEB_BASE_URL = ((0, inputSanitizers_1.readString)(process.env.AURA_PUBLIC_WEB_URL, 320)
    || (0, inputSanitizers_1.readString)(process.env.FRONTEND_URL, 320)
    || (0, inputSanitizers_1.readString)(process.env.VITE_FRONTEND_URL, 320)
    || 'https://aura.social').replace(/\/+$/, '');
const resolveFeedSlug = (job) => (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.slug, 220)
    || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 220)
    || 'job';
const buildAuraJobApplyUrl = (job) => {
    const slug = resolveFeedSlug(job);
    return `${AURA_PUBLIC_WEB_BASE_URL}/jobs/${encodeURIComponent(slug)}`;
};
const normalizeExternalUrl = (value) => {
    const raw = (0, inputSanitizers_1.readString)(String(value || ''), 600);
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
const resolveUrlHostname = (value) => {
    if (!value)
        return null;
    try {
        const parsed = new URL(value);
        const hostname = (0, inputSanitizers_1.readString)(parsed.hostname, 220).toLowerCase().replace(/^www\./, '');
        return hostname || null;
    }
    catch (_a) {
        return null;
    }
};
const parseSourceSite = (value) => {
    const source = (0, inputSanitizers_1.readString)(value, 120).toLowerCase();
    if (!source)
        return '';
    const [, suffix = source] = source.split(':', 2);
    return (0, inputSanitizers_1.readString)(suffix, 120).toLowerCase();
};
const toOpenFeedJobItem = (job) => {
    const sourceUrl = normalizeExternalUrl(job === null || job === void 0 ? void 0 : job.originalUrl) ||
        normalizeExternalUrl(job === null || job === void 0 ? void 0 : job.applicationUrl);
    const sourceSite = parseSourceSite(job === null || job === void 0 ? void 0 : job.source) || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.source, 120).toLowerCase() || 'aura';
    const auraUrl = buildAuraJobApplyUrl(job);
    const postedAt = (0, inputSanitizers_1.readString)(String((job === null || job === void 0 ? void 0 : job.publishedAt) || (job === null || job === void 0 ? void 0 : job.createdAt) || ''), 80) || null;
    return {
        id: String((job === null || job === void 0 ? void 0 : job.id) || ''),
        title: String((job === null || job === void 0 ? void 0 : job.title) || ''),
        company: String((job === null || job === void 0 ? void 0 : job.companyName) || ''),
        location: String((job === null || job === void 0 ? void 0 : job.locationText) || ''),
        summary: String((job === null || job === void 0 ? void 0 : job.summary) || ''),
        work_model: String((job === null || job === void 0 ? void 0 : job.workModel) || ''),
        employment_type: String((job === null || job === void 0 ? void 0 : job.employmentType) || ''),
        salary_min: typeof (job === null || job === void 0 ? void 0 : job.salaryMin) === 'number' ? job.salaryMin : null,
        salary_max: typeof (job === null || job === void 0 ? void 0 : job.salaryMax) === 'number' ? job.salaryMax : null,
        salary_currency: String((job === null || job === void 0 ? void 0 : job.salaryCurrency) || ''),
        posted_at: postedAt,
        apply_url: auraUrl,
        aura_url: auraUrl,
        source: sourceSite,
        source_domain: resolveUrlHostname(sourceUrl),
        original_url: sourceUrl,
    };
};
exports.jobSyndicationController = {
    // GET /api/jobs/open-feed
    getOpenJobsFeed: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
            res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=300');
            const query = req.query;
            const page = (0, inputSanitizers_1.parsePositiveInt)(query.page, 1, 1, 100000);
            const limit = (0, inputSanitizers_1.parsePositiveInt)(query.limit, OPEN_JOBS_FEED_DEFAULT_LIMIT, 1, OPEN_JOBS_FEED_MAX_LIMIT);
            const skip = (page - 1) * limit;
            const workModelRaw = (0, inputSanitizers_1.readString)(query.workModel, 80).toLowerCase()
                || (0, inputSanitizers_1.readString)(query.work_model, 80).toLowerCase()
                || (0, inputSanitizers_1.readString)(query['work-model'], 80).toLowerCase();
            const employmentTypeRaw = (0, inputSanitizers_1.readString)(query.employmentType, 80).toLowerCase()
                || (0, inputSanitizers_1.readString)(query.employment_type, 80).toLowerCase()
                || (0, inputSanitizers_1.readString)(query['employment-type'], 80).toLowerCase();
            const locationRaw = (0, inputSanitizers_1.readString)(query.location, 100)
                || (0, inputSanitizers_1.readString)(query.country, 100);
            const companyRaw = (0, inputSanitizers_1.readString)(query.company, 100);
            const searchRaw = (0, inputSanitizers_1.readString)(query.q, 120)
                || (0, inputSanitizers_1.readString)(query.search, 120)
                || (0, inputSanitizers_1.readString)(query.query, 120);
            const postedWithinHours = Number((_b = (_a = query.postedWithinHours) !== null && _a !== void 0 ? _a : query.posted_within_hours) !== null && _b !== void 0 ? _b : query.hours_old);
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    meta: {
                        generatedAt: new Date().toISOString(),
                        attribution: 'Powered by Aura',
                        sourceUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs`,
                        widgetScriptUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs-widget.js`,
                    },
                    pagination: { page, limit, total: 0, pages: 0 },
                });
            }
            const db = (0, db_1.getDB)();
            const querySpec = (0, jobsController_1.buildPublicJobsQuerySpec)({
                allowTextSearch: true,
                workModelRaw,
                employmentTypeRaw,
                locationRaw,
                companyRaw,
                searchRaw,
                status: 'open',
                minSalary: Number.NaN,
                maxSalary: Number.NaN,
                postedWithinHours,
                sortBy: 'latest',
            });
            const filter = querySpec.filter;
            const [rows, total] = yield Promise.all([
                db.collection(JOBS_COLLECTION)
                    .find(filter, querySpec.usesTextSearch
                    ? {
                        projection: { score: { $meta: 'textScore' } },
                    }
                    : undefined)
                    .sort(querySpec.sort)
                    .skip(skip)
                    .limit(limit)
                    .toArray(),
                db.collection(JOBS_COLLECTION).countDocuments(filter),
            ]);
            const items = rows.map(toOpenFeedJobItem);
            return res.json({
                success: true,
                data: items,
                meta: {
                    generatedAt: new Date().toISOString(),
                    attribution: 'Powered by Aura',
                    sourceUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs`,
                    widgetScriptUrl: `${AURA_PUBLIC_WEB_BASE_URL}/jobs-widget.js`,
                    count: items.length,
                },
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                },
            });
        }
        catch (error) {
            const message = String((error === null || error === void 0 ? void 0 : error.message) || '').toLowerCase();
            if (message.includes('text index')) {
                return res.status(503).json({
                    success: false,
                    error: 'Search index is warming up. Please retry in a moment.',
                });
            }
            console.error('Get open jobs feed error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch open jobs feed' });
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
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_a = req.query) === null || _a === void 0 ? void 0 : _a.limit, 100, 1, 250);
            const statusRaw = (0, inputSanitizers_1.readString)((_b = req.query) === null || _b === void 0 ? void 0 : _b.status, 40).toLowerCase();
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
            const feed = (0, jobSyndicationService_1.buildJobsSyndicationFeed)(jobs.map(jobsController_1.toJobResponse));
            res.setHeader('Content-Type', 'application/feed+json; charset=utf-8');
            return res.status(200).json(feed);
        }
        catch (error) {
            console.error('Get jobs for syndication error:', error);
            return res.status(500).json({ success: false, error: 'Failed to build jobs syndication feed' });
        }
    }),
};
