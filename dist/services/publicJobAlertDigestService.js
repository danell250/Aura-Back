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
exports.sendWeeklyPublicJobAlertDigests = void 0;
const jobAlertDigestJobsService_1 = require("./jobAlertDigestJobsService");
const jobAlertEmailService_1 = require("./jobAlertEmailService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const publicWebUrl_1 = require("../utils/publicWebUrl");
const recurringBatchUtils_1 = require("../utils/recurringBatchUtils");
const JOB_ALERT_SUBSCRIPTIONS_COLLECTION = 'job_alert_subscriptions';
const APP_BASE_URL = (0, publicWebUrl_1.getPublicWebUrl)();
const JOB_ALERT_PUBLIC_MAX_SUBSCRIPTIONS_PER_RUN = Number.isFinite(Number(process.env.JOB_ALERT_PUBLIC_MAX_SUBSCRIPTIONS_PER_RUN))
    ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_PUBLIC_MAX_SUBSCRIPTIONS_PER_RUN)))
    : 400;
const JOB_ALERT_PUBLIC_DELIVERY_BATCH_SIZE = Number.isFinite(Number(process.env.JOB_ALERT_PUBLIC_DELIVERY_BATCH_SIZE))
    ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_PUBLIC_DELIVERY_BATCH_SIZE)))
    : 12;
