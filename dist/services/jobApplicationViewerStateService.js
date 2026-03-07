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
exports.attachViewerApplicationStateToJobResponses = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const EMPTY_VIEWER_APPLICATION_STATE = {
    viewerHasApplied: false,
    viewerApplicationId: null,
    viewerApplicationStatus: null,
    viewerAppliedAt: null,
};
const resolveViewerApplicationStates = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const currentUserId = (0, inputSanitizers_1.readString)(params.currentUserId, 120);
    const jobIds = Array.from(new Set((Array.isArray(params.jobIds) ? params.jobIds : [])
        .map((jobId) => (0, inputSanitizers_1.readString)(jobId, 120))
        .filter((jobId) => jobId.length > 0)));
    if (!currentUserId || jobIds.length === 0) {
        return new Map();
    }
    const rows = yield params.db.collection(JOB_APPLICATIONS_COLLECTION)
        .find({
        applicantUserId: currentUserId,
        jobId: { $in: jobIds },
    }, {
        projection: {
            id: 1,
            jobId: 1,
            status: 1,
            createdAt: 1,
        },
    })
        .sort({ createdAt: -1 })
        .toArray();
    const statesByJobId = new Map();
    rows.forEach((row) => {
        const jobId = (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.jobId, 120);
        if (!jobId || statesByJobId.has(jobId))
            return;
        statesByJobId.set(jobId, {
            viewerHasApplied: true,
            viewerApplicationId: (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.id, 120) || null,
            viewerApplicationStatus: (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.status, 40) || null,
            viewerAppliedAt: (0, inputSanitizers_1.readString)(row === null || row === void 0 ? void 0 : row.createdAt, 80) || null,
        });
    });
    return statesByJobId;
});
const attachViewerApplicationStateToJobResponses = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const jobs = Array.isArray(params.jobs) ? params.jobs : [];
    if (jobs.length === 0)
        return [];
    const statesByJobId = yield resolveViewerApplicationStates({
        db: params.db,
        currentUserId: params.currentUserId,
        jobIds: jobs
            .map((job) => (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120))
            .filter((jobId) => jobId.length > 0),
    });
    return jobs.map((job) => {
        const jobId = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 120);
        const viewerApplicationState = statesByJobId.get(jobId) || EMPTY_VIEWER_APPLICATION_STATE;
        return Object.assign(Object.assign({}, job), viewerApplicationState);
    });
});
exports.attachViewerApplicationStateToJobResponses = attachViewerApplicationStateToJobResponses;
