"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobMarketDemandEntries = exports.buildJobMarketDemandLevel = exports.resolveJobMarketDemandScore = exports.resolveSingleCurrencySalaryStats = void 0;
const resolveSalaryValueFromAggregatedRow = (row) => {
    const salarySum = typeof row.salarySum === 'number' && Number.isFinite(row.salarySum) ? row.salarySum : 0;
    const salarySampleSize = typeof row.salarySampleSize === 'number' && Number.isFinite(row.salarySampleSize)
        ? row.salarySampleSize
        : 0;
    if (salarySampleSize <= 0)
        return null;
    return Math.round(salarySum / salarySampleSize);
};
const resolveSingleCurrencySalaryStats = (salaryByCurrency) => {
    if (salaryByCurrency.size !== 1) {
        return {
            avgSalary: null,
            salaryCurrency: null,
            salarySampleSize: 0,
            salarySum: 0,
        };
    }
    const [[salaryCurrency, stats]] = Array.from(salaryByCurrency.entries());
    const avgSalary = resolveSalaryValueFromAggregatedRow(stats);
    if (!salaryCurrency || avgSalary == null) {
        return {
            avgSalary: null,
            salaryCurrency: null,
            salarySampleSize: 0,
            salarySum: 0,
        };
    }
    return {
        avgSalary,
        salaryCurrency,
        salarySampleSize: stats.salarySampleSize,
        salarySum: stats.salarySum,
    };
};
exports.resolveSingleCurrencySalaryStats = resolveSingleCurrencySalaryStats;
const resolveJobMarketDemandScore = (entry) => (entry.activeJobs * 2) + (entry.newJobs24h * 4) + (entry.newJobs7d * 2);
exports.resolveJobMarketDemandScore = resolveJobMarketDemandScore;
const buildJobMarketDemandLevel = (groups, current) => {
    const demandScores = groups.map(exports.resolveJobMarketDemandScore);
    const maxActiveJobs = groups.reduce((max, entry) => Math.max(max, entry.activeJobs), 0);
    const maxDemandScore = demandScores.reduce((max, entry) => Math.max(max, entry), 0);
    const currentScore = (0, exports.resolveJobMarketDemandScore)(current);
    const highActiveThreshold = Math.max(6, Math.ceil(maxActiveJobs * 0.7));
    const mediumActiveThreshold = Math.max(3, Math.ceil(maxActiveJobs * 0.35));
    const highScoreThreshold = Math.max(16, Math.ceil(maxDemandScore * 0.75));
    const mediumScoreThreshold = Math.max(7, Math.ceil(maxDemandScore * 0.45));
    if (current.activeJobs >= highActiveThreshold || currentScore >= highScoreThreshold)
        return 'HIGH';
    if (current.activeJobs >= mediumActiveThreshold || currentScore >= mediumScoreThreshold)
        return 'MEDIUM';
    return 'LOW';
};
exports.buildJobMarketDemandLevel = buildJobMarketDemandLevel;
const buildJobMarketDemandEntries = (params) => {
    const allGroups = Array.from(params.groups.values());
    const demandReference = allGroups.map((entry) => ({
        activeJobs: entry.activeJobs,
        newJobs24h: entry.newJobs24h,
        newJobs7d: entry.newJobs7d,
    }));
    const filtered = allGroups
        .filter((entry) => params.requestedRoleFamilies.size === 0 || params.requestedRoleFamilies.has(entry.roleFamily))
        .map((entry) => {
        var _a;
        const baseline = (_a = params.baselineSnapshots) === null || _a === void 0 ? void 0 : _a.get(entry.roleFamily);
        const delta7d = params.baselineSnapshots
            ? entry.activeJobs - Number((baseline === null || baseline === void 0 ? void 0 : baseline.activeJobs) || 0)
            : null;
        const salaryStats = (0, exports.resolveSingleCurrencySalaryStats)(entry.salaryByCurrency);
        return {
            roleFamily: entry.roleFamily,
            label: entry.label,
            demand: (0, exports.buildJobMarketDemandLevel)(demandReference, entry),
            activeJobs: entry.activeJobs,
            newJobs24h: entry.newJobs24h,
            newJobs7d: entry.newJobs7d,
            avgSalary: salaryStats.avgSalary,
            salaryCurrency: salaryStats.salaryCurrency,
            salarySampleSize: salaryStats.salarySampleSize,
            delta7d,
            trendDirection: delta7d == null
                ? 'unknown'
                : delta7d > 0
                    ? 'up'
                    : delta7d < 0
                        ? 'down'
                        : 'flat',
        };
    });
    return filtered
        .sort((left, right) => {
        const scoreLeft = (0, exports.resolveJobMarketDemandScore)(left);
        const scoreRight = (0, exports.resolveJobMarketDemandScore)(right);
        if (scoreRight !== scoreLeft)
            return scoreRight - scoreLeft;
        if (right.activeJobs !== left.activeJobs)
            return right.activeJobs - left.activeJobs;
        return right.newJobs24h - left.newJobs24h;
    })
        .slice(0, params.limit);
};
exports.buildJobMarketDemandEntries = buildJobMarketDemandEntries;
