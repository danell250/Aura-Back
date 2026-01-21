import { getDB } from '../db';
import { ObjectId } from 'mongodb';

const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';

export const adSubscriptionService = {
  /**
   * Checks if the subscription period has ended and resets usage if needed.
   * Updates the subscription in the database.
   * Returns the updated subscription.
   */
  checkAndResetSubscriptionPeriod: async (subscription: any): Promise<any> => {
    const now = Date.now();
    let updated = false;
    
    // Initialize period fields if missing (migration for existing records)
    if (!subscription.periodStart) {
      subscription.periodStart = subscription.startDate;
      
      // Calculate initial periodEnd (1 month from start)
      const startDate = new Date(subscription.startDate);
      const periodEnd = new Date(startDate);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      subscription.periodEnd = periodEnd.getTime();
      
      updated = true;
      console.log(`[AdSubscription] Initializing period for ${subscription.id}: ${new Date(subscription.periodStart).toISOString()} - ${new Date(subscription.periodEnd).toISOString()}`);
    }

    // Advance period if current time is past periodEnd
    // We loop to catch up if multiple periods have passed
    // Safety check: Don't loop more than 60 times (5 years) to prevent infinite loops if dates are messed up
    let loopCount = 0;
    while (now >= subscription.periodEnd && loopCount < 60) {
      const oldPeriodEnd = new Date(subscription.periodEnd);
      
      // Advance periodStart to the old periodEnd
      subscription.periodStart = subscription.periodEnd;
      
      // Advance periodEnd by 1 month
      const newPeriodEnd = new Date(oldPeriodEnd);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
      subscription.periodEnd = newPeriodEnd.getTime();
      
      // Reset usage
      subscription.adsUsed = 0;
      updated = true;
      loopCount++;
      
      console.log(`[AdSubscription] Advancing period for ${subscription.id}. New period: ${new Date(subscription.periodStart).toISOString()} to ${new Date(subscription.periodEnd).toISOString()}`);
    }

    if (updated) {
      const db = getDB();
      await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
        { id: subscription.id },
        { 
          $set: { 
            periodStart: subscription.periodStart,
            periodEnd: subscription.periodEnd,
            adsUsed: subscription.adsUsed
          } 
        }
      );
    }

    return subscription;
  }
};
