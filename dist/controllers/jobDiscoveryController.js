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
exports.jobDiscoveryController = void 0;
const db_1 = require("../db");
const jobRecommendationService_1 = require("../services/jobRecommendationService");
const jobRecommendationProfileCacheService_1 = require("../services/jobRecommendationProfileCacheService");
const jobDiscoveryQueryService_1 = require("../services/jobDiscoveryQueryService");
const jobResponseService_1 = require("../services/jobResponseService");
const jobApplicationViewerStateService_1 = require("../services/jobApplicationViewerStateService");
const savedJobsService_1 = require("../services/savedJobsService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const MIN_SALARY_INSIGHTS_SAMPLE_SIZE = 3;
const parsePublicJobsRequestState = (req) => {
    var _a;
    const statusRaw = (0, inputSanitizers_1.readString)(req.query.status, 40).toLowerCase() || 'open';
    return {
        status: statusRaw === 'all' ? 'all' : statusRaw,
        workModelRaw: (0, inputSanitizers_1.readString)(req.query.workModel, 80).toLowerCase(),
        employmentTypeRaw: (0, inputSanitizers_1.readString)(req.query.employmentType, 80).toLowerCase(),
        locationRaw: (0, inputSanitizers_1.readString)(req.query.location, 100),
        companyRaw: (0, inputSanitizers_1.readString)(req.query.company, 100),
        searchRaw: (0, inputSanitizers_1.readString)(req.query.q, 120),
        minSalary: Number(req.query.salaryMin),
        maxSalary: Number(req.query.salaryMax),
        postedWithinHours: Number(req.query.postedWithinHours),
        sortBy: (0, inputSanitizers_1.readString)(req.query.sort, 40).toLowerCase() || 'latest',
        pagination: (0, jobDiscoveryQueryService_1.getPagination)(req.query),
        currentUserId: (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120),
    };
};
const validatePublicJobsRequestState = (state) => {
    if (state.status !== 'all' && !jobDiscoveryQueryService_1.ALLOWED_JOB_STATUSES.has(state.status)) {
        return 'Invalid status filter';
    }
    if (Number.isFinite(state.minSalary) &&
        Number.isFinite(state.maxSalary) &&
        state.minSalary > 0 &&
        state.maxSalary > 0 &&
        state.maxSalary < state.minSalary) {
        return 'salaryMax cannot be less than salaryMin';
    }
    return null;
};
const resolvePublicJobsQueryContext = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const allowTextSearch = yield (0, jobDiscoveryQueryService_1.ensureJobsTextIndex)(params.db);
    if (params.state.searchRaw && !allowTextSearch) {
        return { error: 'Search index is warming up. Please retry in a moment.' };
    }
    const querySpec = (0, jobDiscoveryQueryService_1.buildPublicJobsQuerySpec)({
        status: params.state.status,
        workModelRaw: params.state.workModelRaw,
        employmentTypeRaw: params.state.employmentTypeRaw,
        locationRaw: params.state.locationRaw,
        companyRaw: params.state.companyRaw,
        searchRaw: params.state.searchRaw,
        minSalary: params.state.minSalary,
        maxSalary: params.state.maxSalary,
        postedWithinHours: params.state.postedWithinHours,
        sortBy: params.state.sortBy,
        allowTextSearch,
    });
    const discoveredThresholdIso = new Date(Date.now() - (jobDiscoveryQueryService_1.JOB_DISCOVERED_WINDOW_MINUTES * 60 * 1000)).toISOString();
    return {
        querySpec,
        discoveredFilter: (0, jobDiscoveryQueryService_1.buildDiscoveredWindowFilter)(querySpec.filter, discoveredThresholdIso),
        discoveredCountCacheKey: (0, jobDiscoveryQueryService_1.buildDiscoveredCountCacheKey)({
            status: params.state.status,
            workModelRaw: params.state.workModelRaw,
            employmentTypeRaw: params.state.employmentTypeRaw,
            locationRaw: params.state.locationRaw,
            companyRaw: params.state.companyRaw,
            searchRaw: params.state.searchRaw,
            minSalary: Number.isFinite(params.state.minSalary) ? params.state.minSalary : '',
            maxSalary: Number.isFinite(params.state.maxSalary) ? params.state.maxSalary : '',
            postedWithinHours: Number.isFinite(params.state.postedWithinHours) ? params.state.postedWithinHours : '',
        }),
        recommendationProfilePromise: (0, jobRecommendationProfileCacheService_1.resolveCachedRecommendationProfile)(params.db, params.state.currentUserId),
    };
});
const loadPublicJobsPageData = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const [items, total, discoveredLast30Minutes, recommendationProfile] = yield Promise.all([
        params.db.collection(jobDiscoveryQueryService_1.JOBS_COLLECTION)
            .find(params.querySpec.filter, params.querySpec.usesTextSearch
            ? {
                projection: { score: { $meta: 'textScore' } },
            }
            : undefined)
            .sort(params.querySpec.sort)
            .skip(params.state.pagination.skip)
            .limit(params.state.pagination.limit)
            .toArray(),
        params.db.collection(jobDiscoveryQueryService_1.JOBS_COLLECTION).countDocuments(params.querySpec.filter),
        (0, jobDiscoveryQueryService_1.resolveCachedDiscoveredCount)(params.db, params.discoveredFilter, params.discoveredCountCacheKey),
        params.recommendationProfilePromise,
    ]);
    return {
        items,
        total,
        discoveredLast30Minutes,
        recommendationProfile,
    };
});
const enrichPublicJobsRows = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const jobsWithRecommendations = params.items.map((item) => {
        const base = (0, jobResponseService_1.toJobResponse)(item);
        if (!params.recommendationProfile)
            return base;
        const recommendation = (0, jobRecommendationService_1.buildJobRecommendationScore)(item, params.recommendationProfile);
        const roundedScore = Math.max(0, Math.round(recommendation.score));
        return Object.assign(Object.assign({}, base), { recommendationScore: roundedScore, recommendationReasons: recommendation.reasons.slice(0, 3), matchedSkills: recommendation.matchedSkills.slice(0, 5), recommendationBreakdown: recommendation.breakdown, matchTier: (0, jobRecommendationService_1.resolveRecommendationMatchTier)(roundedScore) });
    });
    return (0, jobResponseService_1.attachHeatFieldsToJobResponses)({
        db: params.db,
        jobs: yield (0, jobApplicationViewerStateService_1.attachViewerApplicationStateToJobResponses)({
            db: params.db,
            currentUserId: params.currentUserId,
            jobs: yield (0, savedJobsService_1.attachSavedStateToJobResponses)({
                db: params.db,
                currentUserId: params.currentUserId,
                jobs: jobsWithRecommendations,
            }),
        }),
    });
});
exports.jobDiscoveryController = {
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
            const state = parsePublicJobsRequestState(req);
            const validationError = validatePublicJobsRequestState(state);
            if (validationError) {
                return res.status(400).json({ success: false, error: validationError });
            }
            const queryContext = yield resolvePublicJobsQueryContext({ db, state });
            if ('error' in queryContext) {
                return res.status(503).json({
                    success: false,
                    error: queryContext.error,
                });
            }
            const pageData = yield loadPublicJobsPageData({
                db,
                state,
                querySpec: queryContext.querySpec,
                discoveredFilter: queryContext.discoveredFilter,
                discoveredCountCacheKey: queryContext.discoveredCountCacheKey,
                recommendationProfilePromise: queryContext.recommendationProfilePromise,
            });
            const jobsWithHeat = yield enrichPublicJobsRows({
                db,
                items: pageData.items,
                recommendationProfile: pageData.recommendationProfile,
                currentUserId: state.currentUserId,
            });
            return res.json({
                success: true,
                data: jobsWithHeat,
                meta: {
                    discoveredLast30Minutes: Number.isFinite(pageData.discoveredLast30Minutes) && pageData.discoveredLast30Minutes > 0
                        ? Number(pageData.discoveredLast30Minutes)
                        : 0,
                },
                pagination: {
                    page: state.pagination.page,
                    limit: state.pagination.limit,
                    total: pageData.total,
                    pages: Math.ceil(pageData.total / state.pagination.limit),
                },
            });
        }
        catch (error) {
            console.error('List public jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
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
            const currentJobId = (0, inputSanitizers_1.readString)(req.query.currentJobId, 120);
            if (!jobTitle || !location) {
                return res.status(400).json({ success: false, error: 'jobTitle and location are required' });
            }
            const db = (0, db_1.getDB)();
            const allowTextSearch = yield (0, jobDiscoveryQueryService_1.ensureJobsTextIndex)(db);
            if (!allowTextSearch) {
                return res.status(503).json({
                    success: false,
                    error: 'Search index is warming up. Please retry in a moment.',
                });
            }
            const normalizedTitle = jobTitle.toLowerCase();
            const normalizedLocation = location.toLowerCase();
            let safeCurrentJobId = '';
            if (currentJobId) {
                const currentJob = yield db.collection(jobDiscoveryQueryService_1.JOBS_COLLECTION).findOne({ id: currentJobId, status: 'open' }, {
                    projection: {
                        id: 1,
                        title: 1,
                        locationText: 1,
                    },
                });
                const currentJobTitle = (0, inputSanitizers_1.readString)(currentJob === null || currentJob === void 0 ? void 0 : currentJob.title, 140).toLowerCase();
                const currentJobLocation = (0, inputSanitizers_1.readString)(currentJob === null || currentJob === void 0 ? void 0 : currentJob.locationText, 140).toLowerCase();
                if (currentJobTitle === normalizedTitle && currentJobLocation === normalizedLocation) {
                    safeCurrentJobId = currentJobId;
                }
            }
            const searchText = `${jobTitle} ${location}`.trim();
            const missingMinSentinel = Number.MAX_SAFE_INTEGER;
            const missingMaxSentinel = -1;
            const [aggregated] = yield db.collection(jobDiscoveryQueryService_1.JOBS_COLLECTION)
                .aggregate([
                {
                    $match: Object.assign(Object.assign({}, (safeCurrentJobId ? { id: { $ne: safeCurrentJobId } } : {})), { status: 'open', $text: { $search: searchText }, $or: [
                            { salaryMin: { $type: 'number' } },
                            { salaryMax: { $type: 'number' } },
                        ] }),
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
            const safeSampleSize = Number.isFinite(aggregated === null || aggregated === void 0 ? void 0 : aggregated.sampleSize) ? Number(aggregated.sampleSize) : 0;
            if (safeSampleSize < MIN_SALARY_INSIGHTS_SAMPLE_SIZE) {
                return res.json({
                    success: true,
                    data: {
                        sampleSize: 0,
                        avgMin: null,
                        avgMax: null,
                        minSalary: null,
                        maxSalary: null,
                    },
                });
            }
            return res.json({
                success: true,
                data: {
                    sampleSize: safeSampleSize,
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
};
