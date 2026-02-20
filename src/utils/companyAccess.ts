const BILLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const parsePositiveInteger = (rawValue: string | undefined, fallback: number): number => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
};

const FULL_ACCESS_COMPANY_ID = (process.env.AURA_FULL_ACCESS_COMPANY_ID || '').trim();
let hasWarnedMissingCompanyId = false;
export const FULL_ACCESS_COMPANY_CREDIT_BALANCE = parsePositiveInteger(
  process.env.AURA_FULL_ACCESS_COMPANY_CREDIT_BALANCE,
  1_000_000_000
);
export const FULL_ACCESS_COMPANY_AD_LIMIT = parsePositiveInteger(
  process.env.AURA_FULL_ACCESS_COMPANY_AD_LIMIT,
  1_000_000
);
export const FULL_ACCESS_COMPANY_IMPRESSION_LIMIT = parsePositiveInteger(
  process.env.AURA_FULL_ACCESS_COMPANY_IMPRESSION_LIMIT,
  1_000_000_000
);

export const hasFullCompanyAccess = (ownerType: unknown, ownerId: unknown): boolean => {
  if (ownerType !== 'company' || typeof ownerId !== 'string') return false;
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) return false;
  if (!FULL_ACCESS_COMPANY_ID) {
    if (!hasWarnedMissingCompanyId && process.env.NODE_ENV !== 'test') {
      console.warn('[CompanyAccess] AURA_FULL_ACCESS_COMPANY_ID is not configured. Full-access override is disabled.');
      hasWarnedMissingCompanyId = true;
    }
    return false;
  }
  return normalizedOwnerId === FULL_ACCESS_COMPANY_ID;
};

export const getFullCompanyCreditBalance = (companyId: string, fallback = 0): number => {
  return hasFullCompanyAccess('company', companyId) ? FULL_ACCESS_COMPANY_CREDIT_BALANCE : fallback;
};

export const getFullAccessSubscriptionId = (companyId: string): string => `company-access-${companyId}`;

export const buildFullAccessAdSubscription = (companyId: string, now = Date.now()) => ({
  id: getFullAccessSubscriptionId(companyId),
  userId: companyId,
  ownerId: companyId,
  ownerType: 'company' as const,
  packageId: 'pkg-enterprise',
  packageName: 'Aura Enterprise Access',
  status: 'active' as const,
  startDate: now - BILLING_WINDOW_MS,
  nextBillingDate: now + BILLING_WINDOW_MS,
  adsUsed: 0,
  adLimit: FULL_ACCESS_COMPANY_AD_LIMIT,
  impressionsUsed: 0,
  impressionLimit: FULL_ACCESS_COMPANY_IMPRESSION_LIMIT,
  periodStart: now - BILLING_WINDOW_MS,
  periodEnd: now + BILLING_WINDOW_MS,
  createdAt: now,
  updatedAt: now,
  durationDays: 30,
  complimentaryAccess: true
});
