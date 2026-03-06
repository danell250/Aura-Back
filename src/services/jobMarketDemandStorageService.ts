import type { AnyBulkWriteOperation, Db, Document } from 'mongodb';
import { readString } from '../utils/inputSanitizers';
import { tokenizeRecommendationText } from './jobRecommendationService';
import { resolveSingleCurrencySalaryStats } from './jobMarketDemandScoringService';
import type {
  GroupAccumulator,
  JobMarketDemandSnapshotContext,
  MarketDemandSnapshotGroupDoc,
  SnapshotDoc,
} from './jobMarketDemandTypes';
import { normalizeDemandRoleFamily } from './openToWorkDemandService';

const JOBS_COLLECTION = 'jobs';
const JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION = 'job_market_demand_snapshots';
export const TREND_WINDOW_DAYS = 7;
export const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
const REMOTE_LOCATION_TOKENS = new Set(['remote', 'worldwide', 'global', 'anywhere', 'flexible']);

type MarketDemandFilter = {
  status: 'open';
  workModel?: string;
  recommendationLocationTokens?: { $in: string[] };
};

type AggregatedDemandRow = {
  _id?: {
    roleFamily?: unknown;
    label?: unknown;
    title?: unknown;
    salaryCurrency?: unknown;
  };
  activeJobs?: unknown;
  newJobs24h?: unknown;
  newJobs7d?: unknown;
  salarySum?: unknown;
  salarySampleSize?: unknown;
};

const normalizeLocationKey = (value: string): string =>
  readString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const toJobMarketDemandIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

export const startOfJobMarketDemandUtcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

export const buildJobMarketDemandSnapshotContext = (params: {
  location?: string;
  workModel?: string | null;
}) => {
  const normalizedLocation = readString(params.location, 120);
  const normalizedWorkModel = readString(params.workModel, 20).toLowerCase();
  return {
    location: normalizedLocation || null,
    locationKey: normalizedLocation ? normalizeLocationKey(normalizedLocation) : 'global',
    workModel: ALLOWED_WORK_MODELS.has(normalizedWorkModel) ? normalizedWorkModel : null,
    workModelKey: ALLOWED_WORK_MODELS.has(normalizedWorkModel) ? normalizedWorkModel : 'all',
  };
};

const buildLocationFilterTokens = (value: unknown): string[] => {
  const normalizedLocation = readString(value, 120);
  if (!normalizedLocation) return [];
  if (REMOTE_LOCATION_TOKENS.has(normalizedLocation.toLowerCase())) return [];
  return Array.from(
    new Set(
      tokenizeRecommendationText(normalizedLocation, 12)
        .filter((token) => token.length >= 3)
        .slice(0, 8),
    ),
  );
};

const buildFilter = (params: {
  location?: string;
  workModel?: string | null;
}): MarketDemandFilter => {
  const filter: MarketDemandFilter = {
    status: 'open',
  };

  const normalizedWorkModel = readString(params.workModel, 20).toLowerCase();
  const normalizedLocation = readString(params.location, 120).toLowerCase();
  if (ALLOWED_WORK_MODELS.has(normalizedWorkModel)) {
    filter.workModel = normalizedWorkModel;
  } else if (REMOTE_LOCATION_TOKENS.has(normalizedLocation)) {
    filter.workModel = 'remote';
  }

  const locationTokens = buildLocationFilterTokens(params.location);
  if (locationTokens.length > 0) {
    filter.recommendationLocationTokens = { $in: locationTokens };
  }

  return filter;
};

