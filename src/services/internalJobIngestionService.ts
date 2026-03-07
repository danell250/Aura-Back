import type { AnyBulkWriteOperation } from 'mongodb';
import { readString } from '../utils/inputSanitizers';
import { yieldToEventLoop } from '../utils/concurrencyUtils';
import { registerJobMarketDemandSeedContexts } from './jobMarketDemandSeedContextRegistryService';
import { normalizeAggregatedIngestPayload } from './jobAggregatedIngestionNormalizationService';
import {
  applyBulkWriteResultToStats,
  createIngestionStats,
  incrementSkipReason,
  recordBulkWriteErrorToStats,
  recordNonBulkIngestionFailure,
  type BulkIngestionOperationMeta,
  type IngestionStats,
} from './jobAggregatedIngestionResultService';

const JOBS_COLLECTION = 'jobs';
export const MAX_INTERNAL_AGGREGATED_INGEST_ITEMS = 500;
const NORMALIZATION_YIELD_INTERVAL = 10;

const buildBulkIngestionOperations = async (
  jobs: unknown[],
  nowIso: string,
  stats: IngestionStats,
): Promise<{
  operations: AnyBulkWriteOperation<any>[];
  operationMetaByBulkIndex: BulkIngestionOperationMeta[];
}> => {
  const operations: AnyBulkWriteOperation<any>[] = [];
  const operationMetaByBulkIndex: BulkIngestionOperationMeta[] = [];

  for (let index = 0; index < jobs.length; index += 1) {
    const normalized = normalizeAggregatedIngestPayload(jobs[index], nowIso);
    if ('skipReason' in normalized) {
      incrementSkipReason(stats, normalized.skipReason, 1);
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
      jobId: readString(normalized.payload.setOnInsertFields.id, 120),
      sourceIndex: index,
    });

    if ((index + 1) % NORMALIZATION_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }

  return { operations, operationMetaByBulkIndex };
};

const queueJobMarketDemandSeedRegistration = (db: any, jobs: unknown[]): void => {
  void registerJobMarketDemandSeedContexts({
    db,
    jobs: Array.isArray(jobs) ? jobs as Array<{ locationText?: unknown; workModel?: unknown; status?: unknown }> : [],
  }).catch((error) => {
    console.warn('Register job market demand seed contexts error:', error);
  });
};

export const ingestAggregatedJobsBatch = async (
  db: any,
  jobs: unknown[],
  nowIso: string,
): Promise<IngestionStats> => {
  const stats = createIngestionStats();
  const { operations, operationMetaByBulkIndex } = await buildBulkIngestionOperations(jobs, nowIso, stats);

  if (operations.length === 0) {
    return stats;
  }

  try {
    const result = await db.collection(JOBS_COLLECTION).bulkWrite(operations, { ordered: false });
    applyBulkWriteResultToStats(stats, result, operationMetaByBulkIndex);
    queueJobMarketDemandSeedRegistration(db, jobs);
    return stats;
  } catch (bulkError: any) {
    const partialResult = bulkError?.result;
    if (!partialResult) {
      recordNonBulkIngestionFailure(stats, operations.length, bulkError);
      console.error('Internal aggregated jobs ingest non-bulk error:', bulkError);
      throw bulkError;
    }

    applyBulkWriteResultToStats(stats, partialResult, operationMetaByBulkIndex);
    recordBulkWriteErrorToStats(stats, bulkError, operationMetaByBulkIndex);
    queueJobMarketDemandSeedRegistration(db, jobs);
    console.error('Internal aggregated jobs ingest bulk write error:', bulkError);
    return stats;
  }
};
