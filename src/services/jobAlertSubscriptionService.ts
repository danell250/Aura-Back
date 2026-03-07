import crypto from 'crypto';
import { readString } from '../utils/inputSanitizers';
import { normalizeJobAlertCategory, type JobAlertCategory } from './jobAlertCategoryService';

const JOB_ALERT_SUBSCRIPTIONS_COLLECTION = 'job_alert_subscriptions';

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const buildSubscriptionId = (): string =>
  `jobalert-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

const buildUnsubscribeToken = (): string =>
  crypto.randomBytes(24).toString('hex');

const normalizeEmail = (value: unknown): string =>
  readString(value, 220).trim().toLowerCase();

export const isValidJobAlertEmail = (value: unknown): boolean =>
  SIMPLE_EMAIL_REGEX.test(normalizeEmail(value));

export const subscribeToPublicJobAlerts = async (params: {
  db: any;
  email: string;
  category: unknown;
}): Promise<{
  status: 'created' | 'reactivated' | 'updated';
  created: boolean;
  reactivated: boolean;
  email: string;
  category: JobAlertCategory;
  unsubscribeToken: string;
}> => {
  const email = normalizeEmail(params.email);
  const category = normalizeJobAlertCategory(params.category);
  const nowIso = new Date().toISOString();
  const unsubscribeToken = buildUnsubscribeToken();
  const existing = await params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).findOne(
    { email },
    {
      projection: {
        id: 1,
        email: 1,
        category: 1,
        isActive: 1,
      },
    },
  );
  const updateResult = await params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).updateOne(
    { email },
    {
      $set: {
        category,
        cadence: 'weekly',
        isActive: true,
        updatedAt: nowIso,
        unsubscribeToken,
      },
      $setOnInsert: {
        id: buildSubscriptionId(),
        type: 'public_capture',
        createdAt: nowIso,
        lastDigestSentAt: null,
        welcomeEmailSentAt: null,
      },
    },
    {
      upsert: true,
    },
  );
  const created = !existing && Number(updateResult.upsertedCount || 0) > 0;
  const reactivated = existing?.isActive === false && Number(updateResult.matchedCount || 0) > 0;
  const status: 'created' | 'reactivated' | 'updated' = created
    ? 'created'
    : reactivated
      ? 'reactivated'
      : 'updated';

  return {
    status,
    created,
    reactivated,
    email,
    category,
    unsubscribeToken,
  };
};

export const markPublicJobAlertWelcomeEmailSent = async (params: {
  db: any;
  email: string;
  sentAtIso: string;
}): Promise<void> => {
  const email = normalizeEmail(params.email);
  if (!email) return;

  await params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).updateOne(
    { email },
    {
      $set: {
        welcomeEmailSentAt: params.sentAtIso,
        updatedAt: params.sentAtIso,
      },
    },
  );
};

export const unsubscribePublicJobAlertsByToken = async (params: {
  db: any;
  token: string;
}): Promise<boolean> => {
  const token = readString(params.token, 240);
  if (!token) return false;
  const nowIso = new Date().toISOString();

  const result = await params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).updateOne(
    {
      unsubscribeToken: token,
      isActive: true,
    },
    {
      $set: {
        isActive: false,
        updatedAt: nowIso,
        unsubscribedAt: nowIso,
        unsubscribeToken: buildUnsubscribeToken(),
        unsubscribeTokenRotatedAt: nowIso,
      },
    },
  );

  return Number(result.matchedCount || 0) > 0;
};
