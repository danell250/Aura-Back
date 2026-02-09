export const AD_PLANS = {
  'pkg-starter': {
    id: 'pkg-starter',
    name: 'Personal Pulse — Access Tier',
    subtitle: 'Start the signal',
    durationDays: 14,
    price: '$39 • 14 days (one-time)',
    numericPrice: 39,
    adLimit: 1,
    impressionLimit: 5000,
    idealFor: 'First-time users, testing ideas, announcements',
    features: [
      '1 Active Signal',
      '14-Day Signal Visibility Window',
      'Standard Feed Distribution',
      'Signal View & Click Tracking',
      'Basic Engagement Insights'
    ],
    gradient: 'from-slate-400 to-slate-600',
    paymentType: 'one-time'
  },
  'pkg-pro': {
    id: 'pkg-pro',
    name: 'Aura Radiance — Growth Tools Tier',
    subtitle: 'Grow your presence',
    durationDays: 30,
    price: '$199 / month',
    numericPrice: 199,
    adLimit: 5,
    impressionLimit: 50000,
    idealFor: 'Creators, side hustles, early brands',
    features: [
      'Up to 5 Active Signals',
      'Priority Distribution (relative to free & entry users)',
      'Smart CTA Button (click tracking)',
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
    name: 'Universal Signal — Power & Control Tier',
    subtitle: 'Own the network',
    durationDays: 30,
    price: '$699 / month',
    numericPrice: 699,
    adLimit: 20,
    impressionLimit: 250000,
    idealFor: 'Brands, agencies, power users',
    features: [
      'Up to 20 Active Signals',
      'Maximum Distribution Priority',
      'Advanced Analytics',
      '– audience behavior',
      '– timing performance',
      '– signal interaction trends',
      'Verified Aura Badge',
      'Priority / White-Glove Support'
    ],
    gradient: 'from-slate-900 via-emerald-900 to-black',
    paymentType: 'subscription',
    subscriptionPlanId: 'P-3UV62007TB5346040NFRU2OY'
  }
};

export const getPlanById = (planId: string) => {
  return AD_PLANS[planId as keyof typeof AD_PLANS] || null;
};

export const getPlanByName = (planName: string) => {
  return Object.values(AD_PLANS).find(plan => plan.name === planName) || null;
};
