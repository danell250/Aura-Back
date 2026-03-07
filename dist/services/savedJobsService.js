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
exports.listSavedJobsForUser = exports.unsaveJobForUser = exports.saveJobForUser = exports.attachSavedStateToJobResponses = exports.listSavedJobStatesByUser = exports.getSavedJobStateForUser = void 0;
const crypto_1 = __importDefault(require("crypto"));
const jobDiscoveryQueryService_1 = require("./jobDiscoveryQueryService");
const jobApplicationViewerStateService_1 = require("./jobApplicationViewerStateService");
const jobPulseService_1 = require("./jobPulseService");
const jobResponseService_1 = require("./jobResponseService");
const savedJobStateCacheService_1 = require("./savedJobStateCacheService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const SAVED_JOBS_COLLECTION = 'saved_jobs';
const JOBS_COLLECTION = 'jobs';
const buildSavedJobId = () => `savedjob-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
const toSavedJobState = (doc) => ({
    savedJobId: (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.id, 120),
    jobId: (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.jobId, 120),
    isSaved: true,
    savedAt: (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.createdAt, 80) || null,
});
const buildSavedJobSnapshot = (job) => (Object.assign({}, (0, jobResponseService_1.toJobResponse)(job)));
const buildSavedJobState = (jobId, createdAt) => ({
    savedJobId: buildSavedJobId(),
    jobId,
    isSaved: true,
    savedAt: createdAt,
});
const persistSavedJobInsertSideEffects = (params) => __awaiter(void 0, void 0, void 0, function* () {
    (0, savedJobStateCacheService_1.setCachedSavedJobState)({
        currentUserId: params.currentUserId,
        jobId: params.jobId,
        state: params.savedState,
    });
    yield (0, jobPulseService_1.recordJobPulseEvent)(params.db, {
        jobId: params.jobId,
        type: 'job_saved',
        userId: params.currentUserId,
        createdAt: params.savedState.savedAt || new Date().toISOString(),
    });
});
const fetchSavableJob = (params) => __awaiter(void 0, void 0, void 0, function* () {
    return params.db.collection(JOBS_COLLECTION).findOne({
        id: params.jobId,
        status: { $ne: 'archived' },
    });
});
const querySavedJobStatesByIds = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const jobIds = Array.from(new Set((Array.isArray(params.jobIds) ? params.jobIds : [])
        .map((jobId) => (0, inputSanitizers_1.readString)(jobId, 120))
        .filter((jobId) => jobId.length > 0)));
    if (!currentUserId || jobIds.length === 0) {
        return new Map();
    }
    const rows = yield params.db.collection(SAVED_JOBS_COLLECTION)
        .find({
        userId: currentUserId,
        jobId: { $in: jobIds },
    }, {
        projection: {
            id: 1,
            jobId: 1,
            createdAt: 1,
        },
    })
        .toArray();
    return new Map(rows
        .map((row) => {
        const state = toSavedJobState(row);
        return state.jobId ? [state.jobId, state] : null;
    })
        .filter(Boolean));
});
const resolveSavedJobStates = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const jobIds = Array.from(new Set((Array.isArray(params.jobIds) ? params.jobIds : [])
        .map((jobId) => (0, inputSanitizers_1.readString)(jobId, 120))
        .filter((jobId) => jobId.length > 0)));
    if (!currentUserId || jobIds.length === 0) {
        return new Map();
    }
    const { statesByJobId, missingJobIds } = (0, savedJobStateCacheService_1.getCachedSavedJobStates)({
        currentUserId,
        jobIds,
    });
    if (missingJobIds.length === 0) {
        return statesByJobId;
    }
    const resolvedStates = yield querySavedJobStatesByIds({
        db: params.db,
        currentUserId,
        jobIds: missingJobIds,
    });
    missingJobIds.forEach((jobId) => {
        const state = resolvedStates.get(jobId) || null;
        (0, savedJobStateCacheService_1.setCachedSavedJobState)({
            currentUserId,
            jobId,
            state,
        });
        if (state) {
            statesByJobId.set(jobId, state);
        }
    });
    return statesByJobId;
});
const resolveSavedJobResponseRow = (row) => {
    const liveJob = (row === null || row === void 0 ? void 0 : row.liveJob) && typeof row.liveJob === 'object' ? row.liveJob : null;
    const baseJob = (liveJob && typeof liveJob === 'object' ? (0, jobResponseService_1.toJobResponse)(liveJob) : null)
        || ((row === null || row === void 0 ? void 0 : row.jobSnapshot) && typeof row.jobSnapshot === 'object' ? row.jobSnapshot : null);
    if (!baseJob || typeof baseJob !== 'object') {
        return null;
    }
    return Object.assign(Object.assign({}, baseJob), { isSaved: true, savedAt: (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.createdAt, 80) || null, savedJobId: (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.id, 120) || null, savedJobIsSnapshot: !liveJob });
};
const getSavedJobStateForUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const jobId = (0, inputSanitizers_1.readString)(params.jobId, 120);
    if (!currentUserId || !jobId)
        return null;
    const cachedState = (0, savedJobStateCacheService_1.getCachedSavedJobState)({
        currentUserId,
        jobId,
    });
    if (cachedState !== undefined) {
        return cachedState;
    }
    return (yield resolveSavedJobStates({
        db: params.db,
        currentUserId,
        jobIds: [jobId],
    })).get(jobId) || null;
});
exports.getSavedJobStateForUser = getSavedJobStateForUser;
const listSavedJobStatesByUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    return resolveSavedJobStates({
        db: params.db,
        currentUserId: params.currentUserId,
        jobIds: params.jobIds,
    });
});
exports.listSavedJobStatesByUser = listSavedJobStatesByUser;
const attachSavedStateToJobResponses = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    if (!currentUserId || params.jobs.length === 0) {
        return params.jobs;
    }
    const savedStatesByJobId = yield resolveSavedJobStates({
        db: params.db,
        currentUserId,
        jobIds: params.jobs
            .map((job) => (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120))
            .filter((jobId) => jobId.length > 0),
    });
    return params.jobs.map((job) => {
        const jobId = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120);
        const savedState = savedStatesByJobId.get(jobId);
        return Object.assign(Object.assign({}, job), { isSaved: Boolean(savedState), savedAt: (savedState === null || savedState === void 0 ? void 0 : savedState.savedAt) || null, savedJobId: (savedState === null || savedState === void 0 ? void 0 : savedState.savedJobId) || null });
    });
});
exports.attachSavedStateToJobResponses = attachSavedStateToJobResponses;
const saveJobForUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const jobId = (0, inputSanitizers_1.readString)(params.jobId, 120);
    if (!currentUserId || !jobId) {
        return {
            created: false,
            statusCode: 400,
            error: 'jobId is required',
        };
    }
    const existingState = yield (0, exports.getSavedJobStateForUser)({
        db: params.db,
        currentUserId,
        jobId,
    });
    if (existingState) {
        return {
            created: false,
            state: existingState,
        };
    }
    const job = yield fetchSavableJob({
        db: params.db,
        jobId,
    });
    if (!job) {
        return {
            created: false,
            statusCode: 404,
            error: 'Job not found',
        };
    }
    const now = new Date().toISOString();
    const savedState = buildSavedJobState(jobId, now);
    const savedJobDoc = {
        id: savedState.savedJobId,
        userId: currentUserId,
        jobId,
        createdAt: now,
        updatedAt: now,
        jobSnapshot: buildSavedJobSnapshot(job),
    };
    try {
        yield params.db.collection(SAVED_JOBS_COLLECTION).insertOne(savedJobDoc);
        yield persistSavedJobInsertSideEffects({
            db: params.db,
            currentUserId,
            jobId,
            savedState,
        });
        return {
            created: true,
            state: savedState,
        };
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) !== 11000) {
            throw error;
        }
    }
    const duplicateState = yield (0, exports.getSavedJobStateForUser)({
        db: params.db,
        currentUserId,
        jobId,
    });
    if (!duplicateState) {
        return {
            created: false,
            statusCode: 500,
            error: 'Failed to save job',
        };
    }
    return {
        created: false,
        state: duplicateState,
    };
});
exports.saveJobForUser = saveJobForUser;
const unsaveJobForUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const jobId = (0, inputSanitizers_1.readString)(params.jobId, 120);
    if (!currentUserId || !jobId) {
        return { removed: false };
    }
    const result = yield params.db.collection(SAVED_JOBS_COLLECTION).deleteOne({
        userId: currentUserId,
        jobId,
    });
    (0, savedJobStateCacheService_1.setCachedSavedJobState)({
        currentUserId,
        jobId,
        state: null,
    });
    return {
        removed: Number(result.deletedCount || 0) > 0,
    };
});
exports.unsaveJobForUser = unsaveJobForUser;
const listSavedJobsForUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const pagination = (0, jobDiscoveryQueryService_1.getPagination)(params.query);
    if (!currentUserId) {
        return {
            data: [],
            pagination: { page: pagination.page, limit: pagination.limit, total: 0, pages: 0 },
        };
    }
    const [rows, total] = yield Promise.all([
        params.db.collection(SAVED_JOBS_COLLECTION)
            .aggregate([
            { $match: { userId: currentUserId } },
            { $sort: { createdAt: -1, id: -1 } },
            { $skip: pagination.skip },
            { $limit: pagination.limit },
            {
                $lookup: {
                    from: JOBS_COLLECTION,
                    localField: 'jobId',
                    foreignField: 'id',
                    as: 'liveJob',
                },
            },
            {
                $project: {
                    id: 1,
                    jobId: 1,
                    createdAt: 1,
                    jobSnapshot: 1,
                    liveJob: { $arrayElemAt: ['$liveJob', 0] },
                },
            },
        ])
            .toArray(),
        params.db.collection(SAVED_JOBS_COLLECTION).countDocuments({ userId: currentUserId }),
    ]);
    const jobsWithSavedState = rows
        .map((row) => resolveSavedJobResponseRow(row))
        .filter(Boolean);
    const data = yield (0, jobResponseService_1.attachHeatFieldsToJobResponses)({
        db: params.db,
        jobs: jobsWithSavedState,
    });
    const dataWithViewerState = yield (0, jobApplicationViewerStateService_1.attachViewerApplicationStateToJobResponses)({
        db: params.db,
        currentUserId,
        jobs: data,
    });
    return {
        data: dataWithViewerState,
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total,
            pages: Math.ceil(total / pagination.limit),
        },
    };
});
exports.listSavedJobsForUser = listSavedJobsForUser;
