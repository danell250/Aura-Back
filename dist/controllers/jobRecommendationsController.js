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
exports.jobRecommendationsController = void 0;
const db_1 = require("../db");
const jobRecommendationService_1 = require("../services/jobRecommendationService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const JOBS_COLLECTION = 'jobs';
const USERS_COLLECTION = 'users';
const toRecommendedJobResponse = (job) => ({
    id: String((job === null || job === void 0 ? void 0 : job.id) || ''),
    slug: (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.slug, 220),
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
    updatedAt: (job === null || job === void 0 ? void 0 : job.updatedAt) || null,
    publishedAt: (job === null || job === void 0 ? void 0 : job.publishedAt) || null,
    announcementPostId: (job === null || job === void 0 ? void 0 : job.announcementPostId) || null,
    applicationUrl: (0, inputSanitizers_1.readStringOrNull)(job === null || job === void 0 ? void 0 : job.applicationUrl, 600),
    applicationEmail: (0, inputSanitizers_1.readStringOrNull)(job === null || job === void 0 ? void 0 : job.applicationEmail, 200),
    applicationCount: Number.isFinite(job === null || job === void 0 ? void 0 : job.applicationCount) ? Number(job.applicationCount) : 0,
});
const fetchRecommendationCandidateJobs = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const preferredConditions = Array.isArray((_a = params.recommendationCandidateFilter) === null || _a === void 0 ? void 0 : _a.$or)
        ? params.recommendationCandidateFilter.$or
        : [];
    if (preferredConditions.length === 0) {
        return params.db.collection(JOBS_COLLECTION)
            .find({ status: 'open' })
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(params.candidateLimit)
            .toArray();
    }
    const coarseLimit = Math.min(1200, Math.max(params.candidateLimit * 4, 480));
    return params.db.collection(JOBS_COLLECTION)
        .aggregate([
        { $match: { status: 'open' } },
        { $sort: { publishedAt: -1, createdAt: -1 } },
        { $limit: coarseLimit },
        {
            $addFields: {
                __recommendationPriority: {
                    $cond: [{ $or: preferredConditions }, 1, 0],
                },
            },
        },
        { $sort: { __recommendationPriority: -1, publishedAt: -1, createdAt: -1 } },
        { $limit: params.candidateLimit },
        { $project: { __recommendationPriority: 0 } },
    ])
        .toArray();
});
const buildRecommendationPayload = (params) => {
    if (params.candidateJobs.length === 0) {
        return {
            data: [],
            pagination: { page: 1, limit: params.limit, total: 0, pages: 0 },
        };
    }
    const scoredJobs = params.candidateJobs.map((job) => {
        const scoreResult = (0, jobRecommendationService_1.buildJobRecommendationScore)(job, params.recommendationProfile);
        return Object.assign({ job }, scoreResult);
    });
    const rankedMatches = scoredJobs
        .filter((entry) => entry.score > 0)
        .sort((a, b) => (b.score - a.score) || (b.publishedTs - a.publishedTs));
    const selectedEntries = (rankedMatches.length > 0 ? rankedMatches : scoredJobs)
        .slice(0, params.limit);
    return {
        data: selectedEntries.map((entry) => (Object.assign(Object.assign({}, toRecommendedJobResponse(entry.job)), { recommendationScore: entry.score, recommendationReasons: entry.reasons.slice(0, 3), matchedSkills: entry.matchedSkills.slice(0, 5) }))),
        pagination: {
            page: 1,
            limit: params.limit,
            total: selectedEntries.length,
            pages: 1,
        },
    };
};
exports.jobRecommendationsController = {
    // GET /api/jobs/recommended
    listRecommendedJobs: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit: 20, total: 0, pages: 0 },
                });
            }
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const db = (0, db_1.getDB)();
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_b = req.query) === null || _b === void 0 ? void 0 : _b.limit, 20, 1, 40);
            const candidateLimit = (0, inputSanitizers_1.parsePositiveInt)((_c = req.query) === null || _c === void 0 ? void 0 : _c.candidateLimit, 120, 40, 160);
            const user = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId }, {
                projection: {
                    id: 1,
                    skills: 1,
                    profileSkills: 1,
                    location: 1,
                    country: 1,
                    industry: 1,
                },
            });
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            const recommendationProfile = (0, jobRecommendationService_1.buildRecommendationProfile)(user);
            const recommendationCandidateFilter = (0, jobRecommendationService_1.buildRecommendationCandidateFilter)(recommendationProfile);
            const candidateJobs = yield fetchRecommendationCandidateJobs({
                db,
                recommendationCandidateFilter,
                candidateLimit,
            });
            const payload = buildRecommendationPayload({
                candidateJobs,
                recommendationProfile,
                limit,
            });
            return res.json(Object.assign({ success: true }, payload));
        }
        catch (error) {
            console.error('List recommended jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch recommended jobs' });
        }
    }),
};
