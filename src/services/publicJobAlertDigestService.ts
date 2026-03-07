import { type JobAlertCategory } from './jobAlertCategoryService';
import {
  buildPublicDigestJobsForWindow,
  resolvePublicDigestCategory,
  type PublicDigestJobGroups,
} from './jobAlertDigestJobsService';
import { sendJobAlertDigestEmail } from './jobAlertEmailService';
import { readString } from '../utils/inputSanitizers';
import { getPublicWebUrl } from '../utils/publicWebUrl';
import { runSettledBatches } from '../utils/recurringBatchUtils';

const JOB_ALERT_SUBSCRIPTIONS_COLLECTION = 'job_alert_subscriptions';
const APP_BASE_URL = getPublicWebUrl();
const JOB_ALERT_PUBLIC_MAX_SUBSCRIPTIONS_PER_RUN = Number.isFinite(Number(process.env.JOB_ALERT_PUBLIC_MAX_SUBSCRIPTIONS_PER_RUN))
  ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_PUBLIC_MAX_SUBSCRIPTIONS_PER_RUN)))
  : 400;
const JOB_ALERT_PUBLIC_DELIVERY_BATCH_SIZE = Number.isFinite(Number(process.env.JOB_ALERT_PUBLIC_DELIVERY_BATCH_SIZE))
  ? Math.max(1, Math.round(Number(process.env.JOB_ALERT_PUBLIC_DELIVERY_BATCH_SIZE)))
  : 12;
const JOB_ALERT_WEEKLY_SEND_DAY_NUMBER = 1;
const JOB_ALERT_DIGEST_TIMEZONE = (
  readString(process.env.JOB_ALERT_DIGEST_TIMEZONE, 80)
  || Intl.DateTimeFormat().resolvedOptions().timeZone
  || 'UTC'
);

type PublicDigestSubscription = {
  id: string;
  email: string;
  category: JobAlertCategory;
  windowStartIso: string;
  lastDigestSentAt: string;
  unsubscribeToken: string;
};

const getIsoHoursAgo = (hours: number): string =>
  new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();

const buildDigestDateKey = (value: Date | string | number): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: JOB_ALERT_DIGEST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

const getTimeZoneWeekday = (value: Date | string | number): number => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JOB_ALERT_DIGEST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const year = Number(parts.find((part) => part.type === 'year')?.value || '0');
  const month = Number(parts.find((part) => part.type === 'month')?.value || '0');
  const day = Number(parts.find((part) => part.type === 'day')?.value || '0');
  return new Date(Date.UTC(year, Math.max(0, month - 1), day)).getUTCDay();
};

const normalizeWeeklyDigestWindowStartIso = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return getIsoHoursAgo(24 * 7);
  }
  return parsed.toISOString();
};

const buildWeeklyDigestEligibility = (lastDigestSentAtRaw: string): boolean => {
  const now = new Date();
  if (getTimeZoneWeekday(now) !== JOB_ALERT_WEEKLY_SEND_DAY_NUMBER) return false;

  if (!lastDigestSentAtRaw) return true;
  const lastSent = new Date(lastDigestSentAtRaw);
  if (Number.isNaN(lastSent.getTime())) return true;
  return buildDigestDateKey(lastSent) !== buildDigestDateKey(now);
};

const buildWeeklyDigestUpdateFilter = (subscription: PublicDigestSubscription): Record<string, unknown> => {
  return {
    id: subscription.id,
  };
};

const listWeeklyPublicDigestSubscriptions = async (db: any): Promise<any[]> =>
  db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION)
    .find(
      {
        isActive: true,
        cadence: 'weekly',
      },
      {
        projection: {
          id: 1,
          email: 1,
          category: 1,
          lastDigestSentAt: 1,
          unsubscribeToken: 1,
        },
      },
    )
    .limit(JOB_ALERT_PUBLIC_MAX_SUBSCRIPTIONS_PER_RUN)
    .toArray();

