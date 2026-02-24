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
exports.ensureCurrentBillingPeriod = ensureCurrentBillingPeriod;
const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Single source of truth for subscription period advancement.
 * Uses flat duration windows and compare-and-swap persistence to avoid
 * concurrent double-resets.
 */
function ensureCurrentBillingPeriod(db, subscription) {
    return __awaiter(this, void 0, void 0, function* () {
        const now = Date.now();
        if (subscription.periodEnd && now < subscription.periodEnd) {
            return subscription;
        }
        if (!subscription.periodEnd) {
            const durationDays = Number(subscription.durationDays) || 30;
            const periodStart = Number(subscription.startDate) || now;
            const periodEnd = periodStart + durationDays * ONE_DAY_MS;
            const bootstrapped = yield db
                .collection(AD_SUBSCRIPTIONS_COLLECTION)
                .findOneAndUpdate({ id: subscription.id, periodEnd: { $exists: false } }, {
                $set: {
                    periodStart,
                    periodEnd,
                    adsUsed: 0,
                    impressionsUsed: 0,
                    updatedAt: now
                }
            }, { returnDocument: 'after' });
            const fresh = bootstrapped && 'value' in bootstrapped
                ? bootstrapped.value
                : bootstrapped;
            if (fresh)
                return fresh;
            const refetched = yield db
                .collection(AD_SUBSCRIPTIONS_COLLECTION)
                .findOne({ id: subscription.id });
            if (!refetched)
                return subscription;
            if (now < refetched.periodEnd)
                return refetched;
            subscription = refetched;
        }
        const durationDays = Number(subscription.durationDays) || 30;
        const windowMs = durationDays * ONE_DAY_MS;
        const elapsed = now - subscription.periodEnd;
        const periodsElapsed = Math.floor(elapsed / windowMs) + 1;
        const newPeriodStart = subscription.periodEnd + (periodsElapsed - 1) * windowMs;
        const newPeriodEnd = newPeriodStart + windowMs;
        const result = yield db
            .collection(AD_SUBSCRIPTIONS_COLLECTION)
            .findOneAndUpdate({
            id: subscription.id,
            periodEnd: subscription.periodEnd
        }, {
            $set: {
                adsUsed: 0,
                impressionsUsed: 0,
                periodStart: newPeriodStart,
                periodEnd: newPeriodEnd,
                updatedAt: now
            }
        }, { returnDocument: 'after' });
        const updated = result && 'value' in result ? result.value : result;
        if (updated)
            return updated;
        const current = yield db
            .collection(AD_SUBSCRIPTIONS_COLLECTION)
            .findOne({ id: subscription.id });
        return current !== null && current !== void 0 ? current : subscription;
    });
}
