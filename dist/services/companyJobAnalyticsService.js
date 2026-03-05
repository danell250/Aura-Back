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
exports.buildCompanyJobAnalytics = exports.invalidateCompanyJobAnalyticsCache = exports.EMPTY_COMPANY_JOB_ANALYTICS = void 0;
const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const TIME_TO_HIRE_LOOKBACK_DAYS = 365;
const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;
exports.EMPTY_COMPANY_JOB_ANALYTICS = {
    windowDays: TIME_TO_HIRE_LOOKBACK_DAYS,
    funnel: {
        submitted: 0,
        in_review: 0,
        shortlisted: 0,
        hired: 0,
    },
    timeToHire: [],
};
const companyAnalyticsCache = new Map();
const invalidateCompanyJobAnalyticsCache = (companyId) => {
    const normalizedCompanyId = readString(companyId, 120);
    if (!normalizedCompanyId)
        return;
    companyAnalyticsCache.delete(normalizedCompanyId);
};
exports.invalidateCompanyJobAnalyticsCache = invalidateCompanyJobAnalyticsCache;
const readString = (value, maxLength = 120) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    return normalized.slice(0, maxLength);
};
const buildCompanyJobAnalytics = (db, companyId) => __awaiter(void 0, void 0, void 0, function* () {
    const normalizedCompanyId = readString(companyId, 120);
    if (!normalizedCompanyId) {
        return exports.EMPTY_COMPANY_JOB_ANALYTICS;
    }
    const nowMs = Date.now();
    const cached = companyAnalyticsCache.get(normalizedCompanyId);
    if (cached && cached.expiresAt > nowMs) {
        return cached.data;
    }
    const now = new Date();
    const lookbackStartDate = new Date(now.getTime() - TIME_TO_HIRE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const [funnelRows, timeToHireRows] = yield Promise.all([
        db.collection(JOB_APPLICATIONS_COLLECTION)
            .aggregate([
            {
                $match: {
                    companyId: normalizedCompanyId,
                    status: { $in: ['submitted', 'in_review', 'shortlisted', 'hired'] },
                    createdAtDate: { $type: 'date', $gte: lookbackStartDate, $lte: now },
                },
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                },
            },
        ])
            .toArray(),
        db.collection(JOB_APPLICATIONS_COLLECTION)
            .aggregate([
            {
                $match: {
                    companyId: normalizedCompanyId,
                    status: 'hired',
                    createdAtDate: { $type: 'date', $gte: lookbackStartDate, $lte: now },
                    reviewedAtDate: { $type: 'date', $gte: lookbackStartDate, $lte: now },
                },
            },
            {
                $project: {
                    jobId: 1,
                    jobTitleSnapshot: 1,
                    createdAtDate: 1,
                    reviewedAtDate: 1,
                },
            },
            {
                $match: {
                    $expr: {
                        $and: [
                            { $gte: ['$reviewedAtDate', '$createdAtDate'] },
                        ],
                    },
                },
            },
            {
                $project: {
                    jobId: 1,
                    jobTitleSnapshot: 1,
                    daysToHire: {
                        $dateDiff: {
                            startDate: '$createdAtDate',
                            endDate: '$reviewedAtDate',
                            unit: 'day',
                        },
                    },
                },
            },
            {
                $match: {
                    daysToHire: { $gte: 0 },
                },
            },
            {
                $group: {
                    _id: '$jobId',
                    avgDays: { $avg: '$daysToHire' },
                    hires: { $sum: 1 },
                    jobTitleSnapshot: { $first: '$jobTitleSnapshot' },
                },
            },
            {
                $match: {
                    _id: { $type: 'string' },
                    hires: { $gt: 0 },
                    avgDays: { $ne: null, $gte: 0 },
                },
            },
            {
                $project: {
                    _id: 0,
                    jobId: '$_id',
                    jobTitle: '$jobTitleSnapshot',
                    avgDays: { $ifNull: [{ $round: ['$avgDays', 2] }, 0] },
                    hires: 1,
                },
            },
            { $sort: { avgDays: 1 } },
        ])
            .toArray(),
    ]);
    const funnelCounts = {
        submitted: 0,
        in_review: 0,
        shortlisted: 0,
        hired: 0,
    };
    for (const row of funnelRows) {
        const status = readString(row === null || row === void 0 ? void 0 : row._id, 40);
        const count = Number.isFinite(row === null || row === void 0 ? void 0 : row.count) ? Number(row.count) : 0;
        if (status in funnelCounts) {
            funnelCounts[status] = count;
        }
    }
    const normalizedRows = (timeToHireRows || [])
        .map((row) => {
        const jobId = readString(row === null || row === void 0 ? void 0 : row.jobId, 120);
        const snapshotTitle = readString(row === null || row === void 0 ? void 0 : row.jobTitle, 180);
        const avgDays = Number.isFinite(row === null || row === void 0 ? void 0 : row.avgDays) ? Number(row.avgDays) : null;
        const hires = Number.isFinite(row === null || row === void 0 ? void 0 : row.hires) ? Number(row.hires) : 0;
        if (!jobId || hires <= 0 || avgDays == null || avgDays < 0)
            return null;
        return {
            jobId,
            snapshotTitle,
            avgDays,
            hires,
        };
    })
        .filter((row) => Boolean(row));
    const missingTitleJobIds = Array.from(new Set(normalizedRows
        .filter((row) => !row.snapshotTitle)
        .map((row) => row.jobId)));
    const jobsForMissingTitles = missingTitleJobIds.length > 0
        ? yield db.collection(JOBS_COLLECTION)
            .find({
            companyId: normalizedCompanyId,
            id: { $in: missingTitleJobIds },
        }, { projection: { id: 1, title: 1 } })
            .toArray()
        : [];
    const fallbackJobTitleById = new Map();
    for (const job of jobsForMissingTitles) {
        const id = readString(job === null || job === void 0 ? void 0 : job.id, 120);
        if (!id)
            continue;
        const title = readString(job === null || job === void 0 ? void 0 : job.title, 180);
        if (title)
            fallbackJobTitleById.set(id, title);
    }
    const timeToHire = normalizedRows
        .map((row) => ({
        jobId: row.jobId,
        jobTitle: row.snapshotTitle || fallbackJobTitleById.get(row.jobId) || 'Untitled role',
        avgDays: row.avgDays,
        hires: row.hires,
    }))
        .sort((a, b) => a.avgDays - b.avgDays);
    const result = {
        windowDays: TIME_TO_HIRE_LOOKBACK_DAYS,
        funnel: {
            submitted: funnelCounts.submitted,
            in_review: funnelCounts.in_review,
            shortlisted: funnelCounts.shortlisted,
            hired: funnelCounts.hired,
        },
        timeToHire,
    };
    companyAnalyticsCache.set(normalizedCompanyId, {
        data: result,
        expiresAt: nowMs + ANALYTICS_CACHE_TTL_MS,
    });
    return result;
});
exports.buildCompanyJobAnalytics = buildCompanyJobAnalytics;