const JOB_ALERT_WEEKLY_SEND_DAY_NUMBER = 1;
const JOB_ALERT_DIGEST_TIMEZONE = ((0, inputSanitizers_1.readString)(process.env.JOB_ALERT_DIGEST_TIMEZONE, 80)
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC');
const getIsoHoursAgo = (hours) => new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
const buildDigestDateKey = (value) => new Intl.DateTimeFormat('en-CA', {
    timeZone: JOB_ALERT_DIGEST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(new Date(value));
const getTimeZoneWeekday = (value) => {
    var _a, _b, _c;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: JOB_ALERT_DIGEST_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(value));
    const year = Number(((_a = parts.find((part) => part.type === 'year')) === null || _a === void 0 ? void 0 : _a.value) || '0');
    const month = Number(((_b = parts.find((part) => part.type === 'month')) === null || _b === void 0 ? void 0 : _b.value) || '0');
    const day = Number(((_c = parts.find((part) => part.type === 'day')) === null || _c === void 0 ? void 0 : _c.value) || '0');
    return new Date(Date.UTC(year, Math.max(0, month - 1), day)).getUTCDay();
};
const normalizeWeeklyDigestWindowStartIso = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return getIsoHoursAgo(24 * 7);
    }
    return parsed.toISOString();
};
const buildWeeklyDigestEligibility = (lastDigestSentAtRaw) => {
    const now = new Date();
    if (getTimeZoneWeekday(now) !== JOB_ALERT_WEEKLY_SEND_DAY_NUMBER)
        return false;
    if (!lastDigestSentAtRaw)
        return true;
    const lastSent = new Date(lastDigestSentAtRaw);
    if (Number.isNaN(lastSent.getTime()))
        return true;
    return buildDigestDateKey(lastSent) !== buildDigestDateKey(now);
};
const buildWeeklyDigestUpdateFilter = (subscription) => {
    return {
        id: subscription.id,
    };
};
const listWeeklyPublicDigestSubscriptions = (db) => __awaiter(void 0, void 0, void 0, function* () {
    return db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION)
        .find({
        isActive: true,
        cadence: 'weekly',
    }, {
        projection: {
            id: 1,
            email: 1,
            category: 1,
            lastDigestSentAt: 1,
            unsubscribeToken: 1,
        },
    })
        .limit(JOB_ALERT_PUBLIC_MAX_SUBSCRIPTIONS_PER_RUN)
        .toArray();
});
const groupEligiblePublicDigestSubscriptions = (subscriptions) => {
    const grouped = new Map();
    subscriptions.forEach((subscription) => {
        const email = (0, inputSanitizers_1.readString)(subscription === null || subscription === void 0 ? void 0 : subscription.email, 220).toLowerCase();
        if (!email)
            return;
        const lastDigestSentAt = (0, inputSanitizers_1.readString)(subscription === null || subscription === void 0 ? void 0 : subscription.lastDigestSentAt, 80);
        if (!buildWeeklyDigestEligibility(lastDigestSentAt))
            return;
        const windowStartIso = normalizeWeeklyDigestWindowStartIso(lastDigestSentAt || getIsoHoursAgo(24 * 7));
        const nextSubscription = {
            id: (0, inputSanitizers_1.readString)(subscription === null || subscription === void 0 ? void 0 : subscription.id, 120),
            email,
            category: (0, jobAlertDigestJobsService_1.resolvePublicDigestCategory)(subscription === null || subscription === void 0 ? void 0 : subscription.category),
            windowStartIso,
            lastDigestSentAt,
            unsubscribeToken: (0, inputSanitizers_1.readString)(subscription === null || subscription === void 0 ? void 0 : subscription.unsubscribeToken, 180),
        };
        const bucket = grouped.get(windowStartIso);
        if (bucket) {
            bucket.push(nextSubscription);
            return;
        }
        grouped.set(windowStartIso, [nextSubscription]);
    });
    return Array.from(grouped.entries()).map(([windowStartIso, items]) => ({
        windowStartIso,
        subscriptions: items,
    }));
};
const deliverWeeklyPublicDigestSubscription = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const jobs = params.groupedJobs[params.subscription.category];
    if (jobs.length === 0)
        return null;
    const manageUrl = params.subscription.unsubscribeToken
        ? `${APP_BASE_URL}/api/jobs/alerts/unsubscribe?token=${encodeURIComponent(params.subscription.unsubscribeToken)}`
        : `${APP_BASE_URL}/jobs`;
    const delivery = yield (0, jobAlertEmailService_1.sendJobAlertDigestEmail)(params.subscription.email, {
        recipientName: 'there',
        headline: params.subscription.category === 'all'
            ? 'Your weekly Aura jobs digest'
            : `Your weekly ${params.subscription.category} jobs digest`,
        subheadline: 'Ten fresh roles worth checking this week.',
        jobs,
        ctaUrl: `${APP_BASE_URL}/jobs`,
        ctaLabel: 'Browse all jobs',
        manageUrl,
    });
    if (!delivery.delivered)
        return null;
    return params.subscription;
});
const markWeeklyDigestSubscriptionsSent = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.subscriptions.length === 0)
        return;
    yield params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).bulkWrite(params.subscriptions.map((subscription) => ({
        updateOne: {
            filter: buildWeeklyDigestUpdateFilter(subscription),
            update: {
                $set: {
                    lastDigestSentAt: params.nowIso,
                    updatedAt: params.nowIso,
                },
            },
        },
    })), { ordered: false });
});
const markWeeklyDigestSubscriptionsSentWithRetry = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.subscriptions.length === 0)
        return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            yield markWeeklyDigestSubscriptionsSent(params);
            return;
        }
        catch (error) {
            if (attempt === 1) {
                throw error;
            }
            console.error('Retrying weekly public digest subscription update after write failure:', error);
        }
    }
});
const deliverWeeklyPublicDigestGroup = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const groupedJobs = yield (0, jobAlertDigestJobsService_1.buildPublicDigestJobsForWindow)({
        db: params.db,
        windowStartIso: params.group.windowStartIso,
    });
    const deliveredSubscriptions = (yield (0, recurringBatchUtils_1.runSettledBatches)({
        items: params.group.subscriptions,
        batchSize: JOB_ALERT_PUBLIC_DELIVERY_BATCH_SIZE,
        worker: (subscription) => deliverWeeklyPublicDigestSubscription({
            subscription,
            groupedJobs,
        }),
        onRejected: (reason) => {
            console.error('Public job digest dispatch error:', reason);
        },
    })).filter((subscription) => Boolean(subscription));
    yield markWeeklyDigestSubscriptionsSentWithRetry({
        db: params.db,
        subscriptions: deliveredSubscriptions,
        nowIso: params.nowIso,
    });
});
const sendWeeklyPublicJobAlertDigests = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const subscriptions = yield listWeeklyPublicDigestSubscriptions(db);
    if (subscriptions.length === 0)
        return;
    const groupedSubscriptions = groupEligiblePublicDigestSubscriptions(subscriptions);
    const nowIso = new Date().toISOString();
    for (const group of groupedSubscriptions) {
        yield deliverWeeklyPublicDigestGroup({
            db,
            group,
            nowIso,
        });
    }
});
exports.sendWeeklyPublicJobAlertDigests = sendWeeklyPublicJobAlertDigests;
