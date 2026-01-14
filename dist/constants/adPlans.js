"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlanByName = exports.getPlanById = exports.AD_PLANS = void 0;
exports.AD_PLANS = {
    'pkg-starter': {
        id: 'pkg-starter',
        name: 'Personal Pulse',
        subtitle: 'Start the signal',
        durationDays: 14,
        price: '$39 • 14 Days',
        numericPrice: 39,
        adLimit: 1,
        idealFor: 'First-time users, quick launches, testing ideas',
        features: [
            '1 Active Signal',
            'Up to 5,000 targeted impressions',
            '14-Day Signal Retention',
            'Standard Feed Distribution',
            'Basic Reach & Click Analytics',
            'Ideal for announcements, promos, and experiments'
        ],
        gradient: 'from-slate-400 to-slate-600',
        paymentType: 'one-time'
    },
    'pkg-pro': {
        id: 'pkg-pro',
        name: 'Aura Radiance',
        subtitle: 'Grow your presence',
        durationDays: 30,
        price: '$199 / month',
        numericPrice: 199,
        adLimit: 5,
        idealFor: 'Creators, influencers, side hustles',
        features: [
            '5 Active Signals at once',
            'Up to 50,000 monthly impressions',
            'Priority Feed Injection',
            'Smart CTA Button (click + conversion tracking)',
            'Creator Analytics Dashboard',
            'Monthly Signal Refresh',
            'Cancel anytime'
        ],
        gradient: 'from-emerald-500 to-emerald-700',
        paymentType: 'subscription',
        subscriptionPlanId: 'P-7BE61882EP388262CNFRU2NA'
    },
    'pkg-enterprise': {
        id: 'pkg-enterprise',
        name: 'Universal Signal',
        subtitle: 'Own the network',
        durationDays: 30,
        price: '$699 / month',
        numericPrice: 699,
        adLimit: 20,
        idealFor: 'Brands, agencies, power users',
        features: [
            '20 Active Signals simultaneously',
            'Up to 250,000+ impressions / month',
            'Maximum Network Penetration',
            'Deep-Dive Neural Analytics',
            '– audience behavior',
            '– timing optimization',
            '– conversion insights',
            'Verified Gold Aura Badge on all signals',
            'Priority / White-Glove Support',
            'Cancel anytime'
        ],
        gradient: 'from-slate-900 via-emerald-900 to-black',
        paymentType: 'subscription',
        subscriptionPlanId: 'P-3UV62007TB5346040NFRU2OY'
    }
};
const getPlanById = (planId) => {
    return exports.AD_PLANS[planId] || null;
};
exports.getPlanById = getPlanById;
const getPlanByName = (planName) => {
    return Object.values(exports.AD_PLANS).find(plan => plan.name === planName) || null;
};
exports.getPlanByName = getPlanByName;
