import { sendReverseJobMatchDigestEmail } from './emailService';
import { ensureReverseMatchIndexes } from './reverseJobMatchService';
import { resolveRecommendationMatchTier } from './jobRecommendationService';
import { readString } from '../utils/inputSanitizers';

const USERS_COLLECTION = 'users';
const REVERSE_MATCH_ALERTS_COLLECTION = 'job_reverse_match_alerts';

const REVERSE_MATCH_EMAIL_WINDOW_HOURS = Number.isFinite(Number(process.env.REVERSE_MATCH_EMAIL_WINDOW_HOURS))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_EMAIL_WINDOW_HOURS)))
  : 24;
const REVERSE_MATCH_EMAIL_MAX_USERS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_EMAIL_MAX_USERS_PER_RUN))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_EMAIL_MAX_USERS_PER_RUN)))
  : 200;
const REVERSE_MATCH_EMAIL_MAX_ALERTS_SCAN = Number.isFinite(Number(process.env.REVERSE_MATCH_EMAIL_MAX_ALERTS_SCAN))
  ? Math.max(100, Math.round(Number(process.env.REVERSE_MATCH_EMAIL_MAX_ALERTS_SCAN)))
  : 4000;
const REVERSE_MATCH_DIGEST_MIN_INTERVAL_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_DIGEST_MIN_INTERVAL_HOURS))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_DIGEST_MIN_INTERVAL_HOURS))) * 60 * 60 * 1000
  : 20 * 60 * 60 * 1000;
const REVERSE_MATCH_DIGEST_USER_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_DIGEST_USER_BATCH_SIZE))
  ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_DIGEST_USER_BATCH_SIZE)))
  : 16;
const REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE))
  ? Math.max(50, Math.round(Number(process.env.REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE)))
  : 500;

const APP_BASE_URL = (
  readString(process.env.FRONTEND_URL, 400)
  || readString(process.env.VITE_FRONTEND_URL, 400)
  || 'https://aura.social'
).replace(/\/+$/, '');

type DigestDispatchOutcome = {
  userId: string;
  alertIds: string[];
  sentAtIso: string;
  skippedReason?: string;
  updateUserDigestAt: boolean;
};

const normalizeHandle = (value: unknown): string => {
  const raw = readString(value, 120).toLowerCase();
  if (!raw) return '';
  return raw.startsWith('@') ? raw : `@${raw}`;
};

const buildJobUrl = (job: any): string => {
  const slug = readString(job?.jobSlug, 220) || readString(job?.slug, 220);
  const jobId = readString(job?.jobId, 140) || readString(job?.id, 140);
  if (slug) return `${APP_BASE_URL}/jobs/${encodeURIComponent(slug)}`;
  if (jobId) return `${APP_BASE_URL}/jobs/${encodeURIComponent(jobId)}`;
  return `${APP_BASE_URL}/jobs`;
};

const dedupeAlertsByJob = (alerts: any[]): any[] => {
  const seen = new Set<string>();
  const next: any[] = [];
  for (const alert of alerts) {
    const jobId = readString((alert as any)?.jobId, 120);
    if (!jobId || seen.has(jobId)) continue;
    seen.add(jobId);
    next.push(alert);
  }
  return next;
};

const resolveAlertIds = (alerts: any[]): string[] =>
  alerts
    .map((alert) => readString((alert as any)?.id, 160))
    .filter((id) => id.length > 0);

const runBulkWriteInChunks = async (
  collection: any,
  operations: any[],
  chunkSize: number,
): Promise<void> => {
  if (operations.length === 0) return;
  for (let index = 0; index < operations.length; index += chunkSize) {
    const batch = operations.slice(index, index + chunkSize);
    await collection.bulkWrite(batch, { ordered: false });
  }
};

