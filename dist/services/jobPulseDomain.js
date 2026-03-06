"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveJobHeatLabel = exports.computeJobHeatScore = exports.computeWindowedJobPulseActivityScore = exports.buildJobPulseBucketWindowSumExpression = exports.buildJobPulseWindowBounds = exports.JOB_PULSE_SAVE_WINDOW_HOURS = exports.JOB_PULSE_MATCH_WINDOW_MINUTES = exports.JOB_PULSE_VIEW_WINDOW_MINUTES = exports.JOB_PULSE_APPLICATION_RECENT_WINDOW_HOURS = exports.JOB_PULSE_APPLICATION_WINDOW_HOURS = void 0;
const jobPulseUtils_1 = require("./jobPulseUtils");
exports.JOB_PULSE_APPLICATION_WINDOW_HOURS = 24;
exports.JOB_PULSE_APPLICATION_RECENT_WINDOW_HOURS = 2;
exports.JOB_PULSE_VIEW_WINDOW_MINUTES = 60;
exports.JOB_PULSE_MATCH_WINDOW_MINUTES = 10;
exports.JOB_PULSE_SAVE_WINDOW_HOURS = 24;
const buildJobPulseWindowBounds = (nowMs) => {
    const now = new Date(nowMs);
    const todaySince = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    return {
        applicationSince: new Date(nowMs - (exports.JOB_PULSE_APPLICATION_WINDOW_HOURS * 60 * 60 * 1000)),
        applicationRecentSince: new Date(nowMs - (exports.JOB_PULSE_APPLICATION_RECENT_WINDOW_HOURS * 60 * 60 * 1000)),
        todaySince,
        viewSince: new Date(nowMs - (exports.JOB_PULSE_VIEW_WINDOW_MINUTES * 60 * 1000)),
        matchSince: new Date(nowMs - (exports.JOB_PULSE_MATCH_WINDOW_MINUTES * 60 * 1000)),
        saveSince: new Date(nowMs - (exports.JOB_PULSE_SAVE_WINDOW_HOURS * 60 * 60 * 1000)),
    };
};
exports.buildJobPulseWindowBounds = buildJobPulseWindowBounds;
const buildJobPulseBucketWindowSumExpression = (counterField, since) => ({
    $sum: {
        $cond: [
            { $gte: ['$bucketStartDate', since] },
            `$${counterField}`,
            0,
        ],
    },
});
exports.buildJobPulseBucketWindowSumExpression = buildJobPulseBucketWindowSumExpression;
const computeWindowedJobPulseActivityScore = (params) => {
    const discoveredMs = (0, jobPulseUtils_1.parseJobPulseIsoMs)(params.discoveredAt);
    const ageHours = discoveredMs > 0
        ? Math.max(0, (params.nowMs - discoveredMs) / (60 * 60 * 1000))
        : 0;
    const freshnessBonus = discoveredMs > 0 ? Math.max(0, 24 - ageHours) : 0;
    return Math.max(0, Math.round((params.applicationsLast24h * 8)
        + (params.viewsLast1h * 2)
        + (params.matchesLast10m * 10)
        + (params.savesLast24h * 4)
        + freshnessBonus));
};
exports.computeWindowedJobPulseActivityScore = computeWindowedJobPulseActivityScore;
const computeJobHeatScore = (params) => Math.max(0, Math.round((params.applicationsLast2h * 4)
    + (params.applicationsToday * 2)
    + Math.floor(params.totalAuraApplications / 10)
    + Math.floor(params.viewsLast1h / 8)
    + Math.floor(params.savesToday / 3)));
exports.computeJobHeatScore = computeJobHeatScore;
const resolveJobHeatLabel = (heatScore) => {
    if (heatScore >= 61)
        return 'extreme';
    if (heatScore >= 21)
        return 'high';
    if (heatScore >= 6)
        return 'moderate';
    return 'low';
};
exports.resolveJobHeatLabel = resolveJobHeatLabel;
