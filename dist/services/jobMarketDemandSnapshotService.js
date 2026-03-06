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
exports.syncJobMarketDemandSnapshots = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobMarketDemandService_1 = require("./jobMarketDemandService");
const jobMarketDemandSnapshotContextService_1 = require("./jobMarketDemandSnapshotContextService");
const jobMarketDemandStorageService_1 = require("./jobMarketDemandStorageService");
const JOB_MARKET_DEMAND_SNAPSHOT_CONCURRENCY = 2;
const syncSnapshotContext = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const groups = yield (0, jobMarketDemandStorageService_1.aggregateJobMarketDemandGroups)({
        db: params.db,
        location: params.context.location,
        workModel: params.context.workModel,
    });
    yield (0, jobMarketDemandStorageService_1.writeJobMarketDemandSnapshotGroups)({
        db: params.db,
        context: (0, jobMarketDemandStorageService_1.buildJobMarketDemandSnapshotContext)({
            location: params.context.location,
            workModel: params.context.workModel,
        }),
        bucketDate: params.bucketDate,
        groups,
    });
});
const executeSnapshotContextQueue = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const queue = [...params.contexts];
    const workerCount = Math.max(1, Math.min(JOB_MARKET_DEMAND_SNAPSHOT_CONCURRENCY, queue.length));
    let failure = null;
    const worker = () => __awaiter(void 0, void 0, void 0, function* () {
        while (queue.length > 0 && !failure) {
            const context = queue.shift();
            if (!context)
                return;
            try {
                yield syncSnapshotContext({
                    db: params.db,
                    bucketDate: params.bucketDate,
                    context,
                });
            }
            catch (error) {
                failure = error instanceof Error ? error : new Error('Job market demand snapshot sync failed');
            }
        }
    });
    yield Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (failure) {
        throw failure;
    }
});
const prepareJobMarketDemandSnapshotSync = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, jobMarketDemandStorageService_1.ensureJobMarketDemandIndexes)(params.db);
    const bucketDate = (0, inputSanitizers_1.readString)(params.bucketDate, 20)
        || (0, jobMarketDemandStorageService_1.toJobMarketDemandIsoDate)((0, jobMarketDemandStorageService_1.startOfJobMarketDemandUtcDay)(new Date()));
    const contexts = yield (0, jobMarketDemandSnapshotContextService_1.loadJobMarketDemandSnapshotSeedContexts)(params.db);
    return {
        bucketDate,
        contexts,
    };
});
const executeJobMarketDemandSnapshotSync = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield executeSnapshotContextQueue({
        db: params.db,
        bucketDate: params.bucketDate,
        contexts: params.contexts,
    });
    (0, jobMarketDemandService_1.clearJobMarketDemandCache)();
    return {
        bucketDate: params.bucketDate,
        contexts: params.contexts.length,
    };
});
const syncJobMarketDemandSnapshots = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const prepared = yield prepareJobMarketDemandSnapshotSync(params);
    return executeJobMarketDemandSnapshotSync({
        db: params.db,
        bucketDate: prepared.bucketDate,
        contexts: prepared.contexts,
    });
});
exports.syncJobMarketDemandSnapshots = syncJobMarketDemandSnapshots;
