"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adSubscriptionService = void 0;
const db_1 = require("../db");
const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';
exports.adSubscriptionService = {
    /**
     * Checks if the subscription period has ended and resets usage if needed.
     * Updates the subscription in the database.
     * Returns the updated subscription.
     */
    checkAndResetSubscriptionPeriod: (subscription) => __awaiter(void 0, void 0, void 0, function* () {
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
            const db = (0, db_1.getDB)();
            yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ id: subscription.id }, {
                $set: {
                    periodStart: subscription.periodStart,
                    periodEnd: subscription.periodEnd,
                    adsUsed: subscription.adsUsed
                }
            });
        }
        return subscription;
    })
};
