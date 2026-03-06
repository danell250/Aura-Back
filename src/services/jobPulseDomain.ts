import { parseJobPulseIsoMs } from './jobPulseUtils';

export const JOB_PULSE_APPLICATION_WINDOW_HOURS = 24;
export const JOB_PULSE_APPLICATION_RECENT_WINDOW_HOURS = 2;
export const JOB_PULSE_VIEW_WINDOW_MINUTES = 60;
export const JOB_PULSE_MATCH_WINDOW_MINUTES = 10;
export const JOB_PULSE_SAVE_WINDOW_HOURS = 24;

export type JobHeatLabel = 'low' | 'moderate' | 'high' | 'extreme';

export type BucketCounterField =
  | 'jobViewedCount'
  | 'jobAppliedCount'
  | 'jobMatchedCount'
  | 'jobSavedCount';

export type JobPulseWindowBounds = {
  applicationSince: Date;
  applicationRecentSince: Date;
  todaySince: Date;
  viewSince: Date;
  matchSince: Date;
  saveSince: Date;
};

export const buildJobPulseWindowBounds = (nowMs: number): JobPulseWindowBounds => {
  const now = new Date(nowMs);
  const todaySince = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0,
  ));

  return {
    applicationSince: new Date(nowMs - (JOB_PULSE_APPLICATION_WINDOW_HOURS * 60 * 60 * 1000)),
    applicationRecentSince: new Date(nowMs - (JOB_PULSE_APPLICATION_RECENT_WINDOW_HOURS * 60 * 60 * 1000)),
    todaySince,
    viewSince: new Date(nowMs - (JOB_PULSE_VIEW_WINDOW_MINUTES * 60 * 1000)),
    matchSince: new Date(nowMs - (JOB_PULSE_MATCH_WINDOW_MINUTES * 60 * 1000)),
    saveSince: new Date(nowMs - (JOB_PULSE_SAVE_WINDOW_HOURS * 60 * 60 * 1000)),
  };
};

export const buildJobPulseBucketWindowSumExpression = (
  counterField: BucketCounterField,
  since: Date,
) => ({
  $sum: {
    $cond: [
      { $gte: ['$bucketStartDate', since] },
      `$${counterField}`,
      0,
    ],
  },
});

export const computeWindowedJobPulseActivityScore = (params: {
  applicationsLast24h: number;
  viewsLast1h: number;
  matchesLast10m: number;
  savesLast24h: number;
  discoveredAt: string | null;
  nowMs: number;
}): number => {
  const discoveredMs = parseJobPulseIsoMs(params.discoveredAt);
  const ageHours = discoveredMs > 0
    ? Math.max(0, (params.nowMs - discoveredMs) / (60 * 60 * 1000))
    : 0;
  const freshnessBonus = discoveredMs > 0 ? Math.max(0, 24 - ageHours) : 0;

  return Math.max(
    0,
    Math.round(
      (params.applicationsLast24h * 8)
      + (params.viewsLast1h * 2)
      + (params.matchesLast10m * 10)
      + (params.savesLast24h * 4)
      + freshnessBonus,
    ),
  );
};

export const computeJobHeatScore = (params: {
  applicationsLast2h: number;
  applicationsToday: number;
  totalAuraApplications: number;
  viewsLast1h: number;
  savesToday: number;
}): number =>
  Math.max(
    0,
    Math.round(
      (params.applicationsLast2h * 4)
      + (params.applicationsToday * 2)
      + Math.floor(params.totalAuraApplications / 10)
      + Math.floor(params.viewsLast1h / 8)
      + Math.floor(params.savesToday / 3),
    ),
  );

export const resolveJobHeatLabel = (heatScore: number): JobHeatLabel => {
  if (heatScore >= 61) return 'extreme';
  if (heatScore >= 21) return 'high';
  if (heatScore >= 6) return 'moderate';
  return 'low';
};
