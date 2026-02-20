"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFullAccessAdSubscription = exports.getFullAccessSubscriptionId = exports.getFullCompanyCreditBalance = exports.hasFullCompanyAccess = exports.FULL_ACCESS_COMPANY_IMPRESSION_LIMIT = exports.FULL_ACCESS_COMPANY_AD_LIMIT = exports.FULL_ACCESS_COMPANY_CREDIT_BALANCE = void 0;
const BILLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const parsePositiveInteger = (rawValue, fallback) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed))
        return fallback;
    const rounded = Math.floor(parsed);
    return rounded > 0 ? rounded : fallback;
};
const FULL_ACCESS_COMPANY_ID = (process.env.AURA_FULL_ACCESS_COMPANY_ID || '').trim();
let hasWarnedMissingCompanyId = false;
exports.FULL_ACCESS_COMPANY_CREDIT_BALANCE = parsePositiveInteger(process.env.AURA_FULL_ACCESS_COMPANY_CREDIT_BALANCE, 1000000000);
exports.FULL_ACCESS_COMPANY_AD_LIMIT = parsePositiveInteger(process.env.AURA_FULL_ACCESS_COMPANY_AD_LIMIT, 1000000);
exports.FULL_ACCESS_COMPANY_IMPRESSION_LIMIT = parsePositiveInteger(process.env.AURA_FULL_ACCESS_COMPANY_IMPRESSION_LIMIT, 1000000000);
const hasFullCompanyAccess = (ownerType, ownerId) => {
    if (ownerType !== 'company' || typeof ownerId !== 'string')
        return false;
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId)
        return false;
    if (!FULL_ACCESS_COMPANY_ID) {
        if (!hasWarnedMissingCompanyId && process.env.NODE_ENV !== 'test') {
            console.warn('[CompanyAccess] AURA_FULL_ACCESS_COMPANY_ID is not configured. Full-access override is disabled.');
            hasWarnedMissingCompanyId = true;
        }
        return false;
    }
    return normalizedOwnerId === FULL_ACCESS_COMPANY_ID;
};
exports.hasFullCompanyAccess = hasFullCompanyAccess;
const getFullCompanyCreditBalance = (companyId, fallback = 0) => {
    return (0, exports.hasFullCompanyAccess)('company', companyId) ? exports.FULL_ACCESS_COMPANY_CREDIT_BALANCE : fallback;
};
exports.getFullCompanyCreditBalance = getFullCompanyCreditBalance;
const getFullAccessSubscriptionId = (companyId) => `company-access-${companyId}`;
exports.getFullAccessSubscriptionId = getFullAccessSubscriptionId;
const buildFullAccessAdSubscription = (companyId, now = Date.now()) => ({
    id: (0, exports.getFullAccessSubscriptionId)(companyId),
    userId: companyId,
    ownerId: companyId,
    ownerType: 'company',
    packageId: 'pkg-enterprise',
    packageName: 'Aura Enterprise Access',
    status: 'active',
    startDate: now - BILLING_WINDOW_MS,
    nextBillingDate: now + BILLING_WINDOW_MS,
    adsUsed: 0,
    adLimit: exports.FULL_ACCESS_COMPANY_AD_LIMIT,
    impressionsUsed: 0,
    impressionLimit: exports.FULL_ACCESS_COMPANY_IMPRESSION_LIMIT,
    periodStart: now - BILLING_WINDOW_MS,
    periodEnd: now + BILLING_WINDOW_MS,
    createdAt: now,
    updatedAt: now,
    durationDays: 30,
    complimentaryAccess: true
});
exports.buildFullAccessAdSubscription = buildFullAccessAdSubscription;
