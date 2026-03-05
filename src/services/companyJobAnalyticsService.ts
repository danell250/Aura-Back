import { Db } from 'mongodb';

const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const TIME_TO_HIRE_LOOKBACK_DAYS = 365;
const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

export type CompanyJobAnalyticsData = {
  windowDays: number;
  funnel: {
    submitted: number;
    in_review: number;
    shortlisted: number;
    hired: number;
  };
  timeToHire: Array<{
    jobId: string;
    jobTitle: string;
    avgDays: number;
    hires: number;
  }>;
};

export const EMPTY_COMPANY_JOB_ANALYTICS: CompanyJobAnalyticsData = {
  windowDays: TIME_TO_HIRE_LOOKBACK_DAYS,
  funnel: {
    submitted: 0,
    in_review: 0,
    shortlisted: 0,
    hired: 0,
  },
  timeToHire: [],
};

type CompanyAnalyticsCacheEntry = {
  expiresAt: number;
  data: CompanyJobAnalyticsData;
};

const companyAnalyticsCache = new Map<string, CompanyAnalyticsCacheEntry>();

export const invalidateCompanyJobAnalyticsCache = (companyId?: string): void => {
  const normalizedCompanyId = readString(companyId, 120);
  if (!normalizedCompanyId) return;
  companyAnalyticsCache.delete(normalizedCompanyId);
};

const readString = (value: unknown, maxLength = 120): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.slice(0, maxLength);
};

export const buildCompanyJobAnalytics = async (
  db: Db,
  companyId: string,
): Promise<CompanyJobAnalyticsData> => {
  const normalizedCompanyId = readString(companyId, 120);
  if (!normalizedCompanyId) {
    return EMPTY_COMPANY_JOB_ANALYTICS;
  }

  const nowMs = Date.now();
  const cached = companyAnalyticsCache.get(normalizedCompanyId);
  if (cached && cached.expiresAt > nowMs) {
    return cached.data;
  }

  const now = new Date();
  const lookbackStartDate = new Date(now.getTime() - TIME_TO_HIRE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [funnelRows, timeToHireRows] = await Promise.all([
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

  const funnelCounts: Record<string, number> = {
    submitted: 0,
    in_review: 0,
    shortlisted: 0,
    hired: 0,
  };

  for (const row of funnelRows) {
    const status = readString((row as any)?._id, 40);
    const count = Number.isFinite((row as any)?.count) ? Number((row as any).count) : 0;
    if (status in funnelCounts) {
      funnelCounts[status] = count;
    }
  }

  const normalizedRows = (timeToHireRows || [])
    .map((row: any) => {
      const jobId = readString(row?.jobId, 120);
      const snapshotTitle = readString(row?.jobTitle, 180);
      const avgDays = Number.isFinite(row?.avgDays) ? Number(row.avgDays) : null;
      const hires = Number.isFinite(row?.hires) ? Number(row.hires) : 0;
      if (!jobId || hires <= 0 || avgDays == null || avgDays < 0) return null;
      return {
        jobId,
        snapshotTitle,
        avgDays,
        hires,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const missingTitleJobIds = Array.from(
    new Set(
      normalizedRows
        .filter((row) => !row.snapshotTitle)
        .map((row) => row.jobId),
    ),
  );

  const jobsForMissingTitles = missingTitleJobIds.length > 0
    ? await db.collection(JOBS_COLLECTION)
      .find(
        {
          companyId: normalizedCompanyId,
          id: { $in: missingTitleJobIds },
        },
        { projection: { id: 1, title: 1 } },
      )
      .toArray()
    : [];

  const fallbackJobTitleById = new Map<string, string>();
  for (const job of jobsForMissingTitles) {
    const id = readString((job as any)?.id, 120);
    if (!id) continue;
    const title = readString((job as any)?.title, 180);
    if (title) fallbackJobTitleById.set(id, title);
  }

  const timeToHire = normalizedRows
    .map((row) => ({
      jobId: row.jobId,
      jobTitle: row.snapshotTitle || fallbackJobTitleById.get(row.jobId) || 'Untitled role',
      avgDays: row.avgDays,
      hires: row.hires,
    }))
    .sort((a, b) => a.avgDays - b.avgDays);

  const result: CompanyJobAnalyticsData = {
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
};
