import crypto from 'crypto';
import { BADGE_CATALOG, type BadgeDefinition, type BadgeKey } from '../config/badgeCatalog';

const USER_BADGES_COLLECTION = 'user_badges';

export type UserBadgeResponse = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  sortOrder: number;
  awardedAt: string | null;
};

const INTERVIEW_STATUSES = new Set(['in_review', 'shortlisted']);

const readString = (value: unknown, maxLength = 200): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

const isBadgeKey = (value: string): value is BadgeKey =>
  Object.prototype.hasOwnProperty.call(BADGE_CATALOG, value);

const readBadgeAwardedAt = (userBadge: any): string | null =>
  readString(userBadge?.awardedAt, 80) || readString(userBadge?.createdAt, 80) || null;

const readBadgeSortOrder = (definition: any): number =>
  Number.isFinite(definition?.sortOrder) ? Number(definition.sortOrder) : 999;

const readBadgeIcon = (definition: any): string =>
  readString(definition?.icon, 8) || '🏅';

const readBadgeCategory = (definition: any): string =>
  readString(definition?.category, 40) || 'jobs';

const readBadgeName = (definition: any, key: string): string =>
  readString(definition?.name, 120) || key;

const readBadgeDescription = (definition: any): string =>
  readString(definition?.description, 300) || '';

const getBadgeDefinitionByKey = (key: string): BadgeDefinition | null =>
  isBadgeKey(key) ? BADGE_CATALOG[key] : null;

const normalizeBadgeResponse = (userBadge: any, definition: any): UserBadgeResponse => {
  const key = readString(userBadge?.badgeKey, 80);
  return {
    id: readString(userBadge?.id, 160) || `user-badge-${key}`,
    key,
    name: readBadgeName(definition, key),
    description: readBadgeDescription(definition),
    icon: readBadgeIcon(definition),
    category: readBadgeCategory(definition),
    sortOrder: readBadgeSortOrder(definition),
    awardedAt: readBadgeAwardedAt(userBadge),
  };
};

const mapUserBadgeRowsToResponse = (rows: any[]): UserBadgeResponse[] =>
  rows
    .map((row: any) => {
      const key = readString(row?.badgeKey, 80);
      const definition = getBadgeDefinitionByKey(key);
      if (!definition) return null;
      return normalizeBadgeResponse(row, definition);
    })
    .filter((row: UserBadgeResponse | null): row is UserBadgeResponse => Boolean(row));

export const awardBadgeToUser = async (params: {
  db: any;
  userId: string;
  badgeKey: BadgeKey;
  source: string;
  metadata?: Record<string, unknown> | null;
}): Promise<{ awarded: boolean; badgeKey: BadgeKey }> => {
  const userId = readString(params.userId, 120);
  if (!userId) return { awarded: false, badgeKey: params.badgeKey };

  const nowIso = new Date().toISOString();
  const metadata =
    params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)
      ? params.metadata
      : null;

  const result = await params.db.collection(USER_BADGES_COLLECTION).updateOne(
    { userId, badgeKey: params.badgeKey },
    {
      $setOnInsert: {
        id: `userbadge-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        userId,
        badgeKey: params.badgeKey,
        source: readString(params.source, 80) || 'system',
        metadata,
        createdAt: nowIso,
        awardedAt: nowIso,
        awardedAtDate: new Date(nowIso),
      },
      $set: {
        updatedAt: nowIso,
      },
    },
    { upsert: true },
  );

  return {
    awarded: Boolean((result as any)?.matchedCount || (result as any)?.upsertedCount),
    badgeKey: params.badgeKey,
  };
};

export const awardApplicationMilestoneBadges = async (params: {
  db: any;
  userId: string;
  applicationId?: string;
  applicationCount?: number;
}): Promise<void> => {
  const userId = readString(params.userId, 120);
  if (!userId) return;

  const applicationCountCandidate = Number(params.applicationCount);
  if (!Number.isFinite(applicationCountCandidate) || applicationCountCandidate < 0) {
    return;
  }
  const applicationCount = applicationCountCandidate;
  const milestoneBadgeKey: BadgeKey | null = applicationCount === 1
    ? 'first_application'
    : applicationCount === 10
      ? 'ten_applications'
      : null;
  if (!milestoneBadgeKey) return;

  await awardBadgeToUser({
    db: params.db,
    userId,
    badgeKey: milestoneBadgeKey,
    source: 'job_application_submitted',
    metadata: {
      applicationId: readString(params.applicationId, 160) || null,
      applicationsSubmitted: applicationCount,
    },
  });
};

export const awardStatusDrivenBadge = async (params: {
  db: any;
  userId: string;
  applicationId: string;
  nextStatus: string;
}): Promise<void> => {
  const userId = readString(params.userId, 120);
  const nextStatus = readString(params.nextStatus, 40).toLowerCase();
  const applicationId = readString(params.applicationId, 160);
  if (!userId || !nextStatus || !applicationId) return;

  if (INTERVIEW_STATUSES.has(nextStatus)) {
    await awardBadgeToUser({
      db: params.db,
      userId,
      badgeKey: 'interview_stage',
      source: 'job_application_status_update',
      metadata: {
        applicationId,
        status: nextStatus,
      },
    });
  }

  if (nextStatus === 'hired') {
    await awardBadgeToUser({
      db: params.db,
      userId,
      badgeKey: 'hired',
      source: 'job_application_status_update',
      metadata: {
        applicationId,
        status: nextStatus,
      },
    });
  }
};

export const listUserBadges = async (params: {
  db: any;
  userId: string;
  limit?: number;
}): Promise<UserBadgeResponse[]> => {
  const userId = readString(params.userId, 120);
  if (!userId) return [];

  const limit = Number.isFinite(params.limit) ? Math.min(100, Math.max(1, Number(params.limit))) : 40;
  const rows = await params.db.collection(USER_BADGES_COLLECTION)
    .find(
      { userId },
      {
        projection: {
          id: 1,
          userId: 1,
          badgeKey: 1,
          awardedAt: 1,
          createdAt: 1,
        },
      },
    )
    .sort({ awardedAtDate: -1, awardedAt: -1, createdAt: -1 })
    .limit(limit)
    .toArray();

  if (!rows.length) return [];
  return mapUserBadgeRowsToResponse(rows);
};
