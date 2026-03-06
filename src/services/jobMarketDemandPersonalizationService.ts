import type { JobMarketDemandQuery } from './jobMarketDemandService';

const normalizeRoleHints = (user: any): string[] => {
  const deduped = new Set<string>();
  const hints: string[] = [];
  const preferredRoles = Array.isArray(user?.preferredRoles) ? user.preferredRoles : [];

  for (const value of preferredRoles) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (deduped.has(dedupeKey)) continue;
    deduped.add(dedupeKey);
    hints.push(normalized);
    if (hints.length >= 6) return hints;
  }

  const title = String(user?.title || '').trim();
  if (title && !deduped.has(title.toLowerCase())) {
    hints.push(title);
  }

  return hints.slice(0, 6);
};

const normalizeLocationHint = (user: any): string => {
  const country = String(user?.country || '').trim();
  if (country) return country;

  const preferredLocations = Array.isArray(user?.preferredLocations) ? user.preferredLocations : [];
  for (const value of preferredLocations) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (lower === 'remote' || lower === 'worldwide' || lower === 'global' || lower === 'anywhere') continue;
    return normalized;
  }

  return '';
};

const normalizeWorkModelHint = (user: any): string => {
  const preferredWorkModels = Array.isArray(user?.preferredWorkModels)
    ? user.preferredWorkModels
        .map((value: unknown) => String(value || '').trim().toLowerCase())
        .filter((value: string) => value === 'remote' || value === 'hybrid' || value === 'onsite')
    : [];

  if (preferredWorkModels.length === 1) {
    return preferredWorkModels[0];
  }

  return '';
};

export const buildPersonalizedJobMarketDemandQuery = (user: any, limit = 3): JobMarketDemandQuery => ({
  location: normalizeLocationHint(user),
  workModel: normalizeWorkModelHint(user),
  roles: normalizeRoleHints(user),
  limit,
});
