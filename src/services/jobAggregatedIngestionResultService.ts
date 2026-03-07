import { readString } from '../utils/inputSanitizers';

export type IngestionStats = {
  inserted: number;
  insertedJobIds: string[];
  updated: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  errorSamples: Array<{ index: number; message: string }>;
};

export type BulkIngestionOperationMeta = {
  jobId: string;
  sourceIndex: number;
};

type BulkWriteResultLike = {
  upsertedCount?: number;
  modifiedCount?: number;
  matchedCount?: number;
  upsertedIds?: Record<string, unknown>;
};

export const createIngestionStats = (): IngestionStats => ({
  inserted: 0,
  insertedJobIds: [],
  updated: 0,
  skipped: 0,
  skippedReasons: {},
  errorSamples: [],
});

export const incrementSkipReason = (stats: IngestionStats, reason: string, count = 1): void => {
  if (count <= 0) return;
  stats.skipped += count;
  stats.skippedReasons[reason] = (stats.skippedReasons[reason] || 0) + count;
};

export const applyBulkWriteResultToStats = (
  stats: IngestionStats,
  result: BulkWriteResultLike,
  operationMetaByBulkIndex: BulkIngestionOperationMeta[],
): void => {
  const upsertedCount = Number(result.upsertedCount || 0);
  const modifiedCount = Number(result.modifiedCount || 0);
  const matchedCount = Number(result.matchedCount || 0);
  stats.inserted += upsertedCount;
  stats.updated += modifiedCount;

  const unchangedCount = Math.max(0, matchedCount - modifiedCount);
  if (unchangedCount > 0) {
    incrementSkipReason(stats, 'no_changes', unchangedCount);
  }

  const seen = new Set(stats.insertedJobIds);
  Object.keys(result.upsertedIds || {}).forEach((rawIndex) => {
    const operationIndex = Number(rawIndex);
    if (
      !Number.isFinite(operationIndex)
      || operationIndex < 0
      || operationIndex >= operationMetaByBulkIndex.length
    ) return;
    const jobId = readString(operationMetaByBulkIndex[operationIndex]?.jobId, 120);
    if (!jobId || seen.has(jobId)) return;
    seen.add(jobId);
    stats.insertedJobIds.push(jobId);
  });
};

export const recordNonBulkIngestionFailure = (
  stats: IngestionStats,
  operationsCount: number,
  bulkError: unknown,
): void => {
  incrementSkipReason(stats, 'database_error', operationsCount);
  if (stats.errorSamples.length >= 5) return;
  stats.errorSamples.push({
    index: -1,
    message:
      readString((bulkError as any)?.message, 300) ||
      'Bulk ingestion failed before MongoDB returned partial results',
  });
};

export const recordBulkWriteErrorToStats = (
  stats: IngestionStats,
  bulkError: unknown,
  operationMetaByBulkIndex: BulkIngestionOperationMeta[],
): void => {
  const writeErrors = Array.isArray((bulkError as any)?.writeErrors) ? (bulkError as any).writeErrors : [];
  if (writeErrors.length > 0) {
    incrementSkipReason(stats, 'database_error', writeErrors.length);
  }

  for (const writeError of writeErrors) {
    if (stats.errorSamples.length >= 5) break;
    const opIndex = Number.isFinite(writeError?.index) ? Number(writeError.index) : -1;
    const sourceIndex = opIndex >= 0 && opIndex < operationMetaByBulkIndex.length
      ? operationMetaByBulkIndex[opIndex].sourceIndex
      : opIndex;
    stats.errorSamples.push({
      index: sourceIndex,
      message:
        readString(writeError?.errmsg, 300) ||
        readString(writeError?.message, 300) ||
        'Bulk ingestion write error',
    });
  }

  const writeConcernErrors = Array.isArray((bulkError as any)?.writeConcernErrors)
    ? (bulkError as any).writeConcernErrors
    : [];
  if (writeConcernErrors.length === 0 || stats.errorSamples.length >= 5) return;

  stats.errorSamples.push({
    index: -1,
    message:
      readString(writeConcernErrors[0]?.errmsg, 300) ||
      readString(writeConcernErrors[0]?.message, 300) ||
      'Bulk ingestion write concern error',
  });
};