const buildDigestOutcomeForUser = async (params: {
  userId: string;
  user: any;
  alertsByUser: Map<string, any[]>;
  nowMs: number;
}): Promise<DigestDispatchOutcome | null> => {
  const { userId, user, alertsByUser, nowMs } = params;
  const lastDigestAtRaw = readString((user as any)?.lastReverseJobDigestAt, 80);
  const lastDigestAtMs = lastDigestAtRaw ? new Date(lastDigestAtRaw).getTime() : 0;
  if (Number.isFinite(lastDigestAtMs) && (nowMs - lastDigestAtMs) < REVERSE_MATCH_DIGEST_MIN_INTERVAL_MS) {
    return null;
  }

  const userAlerts = dedupeAlertsByJob((alertsByUser.get(userId) || []).sort((left, right) => {
    const rightScore = Number((right as any)?.score || 0);
    const leftScore = Number((left as any)?.score || 0);
    return rightScore - leftScore;
  })).slice(0, 10);
  if (userAlerts.length === 0) return null;

  const alertIds = resolveAlertIds(userAlerts);
  if (alertIds.length === 0) return null;

  const sentAtIso = new Date(nowMs).toISOString();
  const email = readString((user as any)?.email, 220).toLowerCase();
  if (!email) {
    return {
      userId,
      alertIds,
      sentAtIso,
      skippedReason: 'missing_email',
      updateUserDigestAt: true,
    };
  }

  const recipientName =
    readString((user as any)?.firstName, 120)
    || readString((user as any)?.name, 160)
    || 'there';
  const handle = normalizeHandle((user as any)?.handle);
  const shareUrl = handle ? `${APP_BASE_URL}/jobs/${encodeURIComponent(handle)}` : '';
  const jobsPayload = userAlerts.map((alert: any) => {
    const score = Math.max(0, Math.round(Number((alert as any)?.score || 0)));
    return {
      title: readString((alert as any)?.title, 140) || 'Job opportunity',
      companyName: readString((alert as any)?.companyName, 140) || 'Hiring Team',
      locationText: readString((alert as any)?.locationText, 160),
      score,
      url: buildJobUrl(alert),
      matchTier: resolveRecommendationMatchTier(score),
    };
  });

  try {
    await sendReverseJobMatchDigestEmail(email, {
      recipientName,
      jobs: jobsPayload,
      shareUrl,
    });
    return {
      userId,
      alertIds,
      sentAtIso,
      updateUserDigestAt: true,
    };
  } catch (error) {
    console.error('Reverse match digest email dispatch error:', error);
    return null;
  }
};

export const sendDailyReverseJobMatchDigests = async (db: any): Promise<void> => {
  if (!db) return;
  try {
    await ensureReverseMatchIndexes(db);
  } catch (error) {
    console.error('Reverse match digest index ensure error:', error);
    return;
  }

  const windowSinceIso = new Date(
    Date.now() - (REVERSE_MATCH_EMAIL_WINDOW_HOURS * 60 * 60 * 1000),
  ).toISOString();
  const alerts = await db.collection(REVERSE_MATCH_ALERTS_COLLECTION)
    .find({
      createdAt: { $gte: windowSinceIso },
      emailDigestSentAt: { $exists: false },
    })
    .sort({ score: -1, createdAt: -1 })
    .limit(REVERSE_MATCH_EMAIL_MAX_ALERTS_SCAN)
    .toArray();
  if (alerts.length === 0) return;

  const alertsByUser = new Map<string, any[]>();
  for (const alert of alerts) {
    const userId = readString((alert as any)?.userId, 120);
    if (!userId) continue;
    const bucket = alertsByUser.get(userId) || [];
    bucket.push(alert);
    alertsByUser.set(userId, bucket);
  }
  if (alertsByUser.size === 0) return;

  const userIds = Array.from(alertsByUser.keys()).slice(0, REVERSE_MATCH_EMAIL_MAX_USERS_PER_RUN);
  const users = await db.collection(USERS_COLLECTION).find(
    { id: { $in: userIds } },
    {
      projection: {
        id: 1,
        email: 1,
        handle: 1,
        firstName: 1,
        name: 1,
        lastReverseJobDigestAt: 1,
      },
    },
  ).toArray();
  const usersById = new Map<string, any>(users.map((user: any) => [String(user.id), user]));
  const nowMs = Date.now();
  const outcomes: DigestDispatchOutcome[] = [];

  for (let start = 0; start < userIds.length; start += REVERSE_MATCH_DIGEST_USER_BATCH_SIZE) {
    const userBatch = userIds.slice(start, start + REVERSE_MATCH_DIGEST_USER_BATCH_SIZE);
    const settled = await Promise.allSettled(
      userBatch.map((userId) => {
        const user = usersById.get(userId);
        if (!user) return Promise.resolve(null);
        return buildDigestOutcomeForUser({
          userId,
          user,
          alertsByUser,
          nowMs,
        });
      }),
    );

    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      if (!result.value) continue;
      outcomes.push(result.value);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  if (outcomes.length === 0) return;

  const alertBulkOps: any[] = [];
  const userBulkOps: any[] = [];
  for (const outcome of outcomes) {
    const alertUpdate = outcome.skippedReason
      ? {
          $set: {
            emailDigestSentAt: outcome.sentAtIso,
            emailDigestSkippedReason: outcome.skippedReason,
          },
        }
      : {
          $set: {
            emailDigestSentAt: outcome.sentAtIso,
          },
          $unset: {
            emailDigestSkippedReason: '',
          },
        };

    alertBulkOps.push({
      updateMany: {
        filter: { id: { $in: outcome.alertIds } },
        update: alertUpdate,
      },
    });

    if (outcome.updateUserDigestAt) {
      userBulkOps.push({
        updateOne: {
          filter: { id: outcome.userId },
          update: { $set: { lastReverseJobDigestAt: outcome.sentAtIso } },
        },
      });
    }
  }

  await runBulkWriteInChunks(
    db.collection(REVERSE_MATCH_ALERTS_COLLECTION),
    alertBulkOps,
    REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE,
  );
  await runBulkWriteInChunks(
    db.collection(USERS_COLLECTION),
    userBulkOps,
    REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE,
  );
};
