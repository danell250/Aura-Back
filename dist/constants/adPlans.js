"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlacementAllowedForPlan = exports.getPlanEntitlements = exports.getPlanByName = exports.getPlanById = exports.DEFAULT_AD_PLAN_ID = exports.AD_PLANS = void 0;
exports.AD_PLANS = {
    'pkg-starter': {
        id: 'pkg-starter',
        name: 'Personal Pulse',
        subtitle: 'Essential signal access',
        durationDays: 14,
        price: '$39 • 14 days (one-time)',
        numericPrice: 39,
        adLimit: 1,
        activeAdsLimit: 1,
        impressionLimit: 5000,
        idealFor: 'Founders and individuals validating one offer at a time',
        features: [
            '1 ad slot',
            'Basic metrics only (Impressions, Clicks, CTR)',
            'Feed placement only',
            'No report scheduling',
            'No CSV/PDF export'
        ],
        gradient: 'from-slate-400 to-slate-600',
        paymentType: 'one-time',
        entitlements: {
            metricsTier: 'basic',
            allowedPlacements: ['feed'],
            canBoost: false,
            reportsTier: 'none',
            canExportCsv: false,
            canExportPdf: false,
            canScheduleReports: false,
            priorityPlacement: false,
            multiUserAccess: false,
            dedicatedAnalyticsHistory: false,
            analyticsHistoryDays: 7,
            whiteLabelPdf: false
        }
    },
    'pkg-pro': {
        id: 'pkg-pro',
        name: 'Pro Signal',
        subtitle: 'Growth controls for active advertisers',
        durationDays: 30,
        price: '$199 / month',
        numericPrice: 199,
        adLimit: 5,
        activeAdsLimit: 5,
        impressionLimit: 50000,
        idealFor: 'Independent teams running repeatable campaigns',
        features: [
            '5 ad slots',
            'Full metrics (Impressions, Reach, Clicks, CTR, Conversions, CVR)',
            'Placements: Feed + Search + Profile',
            'Boosting capability',
            'CSV export only',
            'No PDF export or report scheduling'
        ],
        gradient: 'from-emerald-500 to-emerald-700',
        paymentType: 'subscription',
        subscriptionPlanId: 'P-7BE61882EP388262CNFRU2NA',
        entitlements: {
            metricsTier: 'full',
            allowedPlacements: ['feed', 'search', 'profile'],
            canBoost: true,
            reportsTier: 'csv',
            canExportCsv: true,
            canExportPdf: false,
            canScheduleReports: false,
            priorityPlacement: false,
            multiUserAccess: false,
            dedicatedAnalyticsHistory: false,
            analyticsHistoryDays: 30,
            whiteLabelPdf: false
        }
    },
    'pkg-enterprise': {
        id: 'pkg-enterprise',
        name: 'Universal Signal',
        subtitle: 'Enterprise reporting and priority distribution',
        durationDays: 30,
        price: '$699 / month',
        numericPrice: 699,
        adLimit: 20,
        activeAdsLimit: 20,
        impressionLimit: 250000,
        idealFor: 'Companies, agencies, and performance teams accountable for ROI',
        features: [
            'Up to 20 ad slots',
            'Everything in Pro Signal',
            'Scheduled PDF reports',
            'White-label PDF with company branding',
            'Priority placement',
            'Company identity / multi-user access',
            'Dedicated analytics history'
        ],
        gradient: 'from-slate-900 via-emerald-900 to-black',
        paymentType: 'subscription',
        subscriptionPlanId: 'P-3UV62007TB5346040NFRU2OY',
        entitlements: {
            metricsTier: 'full',
            allowedPlacements: ['feed', 'search', 'profile'],
            canBoost: true,
            reportsTier: 'enterprise',
            canExportCsv: true,
            canExportPdf: true,
            canScheduleReports: true,
            priorityPlacement: true,
            multiUserAccess: true,
            dedicatedAnalyticsHistory: true,
            analyticsHistoryDays: 90,
            whiteLabelPdf: true
        }
    }
};
exports.DEFAULT_AD_PLAN_ID = 'pkg-starter';
const getPlanById = (planId) => {
    return exports.AD_PLANS[planId] || null;
};
exports.getPlanById = getPlanById;
const getPlanByName = (planName) => {
    return Object.values(exports.AD_PLANS).find((plan) => plan.name === planName) || null;
};
exports.getPlanByName = getPlanByName;
const getPlanEntitlements = (planId) => {
    if (planId && exports.AD_PLANS[planId]) {
        return exports.AD_PLANS[planId].entitlements;
    }
    return exports.AD_PLANS[exports.DEFAULT_AD_PLAN_ID].entitlements;
};
exports.getPlanEntitlements = getPlanEntitlements;
const isPlacementAllowedForPlan = (planId, placement) => {
    return (0, exports.getPlanEntitlements)(planId).allowedPlacements.includes(placement);
};
exports.isPlacementAllowedForPlan = isPlacementAllowedForPlan;