const groupEligiblePublicDigestSubscriptions = (subscriptions: any[]): Array<{
  windowStartIso: string;
  subscriptions: PublicDigestSubscription[];
}> => {
  const grouped = new Map<string, PublicDigestSubscription[]>();

  subscriptions.forEach((subscription) => {
    const email = readString(subscription?.email, 220).toLowerCase();
    if (!email) return;

    const lastDigestSentAt = readString(subscription?.lastDigestSentAt, 80);
    if (!buildWeeklyDigestEligibility(lastDigestSentAt)) return;

    const windowStartIso = normalizeWeeklyDigestWindowStartIso(lastDigestSentAt || getIsoHoursAgo(24 * 7));
    const nextSubscription: PublicDigestSubscription = {
      id: readString(subscription?.id, 120),
      email,
      category: resolvePublicDigestCategory(subscription?.category),
      windowStartIso,
      lastDigestSentAt,
      unsubscribeToken: readString(subscription?.unsubscribeToken, 180),
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

const deliverWeeklyPublicDigestSubscription = async (params: {
  subscription: PublicDigestSubscription;
  groupedJobs: PublicDigestJobGroups;
}): Promise<PublicDigestSubscription | null> => {
  const jobs = params.groupedJobs[params.subscription.category];
  if (jobs.length === 0) return null;

  const manageUrl = params.subscription.unsubscribeToken
    ? `${APP_BASE_URL}/api/jobs/alerts/unsubscribe?token=${encodeURIComponent(params.subscription.unsubscribeToken)}`
    : `${APP_BASE_URL}/jobs`;

  const delivery = await sendJobAlertDigestEmail(params.subscription.email, {
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

  if (!delivery.delivered) return null;
  return params.subscription;
};

const markWeeklyDigestSubscriptionsSent = async (params: {
  db: any;
  subscriptions: PublicDigestSubscription[];
  nowIso: string;
}): Promise<void> => {
  if (params.subscriptions.length === 0) return;

  await params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).bulkWrite(
    params.subscriptions.map((subscription) => ({
      updateOne: {
        filter: buildWeeklyDigestUpdateFilter(subscription),
        update: {
          $set: {
            lastDigestSentAt: params.nowIso,
            updatedAt: params.nowIso,
          },
        },
      },
    })),
    { ordered: false },
  );
};

const markWeeklyDigestSubscriptionsSentWithRetry = async (params: {
  db: any;
  subscriptions: PublicDigestSubscription[];
  nowIso: string;
}): Promise<void> => {
  if (params.subscriptions.length === 0) return;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await markWeeklyDigestSubscriptionsSent(params);
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      console.error('Retrying weekly public digest subscription update after write failure:', error);
    }
  }
};

const deliverWeeklyPublicDigestGroup = async (params: {
  db: any;
  group: {
    windowStartIso: string;
    subscriptions: PublicDigestSubscription[];
  };
  nowIso: string;
}): Promise<void> => {
  const groupedJobs = await buildPublicDigestJobsForWindow({
    db: params.db,
    windowStartIso: params.group.windowStartIso,
  });
  const deliveredSubscriptions = (await runSettledBatches({
    items: params.group.subscriptions,
    batchSize: JOB_ALERT_PUBLIC_DELIVERY_BATCH_SIZE,
    worker: (subscription) =>
      deliverWeeklyPublicDigestSubscription({
        subscription,
        groupedJobs,
      }),
    onRejected: (reason) => {
      console.error('Public job digest dispatch error:', reason);
    },
  })).filter((subscription): subscription is PublicDigestSubscription => Boolean(subscription));

  await markWeeklyDigestSubscriptionsSentWithRetry({
    db: params.db,
    subscriptions: deliveredSubscriptions,
    nowIso: params.nowIso,
  });
};

export const sendWeeklyPublicJobAlertDigests = async (db: any): Promise<void> => {
  const subscriptions = await listWeeklyPublicDigestSubscriptions(db);
  if (subscriptions.length === 0) return;

  const groupedSubscriptions = groupEligiblePublicDigestSubscriptions(subscriptions);
  const nowIso = new Date().toISOString();

  for (const group of groupedSubscriptions) {
    await deliverWeeklyPublicDigestGroup({
      db,
      group,
      nowIso,
    });
  }
};
