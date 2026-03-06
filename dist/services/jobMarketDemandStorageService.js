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
exports.loadJobMarketDemandSnapshotGroups = exports.loadJobMarketDemandBaselineSnapshots = exports.writeJobMarketDemandSnapshotGroups = exports.aggregateJobMarketDemandGroups = exports.ensureJobMarketDemandIndexes = exports.buildJobMarketDemandSnapshotContext = exports.startOfJobMarketDemandUtcDay = exports.toJobMarketDemandIsoDate = exports.ALLOWED_WORK_MODELS = exports.TREND_WINDOW_DAYS = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobRecommendationService_1 = require("./jobRecommendationService");
const jobMarketDemandScoringService_1 = require("./jobMarketDemandScoringService");
const openToWorkDemandService_1 = require("./openToWorkDemandService");
const JOBS_COLLECTION = 'jobs';
const JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION = 'job_market_demand_snapshots';
exports.TREND_WINDOW_DAYS = 7;
exports.ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
const REMOTE_LOCATION_TOKENS = new Set(['remote', 'worldwide', 'global', 'anywhere', 'flexible']);
const normalizeLocationKey = (value) => (0, inputSanitizers_1.readString)(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const toJobMarketDemandIsoDate = (value) => value.toISOString().slice(0, 10);
exports.toJobMarketDemandIsoDate = toJobMarketDemandIsoDate;
const startOfJobMarketDemandUtcDay = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
exports.startOfJobMarketDemandUtcDay = startOfJobMarketDemandUtcDay;
const buildJobMarketDemandSnapshotContext = (params) => {
    const normalizedLocation = (0, inputSanitizers_1.readString)(params.location, 120);
    const normalizedWorkModel = (0, inputSanitizers_1.readString)(params.workModel, 20).toLowerCase();
    return {
        location: normalizedLocation || null,
        locationKey: normalizedLocation ? normalizeLocationKey(normalizedLocation) : 'global',
        workModel: exports.ALLOWED_WORK_MODELS.has(normalizedWorkModel) ? normalizedWorkModel : null,
        workModelKey: exports.ALLOWED_WORK_MODELS.has(normalizedWorkModel) ? normalizedWorkModel : 'all',
    };
};
exports.buildJobMarketDemandSnapshotContext = buildJobMarketDemandSnapshotContext;
const buildLocationFilterTokens = (value) => {
    const normalizedLocation = (0, inputSanitizers_1.readString)(value, 120);
    if (!normalizedLocation)
        return [];
    if (REMOTE_LOCATION_TOKENS.has(normalizedLocation.toLowerCase()))
        return [];
    return Array.from(new Set((0, jobRecommendationService_1.tokenizeRecommendationText)(normalizedLocation, 12)
        .filter((token) => token.length >= 3)
        .slice(0, 8)));
};
const buildFilter = (params) => {
    const filter = {
        status: 'open',
    };
    const normalizedWorkModel = (0, inputSanitizers_1.readString)(params.workModel, 20).toLowerCase();
    const normalizedLocation = (0, inputSanitizers_1.readString)(params.location, 120).toLowerCase();
    if (exports.ALLOWED_WORK_MODELS.has(normalizedWorkModel)) {
        filter.workModel = normalizedWorkModel;
    }
    else if (REMOTE_LOCATION_TOKENS.has(normalizedLocation)) {
        filter.workModel = 'remote';
    }
    const locationTokens = buildLocationFilterTokens(params.location);
    if (locationTokens.length > 0) {
        filter.recommendationLocationTokens = { $in: locationTokens };
    }
    return filter;
};
const buildFreshnessTsProjection = (fieldPath) => ({
    $let: {
        vars: {
            parsedDate: {
                $convert: {
                    input: fieldPath,
                    to: 'date',
                    onError: null,
                    onNull: null,
                },
            },
        },
        in: {
            $cond: [
                { $ne: ['$$parsedDate', null] },
                { $toLong: '$$parsedDate' },
                null,
            ],
        },
    },
});
const buildDemandRoleProjectionFields = () => ({
    demandRoleFamily: {
        $cond: [
            { $eq: [{ $type: '$demandRoleFamily' }, 'string'] },
            '$demandRoleFamily',
            '',
        ],
    },
    demandRoleLabel: {
        $cond: [
            { $eq: [{ $type: '$demandRoleLabel' }, 'string'] },
            '$demandRoleLabel',
            '',
        ],
    },
    title: 1,
});
const buildDemandFreshnessProjectionField = () => ({
    $ifNull: [
        {
            $cond: [
                { $gt: ['$marketDemandFreshnessTs', 0] },
                '$marketDemandFreshnessTs',
                null,
            ],
        },
        {
            $cond: [
                { $gt: ['$recommendationPublishedTs', 0] },
                '$recommendationPublishedTs',
                null,
            ],
        },
        {
            $ifNull: [
                buildFreshnessTsProjection('$discoveredAt'),
                {
                    $ifNull: [
                        buildFreshnessTsProjection('$publishedAt'),
                        buildFreshnessTsProjection('$createdAt'),
                    ],
                },
            ],
        },
    ],
});
const buildDemandSalaryProjectionFields = () => ({
    salaryCurrency: {
        $cond: [
            { $eq: [{ $type: '$salaryCurrency' }, 'string'] },
            { $toUpper: '$salaryCurrency' },
            '',
        ],
    },
    salaryValue: {
        $cond: [
            { $isNumber: '$marketDemandSalaryValue' },
            '$marketDemandSalaryValue',
            null,
        ],
    },
});
const buildDemandProjectionStage = () => ({
    $project: Object.assign(Object.assign(Object.assign({}, buildDemandRoleProjectionFields()), { freshnessTs: buildDemandFreshnessProjectionField() }), buildDemandSalaryProjectionFields()),
});
const buildDemandGroupStage = (params) => ({
    $group: {
        _id: {
            roleFamily: '$demandRoleFamily',
            label: '$demandRoleLabel',
            title: '$title',
            salaryCurrency: '$salaryCurrency',
        },
        activeJobs: { $sum: 1 },
        newJobs24h: {
            $sum: {
                $cond: [
                    { $gte: ['$freshnessTs', params.past24hMs] },
                    1,
                    0,
                ],
            },
        },
        newJobs7d: {
            $sum: {
                $cond: [
                    { $gte: ['$freshnessTs', params.past7dMs] },
                    1,
                    0,
                ],
            },
        },
        salarySum: {
            $sum: {
                $cond: [
                    {
                        $and: [
                            { $isNumber: '$salaryValue' },
                            { $ne: ['$salaryCurrency', ''] },
                        ],
                    },
                    '$salaryValue',
                    0,
                ],
            },
        },
        salarySampleSize: {
            $sum: {
                $cond: [
                    {
                        $and: [
                            { $isNumber: '$salaryValue' },
                            { $ne: ['$salaryCurrency', ''] },
                        ],
                    },
                    1,
                    0,
                ],
            },
        },
    },
});
const buildCurrentDemandAggregationPipeline = (params) => ([
    { $match: params.filter },
    buildDemandProjectionStage(),
    buildDemandGroupStage(params),
]);
const resolveRowCount = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0)
        return 0;
    return Math.floor(numeric);
};
const createEmptyGroupAccumulator = (roleFamily, label) => ({
    roleFamily,
    label,
    activeJobs: 0,
    newJobs24h: 0,
    newJobs7d: 0,
    salaryByCurrency: new Map(),
});
const resolveDemandRoleFromAggregatedRow = (row) => {
    var _a, _b, _c;
    const storedRoleFamily = (0, inputSanitizers_1.readString)((_a = row === null || row === void 0 ? void 0 : row._id) === null || _a === void 0 ? void 0 : _a.roleFamily, 120);
    const storedLabel = (0, inputSanitizers_1.readString)((_b = row === null || row === void 0 ? void 0 : row._id) === null || _b === void 0 ? void 0 : _b.label, 120);
    if (storedRoleFamily && storedLabel) {
        return {
            roleFamily: storedRoleFamily,
            label: storedLabel,
        };
    }
    return (0, openToWorkDemandService_1.normalizeDemandRoleFamily)((_c = row === null || row === void 0 ? void 0 : row._id) === null || _c === void 0 ? void 0 : _c.title);
};
const applyAggregatedSalaryRow = (accumulator, row) => {
    var _a;
    const salaryCurrency = (0, inputSanitizers_1.readString)((_a = row === null || row === void 0 ? void 0 : row._id) === null || _a === void 0 ? void 0 : _a.salaryCurrency, 12).toUpperCase();
    const salarySum = typeof row.salarySum === 'number' && Number.isFinite(row.salarySum) ? row.salarySum : 0;
    const salarySampleSize = resolveRowCount(row.salarySampleSize);
    if (!salaryCurrency || salarySampleSize === 0 || salarySum <= 0)
        return;
    const existing = accumulator.salaryByCurrency.get(salaryCurrency) || { salarySum: 0, salarySampleSize: 0 };
    existing.salarySum += salarySum;
    existing.salarySampleSize += salarySampleSize;
    accumulator.salaryByCurrency.set(salaryCurrency, existing);
};
const mergeAggregatedDemandRows = (rows) => {
    const grouped = new Map();
    for (const row of rows) {
        const normalizedRole = resolveDemandRoleFromAggregatedRow(row);
        if (!normalizedRole)
            continue;
        const existing = grouped.get(normalizedRole.roleFamily)
            || createEmptyGroupAccumulator(normalizedRole.roleFamily, normalizedRole.label);
        existing.activeJobs += resolveRowCount(row.activeJobs);
        existing.newJobs24h += resolveRowCount(row.newJobs24h);
        existing.newJobs7d += resolveRowCount(row.newJobs7d);
        applyAggregatedSalaryRow(existing, row);
        grouped.set(normalizedRole.roleFamily, existing);
    }
    return grouped;
};
let marketDemandIndexesPromise = null;
const ensureJobMarketDemandIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (!marketDemandIndexesPromise) {
        marketDemandIndexesPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
            yield Promise.all([
                db.collection(JOBS_COLLECTION).createIndex({ status: 1, workModel: 1, recommendationLocationTokens: 1 }, { name: 'jobs_market_demand_status_work_model_location_tokens_idx' }),
                db.collection(JOBS_COLLECTION).createIndex({ status: 1, recommendationLocationTokens: 1 }, { name: 'jobs_market_demand_status_location_tokens_idx' }),
                db.collection(JOBS_COLLECTION).createIndex({ status: 1, demandRoleFamily: 1, workModel: 1 }, { name: 'jobs_market_demand_status_role_family_work_model_idx' }),
                db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).createIndex({ bucketDate: 1, locationKey: 1, workModelKey: 1, roleFamily: 1 }, { unique: true, name: 'job_market_demand_bucket_context_role_idx' }),
                db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).createIndex({ locationKey: 1, workModelKey: 1, bucketDate: -1 }, { name: 'job_market_demand_context_bucket_idx' }),
            ]);
        }))().catch((error) => {
            marketDemandIndexesPromise = null;
            throw error;
        });
    }
    return marketDemandIndexesPromise;
});
exports.ensureJobMarketDemandIndexes = ensureJobMarketDemandIndexes;
const aggregateJobMarketDemandGroups = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const filter = buildFilter(params);
    const nowMs = Date.now();
    const past24hMs = nowMs - (24 * 60 * 60 * 1000);
    const past7dMs = nowMs - (exports.TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const aggregatedRows = yield params.db.collection(JOBS_COLLECTION)
        .aggregate(buildCurrentDemandAggregationPipeline({
        filter,
        past24hMs,
        past7dMs,
    }))
        .toArray();
    return mergeAggregatedDemandRows(aggregatedRows);
});
exports.aggregateJobMarketDemandGroups = aggregateJobMarketDemandGroups;
const writeJobMarketDemandSnapshotGroups = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const contextFilter = {
        bucketDate: params.bucketDate,
        locationKey: params.context.locationKey,
        workModelKey: params.context.workModelKey,
    };
    if (params.groups.size === 0) {
        yield params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).deleteMany(contextFilter);
        return;
    }
    const operations = [];
    const currentRoleFamilies = Array.from(params.groups.keys());
    for (const group of params.groups.values()) {
        operations.push({
            updateOne: {
                filter: Object.assign(Object.assign({}, contextFilter), { roleFamily: group.roleFamily }),
                update: {
                    $setOnInsert: {
                        createdAt: new Date().toISOString(),
                    },
                    $set: Object.assign(Object.assign({ bucketDate: params.bucketDate, locationKey: params.context.locationKey, workModelKey: params.context.workModelKey, roleFamily: group.roleFamily, label: group.label, activeJobs: group.activeJobs, newJobs24h: group.newJobs24h, newJobs7d: group.newJobs7d }, (0, jobMarketDemandScoringService_1.resolveSingleCurrencySalaryStats)(group.salaryByCurrency)), { refreshedAt: new Date().toISOString() }),
                },
                upsert: true,
            },
        });
    }
    yield Promise.all([
        params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).deleteMany(Object.assign(Object.assign({}, contextFilter), { roleFamily: { $nin: currentRoleFamilies } })),
        params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).bulkWrite(operations, { ordered: false }),
    ]);
});
exports.writeJobMarketDemandSnapshotGroups = writeJobMarketDemandSnapshotGroups;
const loadJobMarketDemandBaselineSnapshots = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const docs = yield params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION)
        .find({
        bucketDate: params.bucketDate,
        locationKey: params.context.locationKey,
        workModelKey: params.context.workModelKey,
    })
        .project({ roleFamily: 1, activeJobs: 1 })
        .toArray();
    if (docs.length === 0)
        return null;
    const byRoleFamily = new Map();
    docs.forEach((doc) => {
        const roleFamily = (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.roleFamily, 120);
        if (!roleFamily)
            return;
        byRoleFamily.set(roleFamily, {
            roleFamily,
            activeJobs: Number(doc === null || doc === void 0 ? void 0 : doc.activeJobs) || 0,
        });
    });
    return byRoleFamily;
});
exports.loadJobMarketDemandBaselineSnapshots = loadJobMarketDemandBaselineSnapshots;
const buildGroupAccumulatorFromSnapshotDoc = (doc) => {
    const roleFamily = (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.roleFamily, 120);
    const label = (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.label, 120);
    if (!roleFamily || !label)
        return null;
    const group = createEmptyGroupAccumulator(roleFamily, label);
    group.activeJobs = resolveRowCount(doc === null || doc === void 0 ? void 0 : doc.activeJobs);
    group.newJobs24h = resolveRowCount(doc === null || doc === void 0 ? void 0 : doc.newJobs24h);
    group.newJobs7d = resolveRowCount(doc === null || doc === void 0 ? void 0 : doc.newJobs7d);
    const salaryCurrency = (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.salaryCurrency, 12).toUpperCase();
    const salarySum = Number(doc === null || doc === void 0 ? void 0 : doc.salarySum);
    const salarySampleSize = resolveRowCount(doc === null || doc === void 0 ? void 0 : doc.salarySampleSize);
    if (salaryCurrency && salarySampleSize > 0 && Number.isFinite(salarySum) && salarySum > 0) {
        group.salaryByCurrency.set(salaryCurrency, {
            salarySum,
            salarySampleSize,
        });
    }
    return group;
};
const loadJobMarketDemandSnapshotGroups = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const docs = yield params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION)
        .find({
        bucketDate: params.bucketDate,
        locationKey: params.context.locationKey,
        workModelKey: params.context.workModelKey,
    })
        .project({
        roleFamily: 1,
        label: 1,
        activeJobs: 1,
        newJobs24h: 1,
        newJobs7d: 1,
        salarySum: 1,
        avgSalary: 1,
        salaryCurrency: 1,
        salarySampleSize: 1,
    })
        .toArray();
    if (docs.length === 0)
        return null;
    const groups = new Map();
    docs.forEach((doc) => {
        const group = buildGroupAccumulatorFromSnapshotDoc(doc);
        if (!group)
            return;
        groups.set(group.roleFamily, group);
    });
    return groups;
});
exports.loadJobMarketDemandSnapshotGroups = loadJobMarketDemandSnapshotGroups;
