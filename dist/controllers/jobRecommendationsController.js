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
const jobRecommendationQueryBuilder_1 = require("../services/jobRecommendationQueryBuilder");
const jobRecommendationResultService_1 = require("../services/jobRecommendationResultService");
const jobPulseSnapshotService_1 = require("../services/jobPulseSnapshotService");
const jobApplicationViewerStateService_1 = require("../services/jobApplicationViewerStateService");
const jobResponseService_1 = require("../services/jobResponseService");
const savedJobsService_1 = require("../services/savedJobsService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const USERS_COLLECTION = 'users';
const normalizePreviewSkills = (value) => {
    if (Array.isArray(value)) {
        return value
            .flatMap((item) => String(item || '').split(','))
            .map((item) => (0, inputSanitizers_1.readString)(item, 80))
            .filter((item) => item.length > 0)
            .slice(0, 20);
    }
    return (0, inputSanitizers_1.readString)(value, 400)
        .split(',')
        .map((item) => (0, inputSanitizers_1.readString)(item, 80))
        .filter((item) => item.length > 0)
        .slice(0, 20);
};
const toRecommendationResponseEntry = (job, recommendation) => (Object.assign(Object.assign({}, (0, jobResponseService_1.toJobResponse)(job)), { recommendationScore: recommendation.score, recommendationReasons: recommendation.reasons.slice(0, 3), matchedSkills: recommendation.matchedSkills.slice(0, 5), recommendationBreakdown: recommendation.breakdown, matchTier: recommendation.matchTier }));
const buildRecommendationPayload = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.candidateJobs.length === 0) {
        return {
            data: [],
            groups: { best: 0, good: 0, other: 0 },
            pagination: { page: 1, limit: params.limit, total: 0, pages: 0 },
        };
    }
    const { entries, groups } = yield (0, jobRecommendationResultService_1.buildRankedRecommendationEntries)({
        candidateJobs: params.candidateJobs,
        recommendationProfile: params.recommendationProfile,
        limit: params.limit,
    });
    const pulseSnapshotsByJobId = new Map((yield (0, jobPulseSnapshotService_1.listJobPulseSnapshots)({
        db: params.db,
        requestedJobIds: entries.map((entry) => { var _a; return (0, inputSanitizers_1.readString)((_a = entry === null || entry === void 0 ? void 0 : entry.job) === null || _a === void 0 ? void 0 : _a.id, 120); }).filter((jobId) => jobId.length > 0),
        limit: entries.length,
    })).map((snapshot) => [(0, inputSanitizers_1.readString)(snapshot === null || snapshot === void 0 ? void 0 : snapshot.jobId, 120), snapshot]));
    const dataWithHeat = entries.map((entry) => {
        var _a;
        const score = Math.max(0, Math.round(entry.score));
        return Object.assign(Object.assign({}, toRecommendationResponseEntry(entry.job, {
            score,
            reasons: entry.reasons,
            matchedSkills: entry.matchedSkills,
            breakdown: entry.breakdown,
            matchTier: entry.matchTier,
        })), (0, jobPulseSnapshotService_1.buildJobHeatResponseFields)({ snapshot: pulseSnapshotsByJobId.get((0, inputSanitizers_1.readString)((_a = entry === null || entry === void 0 ? void 0 : entry.job) === null || _a === void 0 ? void 0 : _a.id, 120)) }));
    });
    return {
        data: yield (0, jobApplicationViewerStateService_1.attachViewerApplicationStateToJobResponses)({
            db: params.db,
            currentUserId: params.currentUserId,
            jobs: yield (0, savedJobsService_1.attachSavedStateToJobResponses)({
                db: params.db,
                currentUserId: params.currentUserId,
                jobs: dataWithHeat,
            }),
        }),
        groups,
        pagination: {
            page: 1,
            limit: params.limit,
            total: entries.length,
            pages: 1,
        },
    };
});
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
            const candidateLimit = (0, inputSanitizers_1.parsePositiveInt)((_c = req.query) === null || _c === void 0 ? void 0 : _c.candidateLimit, 80, 30, 90);
            const user = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId }, {
                projection: {
                    id: 1,
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
            const recommendationProfile = (0, jobRecommendationService_1.buildRecommendationProfile)(user);
            const recommendationCandidateCriteria = (0, jobRecommendationService_1.buildRecommendationCandidateCriteria)(recommendationProfile);
            const recommendationCandidateFilter = (0, jobRecommendationQueryBuilder_1.buildRecommendationCandidateMongoFilter)(recommendationCandidateCriteria);
            const candidateJobs = yield (0, jobRecommendationResultService_1.fetchPrioritizedRecommendationCandidateJobs)({
                db,
                recommendationCandidateFilter,
                candidateLimit,
                hasPrioritySignals: recommendationCandidateCriteria.skillTokens.length > 0
                    || recommendationCandidateCriteria.semanticTokens.length > 0
                    || recommendationCandidateCriteria.preferredWorkModels.length > 0,
            });
            const payload = yield buildRecommendationPayload({
                db,
                candidateJobs,
                recommendationProfile,
                limit,
                currentUserId,
            });
            return res.json(Object.assign({ success: true }, payload));
        }
        catch (error) {
            console.error('List recommended jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch recommended jobs' });
        }
    }),
    // GET /api/jobs/for-you
    listPreviewJobs: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        try {
            const role = (0, inputSanitizers_1.readString)((_a = req.query) === null || _a === void 0 ? void 0 : _a.role, 120);
            const location = (0, inputSanitizers_1.readString)((_b = req.query) === null || _b === void 0 ? void 0 : _b.location, 120);
            const workModel = (0, inputSanitizers_1.readString)((_c = req.query) === null || _c === void 0 ? void 0 : _c.workModel, 40).toLowerCase();
            const skills = normalizePreviewSkills((_d = req.query) === null || _d === void 0 ? void 0 : _d.skills);
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_e = req.query) === null || _e === void 0 ? void 0 : _e.limit, 20, 1, 30);
            const candidateLimit = (0, inputSanitizers_1.parsePositiveInt)((_f = req.query) === null || _f === void 0 ? void 0 : _f.candidateLimit, 80, 30, 90);
            const currentUserId = (0, inputSanitizers_1.readString)((_g = req.user) === null || _g === void 0 ? void 0 : _g.id, 120);
            if (!role && !location && !workModel && skills.length === 0) {
                return res.status(400).json({ success: false, error: 'At least one preview signal is required' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({
                    success: false,
                    error: 'Preview recommendations are temporarily unavailable',
                });
            }
            const db = (0, db_1.getDB)();
            const recommendationProfile = (0, jobRecommendationService_1.buildRecommendationProfile)({
                title: role,
                skills,
                location,
                preferredWorkModels: workModel ? [workModel] : [],
            });
            const recommendationCandidateCriteria = (0, jobRecommendationService_1.buildRecommendationCandidateCriteria)(recommendationProfile);
            const recommendationCandidateFilter = (0, jobRecommendationQueryBuilder_1.buildRecommendationCandidateMongoFilter)(recommendationCandidateCriteria);
            const candidateJobs = yield (0, jobRecommendationResultService_1.fetchPrioritizedRecommendationCandidateJobs)({
                db,
                recommendationCandidateFilter,
                candidateLimit,
                hasPrioritySignals: recommendationCandidateCriteria.skillTokens.length > 0
                    || recommendationCandidateCriteria.semanticTokens.length > 0
                    || recommendationCandidateCriteria.preferredWorkModels.length > 0,
            });
            const payload = yield buildRecommendationPayload({
                db,
                candidateJobs,
                recommendationProfile,
                limit,
                currentUserId,
            });
            return res.json(Object.assign(Object.assign({ success: true }, payload), { meta: {
                    preview: {
                        role,
                        location,
                        workModel: workModel || null,
                        skills,
                        requiresSignupForSaveAndApply: true,
                    },
                } }));
        }
        catch (error) {
            console.error('List preview jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch preview jobs' });
        }
    }),
};
