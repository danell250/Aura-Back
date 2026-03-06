import { readString } from '../utils/inputSanitizers';

export const parseJobPulseIsoMs = (value: unknown): number => {
  const normalized = readString(String(value || ''), 80);
  if (!normalized) return 0;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const resolveLatestJobPulseIso = (...values: Array<string | null | undefined>): string | null => {
  let bestValue: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const parsedMs = parseJobPulseIsoMs(value);
    if (parsedMs <= 0) continue;
    if (parsedMs <= bestMs) continue;
    bestMs = parsedMs;
    bestValue = value || null;
  }
  return bestValue;
};

export const normalizeJobPulseCount = (value: unknown): number =>
  Number.isFinite(Number(value))
    ? Math.max(0, Math.floor(Number(value)))
    : 0;

export const resolveJobPulseSourceType = (source: string | null): 'aura' | 'aggregated' =>
  source && source.startsWith('aura:')
    ? 'aura'
    : 'aggregated';

export const resolveJobPulseDiscoveredAt = (job: any): string | null =>
  readString(job?.discoveredAt, 80) || null;
