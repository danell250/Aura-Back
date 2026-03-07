"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordBulkWriteErrorToStats = exports.recordNonBulkIngestionFailure = exports.applyBulkWriteResultToStats = exports.incrementSkipReason = exports.createIngestionStats = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const createIngestionStats = () => ({
    inserted: 0,
    insertedJobIds: [],
    updated: 0,
    skipped: 0,
    skippedReasons: {},
    errorSamples: [],
});
exports.createIngestionStats = createIngestionStats;
const incrementSkipReason = (stats, reason, count = 1) => {
    if (count <= 0)
        return;
    stats.skipped += count;
    stats.skippedReasons[reason] = (stats.skippedReasons[reason] || 0) + count;
};
exports.incrementSkipReason = incrementSkipReason;
const applyBulkWriteResultToStats = (stats, result, operationMetaByBulkIndex) => {
    const upsertedCount = Number(result.upsertedCount || 0);
    const modifiedCount = Number(result.modifiedCount || 0);
    const matchedCount = Number(result.matchedCount || 0);
    stats.inserted += upsertedCount;
    stats.updated += modifiedCount;
    const unchangedCount = Math.max(0, matchedCount - modifiedCount);
    if (unchangedCount > 0) {
        (0, exports.incrementSkipReason)(stats, 'no_changes', unchangedCount);
    }
    const seen = new Set(stats.insertedJobIds);
    Object.keys(result.upsertedIds || {}).forEach((rawIndex) => {
        var _a;
        const operationIndex = Number(rawIndex);
        if (!Number.isFinite(operationIndex)
            || operationIndex < 0
            || operationIndex >= operationMetaByBulkIndex.length)
            return;
        const jobId = (0, inputSanitizers_1.readString)((_a = operationMetaByBulkIndex[operationIndex]) === null || _a === void 0 ? void 0 : _a.jobId, 120);
        if (!jobId || seen.has(jobId))
            return;
        seen.add(jobId);
        stats.insertedJobIds.push(jobId);
    });
};
exports.applyBulkWriteResultToStats = applyBulkWriteResultToStats;
const recordNonBulkIngestionFailure = (stats, operationsCount, bulkError) => {
    (0, exports.incrementSkipReason)(stats, 'database_error', operationsCount);
    if (stats.errorSamples.length >= 5)
        return;
    stats.errorSamples.push({
        index: -1,
        message: (0, inputSanitizers_1.readString)(bulkError === null || bulkError === void 0 ? void 0 : bulkError.message, 300) ||
            'Bulk ingestion failed before MongoDB returned partial results',
    });
};
exports.recordNonBulkIngestionFailure = recordNonBulkIngestionFailure;
const recordBulkWriteErrorToStats = (stats, bulkError, operationMetaByBulkIndex) => {
    var _a, _b;
    const writeErrors = Array.isArray(bulkError === null || bulkError === void 0 ? void 0 : bulkError.writeErrors) ? bulkError.writeErrors : [];
    if (writeErrors.length > 0) {
        (0, exports.incrementSkipReason)(stats, 'database_error', writeErrors.length);
    }
    for (const writeError of writeErrors) {
        if (stats.errorSamples.length >= 5)
            break;
        const opIndex = Number.isFinite(writeError === null || writeError === void 0 ? void 0 : writeError.index) ? Number(writeError.index) : -1;
        const sourceIndex = opIndex >= 0 && opIndex < operationMetaByBulkIndex.length
            ? operationMetaByBulkIndex[opIndex].sourceIndex
            : opIndex;
        stats.errorSamples.push({
            index: sourceIndex,
            message: (0, inputSanitizers_1.readString)(writeError === null || writeError === void 0 ? void 0 : writeError.errmsg, 300) ||
                (0, inputSanitizers_1.readString)(writeError === null || writeError === void 0 ? void 0 : writeError.message, 300) ||
                'Bulk ingestion write error',
        });
    }
    const writeConcernErrors = Array.isArray(bulkError === null || bulkError === void 0 ? void 0 : bulkError.writeConcernErrors)
        ? bulkError.writeConcernErrors
        : [];
    if (writeConcernErrors.length === 0 || stats.errorSamples.length >= 5)
        return;
    stats.errorSamples.push({
        index: -1,
        message: (0, inputSanitizers_1.readString)((_a = writeConcernErrors[0]) === null || _a === void 0 ? void 0 : _a.errmsg, 300) ||
            (0, inputSanitizers_1.readString)((_b = writeConcernErrors[0]) === null || _b === void 0 ? void 0 : _b.message, 300) ||
            'Bulk ingestion write concern error',
    });
};
exports.recordBulkWriteErrorToStats = recordBulkWriteErrorToStats;
