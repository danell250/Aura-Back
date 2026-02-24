import { Db } from 'mongodb';

const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Single source of truth for subscription period advancement.
 * Uses flat duration windows and compare-and-swap persistence to avoid
 * concurrent double-resets.
 */
export async function ensureCurrentBillingPeriod(
  db: Db,
  subscription: any
): Promise<any> {
  const now = Date.now();

  if (subscription.periodEnd && now < subscription.periodEnd) {
    return subscription;
  }

  if (!subscription.periodEnd) {
    const durationDays = Number(subscription.durationDays) || 30;
    const periodStart = Number(subscription.startDate) || now;
    const periodEnd = periodStart + durationDays * ONE_DAY_MS;

    const bootstrapped = await db
      .collection(AD_SUBSCRIPTIONS_COLLECTION)
      .findOneAndUpdate(
        { id: subscription.id, periodEnd: { $exists: false } },
        {
          $set: {
            periodStart,
            periodEnd,
            adsUsed: 0,
            impressionsUsed: 0,
            updatedAt: now
          }
        },
        { returnDocument: 'after' }
      );

    const fresh =
      bootstrapped && 'value' in bootstrapped
        ? (bootstrapped as any).value
        : bootstrapped;
    if (fresh) return fresh;

    const refetched = await db
      .collection(AD_SUBSCRIPTIONS_COLLECTION)
      .findOne({ id: subscription.id });
    if (!refetched) return subscription;
    if (now < refetched.periodEnd) return refetched;
    subscription = refetched;
  }

  const durationDays = Number(subscription.durationDays) || 30;
  const windowMs = durationDays * ONE_DAY_MS;
  const elapsed = now - subscription.periodEnd;
  const periodsElapsed = Math.floor(elapsed / windowMs) + 1;
  const newPeriodStart = subscription.periodEnd + (periodsElapsed - 1) * windowMs;
  const newPeriodEnd = newPeriodStart + windowMs;

  const result = await db
    .collection(AD_SUBSCRIPTIONS_COLLECTION)
    .findOneAndUpdate(
      {
        id: subscription.id,
        periodEnd: subscription.periodEnd
      },
      {
        $set: {
          adsUsed: 0,
          impressionsUsed: 0,
          periodStart: newPeriodStart,
          periodEnd: newPeriodEnd,
          updatedAt: now
        }
      },
      { returnDocument: 'after' }
    );

  const updated =
    result && 'value' in result ? (result as any).value : result;

  if (updated) return updated;

  const current = await db
    .collection(AD_SUBSCRIPTIONS_COLLECTION)
    .findOne({ id: subscription.id });
  return current ?? subscription;
}
