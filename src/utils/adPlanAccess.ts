import { Db } from 'mongodb';
import { AD_PLANS, AdPlanEntitlements, AdPlanId, getPlanEntitlements } from '../constants/adPlans';
import { ensureCurrentPeriod } from '../controllers/adSubscriptionsController';
import { hasFullCompanyAccess } from './companyAccess';

export type AdOwnerType = 'user' | 'company';

export interface OwnerPlanAccess {
  packageId: AdPlanId;
  entitlements: AdPlanEntitlements;
  subscription: any | null;
  complimentaryAccess: boolean;
}

export const buildActiveSubscriptionQuery = (ownerId: string, ownerType: AdOwnerType, now = Date.now()) => {
  const query: any = {
    status: 'active',
    $or: [
      { endDate: { $exists: false } },
      { endDate: { $gt: now } }
    ],
    $and: [
      {
        $or: [
          { ownerId, ownerType },
          { userId: ownerId, ownerType } // backward compatibility
        ]
      }
    ]
  };

  if (ownerType === 'user') {
    (query.$and[0] as any).$or.push({ userId: ownerId, ownerType: { $exists: false } });
  }

  return query;
};

export const findActiveSubscriptionForOwner = async (
  db: Db,
  ownerId: string,
  ownerType: AdOwnerType,
  now = Date.now(),
  options?: { refreshPeriod?: boolean; projection?: Record<string, 0 | 1> }
) => {
  const subscription = await db.collection('adSubscriptions').findOne(
    buildActiveSubscriptionQuery(ownerId, ownerType, now),
    options?.projection ? { projection: options.projection } : undefined
  );
  if (!subscription) return null;

  if (options?.refreshPeriod) {
    return ensureCurrentPeriod(db, subscription);
  }

  return subscription;
};

export const resolveOwnerPlanAccess = async (
  db: Db,
  ownerId: string,
  ownerType: AdOwnerType,
  now = Date.now(),
  options?: { refreshPeriod?: boolean }
): Promise<OwnerPlanAccess> => {
  const complimentaryAccess = hasFullCompanyAccess(ownerType, ownerId);
  if (complimentaryAccess) {
    return {
      packageId: 'pkg-enterprise',
      entitlements: getPlanEntitlements('pkg-enterprise'),
      subscription: null,
      complimentaryAccess: true
    };
  }

  const subscription = await findActiveSubscriptionForOwner(
    db,
    ownerId,
    ownerType,
    now,
    { refreshPeriod: options?.refreshPeriod }
  );

  const packageId = (typeof subscription?.packageId === 'string' && AD_PLANS[subscription.packageId as AdPlanId])
    ? (subscription.packageId as AdPlanId)
    : 'pkg-starter';

  return {
    packageId,
    entitlements: getPlanEntitlements(packageId),
    subscription,
    complimentaryAccess: false
  };
};
