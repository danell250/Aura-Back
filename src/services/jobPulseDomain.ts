import { parseJobPulseIsoMs } from './jobPulseUtils';

export const JOB_PULSE_APPLICATION_WINDOW_HOURS = 24;
export const JOB_PULSE_VIEW_WINDOW_MINUTES = 60;
export const JOB_PULSE_MATCH_WINDOW_MINUTES = 10;
export const JOB_PULSE_SAVE_WINDOW_HOURS = 24;

export type BucketCounterField =
  | 'jobViewedCount'
  | 'jobAppliedCount'
  | 'jobMatchedCount'
  | 'jobSavedCount';

export type JobPulseWindowBounds = {
  applicationSince: Date;
  viewSince: Date;
  matchSince: Date;
  saveSince: Date;
};

export const buildJobPulseWindowBounds = (nowMs: number): JobPulseWindowBounds => ({
  applicationSince: new Date(nowMs - (JOB_PULSE_APPLICATION_WINDOW_HOURS * 60 * 60 * 1000)),
  viewSince: new Date(nowMs - (JOB_PULSE_VIEW_WINDOW_MINUTES * 60 * 1000)),
  matchSince: new Date(nowMs - (JOB_PULSE_MATCH_WINDOW_MINUTES * 60 * 1000)),
  saveSince: new Date(nowMs - (JOB_PULSE_SAVE_WINDOW_HOURS * 60 * 60 * 1000)),
});

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

export const computeJobPulseHotScore = (params: {
  applicationsLast24h: number;
  viewsLast60m: number;
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
      + (params.viewsLast60m * 2)
      + (params.matchesLast10m * 10)
      + (params.savesLast24h * 4)
      + freshnessBonus,
    ),
  );
};
