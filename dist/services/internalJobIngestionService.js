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
exports.ingestAggregatedJobsBatch = exports.MAX_INTERNAL_AGGREGATED_INGEST_ITEMS = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const concurrencyUtils_1 = require("../utils/concurrencyUtils");
const jobMarketDemandSeedContextRegistryService_1 = require("./jobMarketDemandSeedContextRegistryService");
const jobAggregatedIngestionNormalizationService_1 = require("./jobAggregatedIngestionNormalizationService");
const jobAggregatedIngestionResultService_1 = require("./jobAggregatedIngestionResultService");
const JOBS_COLLECTION = 'jobs';
exports.MAX_INTERNAL_AGGREGATED_INGEST_ITEMS = 500;
const NORMALIZATION_YIELD_INTERVAL = 10;
const buildBulkIngestionOperations = (jobs, nowIso, stats) => __awaiter(void 0, void 0, void 0, function* () {
    const operations = [];
    const operationMetaByBulkIndex = [];
    for (let index = 0; index < jobs.length; index += 1) {
        const normalized = (0, jobAggregatedIngestionNormalizationService_1.normalizeAggregatedIngestPayload)(jobs[index], nowIso);
        if ('skipReason' in normalized) {
            (0, jobAggregatedIngestionResultService_1.incrementSkipReason)(stats, normalized.skipReason, 1);
            continue;
        }
        operations.push({
            updateOne: {
                filter: normalized.payload.filter,
                update: {
                    $set: normalized.payload.setFields,
                    $setOnInsert: normalized.payload.setOnInsertFields,
                },
                upsert: true,
            },
        });
        operationMetaByBulkIndex.push({
            jobId: (0, inputSanitizers_1.readString)(normalized.payload.setOnInsertFields.id, 120),
            sourceIndex: index,
        });
        if ((index + 1) % NORMALIZATION_YIELD_INTERVAL === 0) {
            yield (0, concurrencyUtils_1.yieldToEventLoop)();
        }
    }
    return { operations, operationMetaByBulkIndex };
});
const queueJobMarketDemandSeedRegistration = (db, jobs) => {
    void (0, jobMarketDemandSeedContextRegistryService_1.registerJobMarketDemandSeedContexts)({
        db,
        jobs: Array.isArray(jobs) ? jobs : [],
    }).catch((error) => {
        console.warn('Register job market demand seed contexts error:', error);
    });
};
const ingestAggregatedJobsBatch = (db, jobs, nowIso) => __awaiter(void 0, void 0, void 0, function* () {
    const stats = (0, jobAggregatedIngestionResultService_1.createIngestionStats)();
    const { operations, operationMetaByBulkIndex } = yield buildBulkIngestionOperations(jobs, nowIso, stats);
    if (operations.length === 0) {
        return stats;
    }
    try {
        const result = yield db.collection(JOBS_COLLECTION).bulkWrite(operations, { ordered: false });
        (0, jobAggregatedIngestionResultService_1.applyBulkWriteResultToStats)(stats, result, operationMetaByBulkIndex);
        queueJobMarketDemandSeedRegistration(db, jobs);
        return stats;
    }
    catch (bulkError) {
        const partialResult = bulkError === null || bulkError === void 0 ? void 0 : bulkError.result;
        if (!partialResult) {
            (0, jobAggregatedIngestionResultService_1.recordNonBulkIngestionFailure)(stats, operations.length, bulkError);
            console.error('Internal aggregated jobs ingest non-bulk error:', bulkError);
            throw bulkError;
        }
        (0, jobAggregatedIngestionResultService_1.applyBulkWriteResultToStats)(stats, partialResult, operationMetaByBulkIndex);
        (0, jobAggregatedIngestionResultService_1.recordBulkWriteErrorToStats)(stats, bulkError, operationMetaByBulkIndex);
        queueJobMarketDemandSeedRegistration(db, jobs);
        console.error('Internal aggregated jobs ingest bulk write error:', bulkError);
        return stats;
    }
});
exports.ingestAggregatedJobsBatch = ingestAggregatedJobsBatch;