const buildFreshnessTsProjection = (fieldPath: string): Document => ({
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

const buildDemandRoleProjectionFields = (): Document => ({
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

const buildDemandFreshnessProjectionField = (): Document => ({
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

const buildDemandSalaryProjectionFields = (): Document => ({
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

const buildDemandProjectionStage = (): Document => ({
  $project: {
    ...buildDemandRoleProjectionFields(),
    freshnessTs: buildDemandFreshnessProjectionField(),
    ...buildDemandSalaryProjectionFields(),
  },
});

const buildDemandGroupStage = (params: { past24hMs: number; past7dMs: number }): Document => ({
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

const buildCurrentDemandAggregationPipeline = (params: {
  filter: MarketDemandFilter;
  past24hMs: number;
  past7dMs: number;
}): Document[] => ([
  { $match: params.filter },
  buildDemandProjectionStage(),
  buildDemandGroupStage(params),
]);

const resolveRowCount = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
};

const createEmptyGroupAccumulator = (roleFamily: string, label: string): GroupAccumulator => ({
  roleFamily,
  label,
  activeJobs: 0,
  newJobs24h: 0,
  newJobs7d: 0,
  salaryByCurrency: new Map(),
});

const resolveDemandRoleFromAggregatedRow = (row: AggregatedDemandRow): { roleFamily: string; label: string } | null => {
  const storedRoleFamily = readString(row?._id?.roleFamily, 120);
  const storedLabel = readString(row?._id?.label, 120);
  if (storedRoleFamily && storedLabel) {
    return {
      roleFamily: storedRoleFamily,
      label: storedLabel,
    };
  }
  return normalizeDemandRoleFamily(row?._id?.title);
};

const applyAggregatedSalaryRow = (
  accumulator: GroupAccumulator,
  row: AggregatedDemandRow,
): void => {
  const salaryCurrency = readString(row?._id?.salaryCurrency, 12).toUpperCase();
  const salarySum = typeof row.salarySum === 'number' && Number.isFinite(row.salarySum) ? row.salarySum : 0;
  const salarySampleSize = resolveRowCount(row.salarySampleSize);
  if (!salaryCurrency || salarySampleSize === 0 || salarySum <= 0) return;

  const existing = accumulator.salaryByCurrency.get(salaryCurrency) || { salarySum: 0, salarySampleSize: 0 };
  existing.salarySum += salarySum;
  existing.salarySampleSize += salarySampleSize;
  accumulator.salaryByCurrency.set(salaryCurrency, existing);
};

const mergeAggregatedDemandRows = (rows: AggregatedDemandRow[]): Map<string, GroupAccumulator> => {
  const grouped = new Map<string, GroupAccumulator>();

  for (const row of rows) {
    const normalizedRole = resolveDemandRoleFromAggregatedRow(row);
    if (!normalizedRole) continue;

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

let marketDemandIndexesPromise: Promise<void> | null = null;

export const ensureJobMarketDemandIndexes = async (db: Db): Promise<void> => {
  if (!marketDemandIndexesPromise) {
    marketDemandIndexesPromise = (async () => {
      await Promise.all([
        db.collection(JOBS_COLLECTION).createIndex(
          { status: 1, workModel: 1, recommendationLocationTokens: 1 },
          { name: 'jobs_market_demand_status_work_model_location_tokens_idx' },
        ),
        db.collection(JOBS_COLLECTION).createIndex(
          { status: 1, recommendationLocationTokens: 1 },
          { name: 'jobs_market_demand_status_location_tokens_idx' },
        ),
        db.collection(JOBS_COLLECTION).createIndex(
          { status: 1, demandRoleFamily: 1, workModel: 1 },
          { name: 'jobs_market_demand_status_role_family_work_model_idx' },
        ),
        db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).createIndex(
          { bucketDate: 1, locationKey: 1, workModelKey: 1, roleFamily: 1 },
          { unique: true, name: 'job_market_demand_bucket_context_role_idx' },
        ),
        db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).createIndex(
          { locationKey: 1, workModelKey: 1, bucketDate: -1 },
          { name: 'job_market_demand_context_bucket_idx' },
        ),
      ]);
    })().catch((error) => {
      marketDemandIndexesPromise = null;
      throw error;
    });
  }
  return marketDemandIndexesPromise;
};

export const aggregateJobMarketDemandGroups = async (params: {
  db: Db;
  location?: string;
  workModel?: string | null;
}): Promise<Map<string, GroupAccumulator>> => {
  const filter = buildFilter(params);
  const nowMs = Date.now();
  const past24hMs = nowMs - (24 * 60 * 60 * 1000);
  const past7dMs = nowMs - (TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const aggregatedRows = await params.db.collection(JOBS_COLLECTION)
    .aggregate<AggregatedDemandRow>(buildCurrentDemandAggregationPipeline({
      filter,
      past24hMs,
      past7dMs,
    }))
    .toArray();

  return mergeAggregatedDemandRows(aggregatedRows);
};

export const writeJobMarketDemandSnapshotGroups = async (params: {
  db: Db;
  context: ReturnType<typeof buildJobMarketDemandSnapshotContext>;
  bucketDate: string;
  groups: Map<string, GroupAccumulator>;
}): Promise<void> => {
  const contextFilter = {
    bucketDate: params.bucketDate,
    locationKey: params.context.locationKey,
    workModelKey: params.context.workModelKey,
  };
  if (params.groups.size === 0) {
    await params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).deleteMany(contextFilter);
    return;
  }

  const operations: AnyBulkWriteOperation<Document>[] = [];
  const currentRoleFamilies = Array.from(params.groups.keys());
  for (const group of params.groups.values()) {
    operations.push({
      updateOne: {
        filter: {
          ...contextFilter,
          roleFamily: group.roleFamily,
        },
        update: {
          $setOnInsert: {
            createdAt: new Date().toISOString(),
          },
          $set: {
            bucketDate: params.bucketDate,
            locationKey: params.context.locationKey,
            workModelKey: params.context.workModelKey,
            roleFamily: group.roleFamily,
            label: group.label,
            activeJobs: group.activeJobs,
            newJobs24h: group.newJobs24h,
            newJobs7d: group.newJobs7d,
            ...resolveSingleCurrencySalaryStats(group.salaryByCurrency),
            refreshedAt: new Date().toISOString(),
          },
        },
        upsert: true,
      },
    });
  }

  await Promise.all([
    params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).deleteMany({
      ...contextFilter,
      roleFamily: { $nin: currentRoleFamilies },
    }),
    params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION).bulkWrite(operations, { ordered: false }),
  ]);
};

export const loadJobMarketDemandBaselineSnapshots = async (params: {
  db: Db;
  context: ReturnType<typeof buildJobMarketDemandSnapshotContext>;
  bucketDate: string;
}): Promise<Map<string, SnapshotDoc> | null> => {
  const docs = await params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION)
    .find({
      bucketDate: params.bucketDate,
      locationKey: params.context.locationKey,
      workModelKey: params.context.workModelKey,
    })
    .project({ roleFamily: 1, activeJobs: 1 })
    .toArray();

  if (docs.length === 0) return null;

  const byRoleFamily = new Map<string, SnapshotDoc>();
  docs.forEach((doc) => {
    const roleFamily = readString((doc as any)?.roleFamily, 120);
    if (!roleFamily) return;
    byRoleFamily.set(roleFamily, {
      roleFamily,
      activeJobs: Number((doc as any)?.activeJobs) || 0,
    });
  });
  return byRoleFamily;
};

const buildGroupAccumulatorFromSnapshotDoc = (doc: MarketDemandSnapshotGroupDoc): GroupAccumulator | null => {
  const roleFamily = readString(doc?.roleFamily, 120);
  const label = readString(doc?.label, 120);
  if (!roleFamily || !label) return null;

  const group = createEmptyGroupAccumulator(roleFamily, label);
  group.activeJobs = resolveRowCount(doc?.activeJobs);
  group.newJobs24h = resolveRowCount(doc?.newJobs24h);
  group.newJobs7d = resolveRowCount(doc?.newJobs7d);

  const salaryCurrency = readString(doc?.salaryCurrency, 12).toUpperCase();
  const salarySum = Number(doc?.salarySum);
  const salarySampleSize = resolveRowCount(doc?.salarySampleSize);
  if (salaryCurrency && salarySampleSize > 0 && Number.isFinite(salarySum) && salarySum > 0) {
    group.salaryByCurrency.set(salaryCurrency, {
      salarySum,
      salarySampleSize,
    });
  }

  return group;
};

export const loadJobMarketDemandSnapshotGroups = async (params: {
  db: Db;
  context: ReturnType<typeof buildJobMarketDemandSnapshotContext>;
  bucketDate: string;
}): Promise<Map<string, GroupAccumulator> | null> => {
  const docs = await params.db.collection(JOB_MARKET_DEMAND_SNAPSHOTS_COLLECTION)
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

  if (docs.length === 0) return null;

  const groups = new Map<string, GroupAccumulator>();
  docs.forEach((doc) => {
    const group = buildGroupAccumulatorFromSnapshotDoc(doc as MarketDemandSnapshotGroupDoc);
    if (!group) return;
    groups.set(group.roleFamily, group);
  });
  return groups;
};
