import type { OpenToWorkDemandLevel } from './openToWorkDemandService';

export interface JobMarketDemandQuery {
  location?: string;
  workModel?: string | null;
  roles?: string[];
  limit?: number;
}

export interface JobMarketDemandSnapshotContext {
  location?: string;
  workModel?: string | null;
}

export interface JobMarketDemandEntry {
  roleFamily: string;
  label: string;
  demand: OpenToWorkDemandLevel;
  activeJobs: number;
  newJobs24h: number;
  newJobs7d: number;
  avgSalary: number | null;
  salaryCurrency: string | null;
  salarySampleSize: number;
  delta7d: number | null;
  trendDirection: 'up' | 'down' | 'flat' | 'unknown';
}

export interface JobMarketDemandMeta {
  location: string | null;
  workModel: string | null;
  roles: string[];
  trendWindowDays: number;
  salarySource: 'listed_job_salaries';
  snapshotDate: string;
  trendAvailable: boolean;
  personalized: boolean;
}

export interface JobMarketDemandResult {
  entries: JobMarketDemandEntry[];
  meta: JobMarketDemandMeta;
}

export type SalaryAccumulator = {
  salarySum: number;
  salarySampleSize: number;
};

export type GroupAccumulator = {
  roleFamily: string;
  label: string;
  activeJobs: number;
  newJobs24h: number;
  newJobs7d: number;
  salaryByCurrency: Map<string, SalaryAccumulator>;
};

export type SnapshotDoc = {
  roleFamily: string;
  activeJobs: number;
};

export type MarketDemandSnapshotGroupDoc = {
  roleFamily?: unknown;
  label?: unknown;
  activeJobs?: unknown;
  newJobs24h?: unknown;
  newJobs7d?: unknown;
  salarySum?: unknown;
  avgSalary?: unknown;
  salaryCurrency?: unknown;
  salarySampleSize?: unknown;
};
