import { Db, CreateIndexesOptions, Collection } from 'mongodb';
import { BADGE_CATALOG } from '../config/badgeCatalog';

type IndexKey = Record<string, 1 | -1>;

interface ExistingIndexMeta {
  name: string;
  keyNorm: string;
  partialNorm: string;
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds?: number;
}

const normalizeKey = (key: any): string =>
  JSON.stringify(
    Object.entries(key || {}).sort(([a], [b]) => a.localeCompare(b))
  );

const toExistingIndexMeta = (indexes: any[]): ExistingIndexMeta[] =>
  indexes.map((index) => ({
    name: String(index.name),
    keyNorm: normalizeKey(index.key),
    partialNorm: normalizeKey(index.partialFilterExpression || {}),
    unique: Boolean(index.unique),
    sparse: Boolean(index.sparse),
    expireAfterSeconds:
      typeof index.expireAfterSeconds === 'number' ? index.expireAfterSeconds : undefined
  }));

const ensureIndex = async (
  collection: Collection,
  key: IndexKey,
  options: CreateIndexesOptions
) => {
  const existing = toExistingIndexMeta(await collection.indexes());
  const targetKeyNorm = normalizeKey(key);
  const targetPartialNorm = normalizeKey(options.partialFilterExpression || {});
  const targetUnique = typeof options.unique === 'boolean' ? options.unique : undefined;
  const targetSparse = typeof options.sparse === 'boolean' ? options.sparse : undefined;
  const targetTtl =
    typeof options.expireAfterSeconds === 'number' ? options.expireAfterSeconds : undefined;

  if (options.name && existing.some((index) => index.name === options.name)) {
    return;
  }

  const equivalent = existing.find((index) => {
    if (index.keyNorm !== targetKeyNorm) return false;
    if (targetUnique !== undefined && index.unique !== targetUnique) return false;
    if (targetSparse !== undefined && index.sparse !== targetSparse) return false;
    if (targetTtl !== undefined && index.expireAfterSeconds !== targetTtl) return false;
    if (index.partialNorm !== targetPartialNorm) {
      return false;
    }
    return true;
  });

  if (equivalent && !options.name) return;
  if (equivalent && options.name && equivalent.name !== options.name) {
    await collection.dropIndex(equivalent.name);
    await collection.createIndex(key, options);
    return;
  }

  const sameKey = existing.find((index) => index.keyNorm === targetKeyNorm);
  if (sameKey && sameKey.name !== '_id_') {
    await collection.dropIndex(sameKey.name);
  }

  await collection.createIndex(key, options);
};

const migrateAdSubscriptionsIndexes = async (db: Db) => {
  const collection = db.collection('adSubscriptions');
  await ensureIndex(
    collection,
    { ownerId: 1, ownerType: 1, status: 1, endDate: 1 },
    { name: 'idx_adSub_owner_status_end', background: true }
  );
  await ensureIndex(
    collection,
    { userId: 1, ownerType: 1, status: 1, endDate: 1 },
    { name: 'idx_adSub_userId_status_end', background: true }
  );
  await ensureIndex(
    collection,
    { paypalSubscriptionId: 1 },
    {
      name: 'idx_adSub_ppSubId',
      unique: true,
      sparse: true,
      background: true,
      partialFilterExpression: { paypalSubscriptionId: { $type: 'string' } }
    }
  );
  await ensureIndex(
    collection,
    { paypalOrderId: 1 },
    {
      name: 'idx_adSub_ppOrderId',
      unique: true,
      sparse: true,
      background: true,
      partialFilterExpression: { paypalOrderId: { $type: 'string' } }
    }
  );
  await ensureIndex(
    collection,
    { paymentReferenceKey: 1 },
    {
      name: 'idx_adSub_payRefKey',
      unique: true,
      sparse: true,
      background: true,
      partialFilterExpression: { paymentReferenceKey: { $type: 'string' } }
    }
  );
};

const migrateAdAnalyticsDailyIndexes = async (db: Db) => {
  const collection = db.collection('adAnalyticsDaily');
  const existing = await collection.indexes();
  const legacy = existing.find(
    (index) =>
      normalizeKey(index.key) === normalizeKey({ adId: 1, dateKey: 1 }) &&
      Boolean(index.unique)
  );
  if (legacy?.name) {
    await collection.dropIndex(legacy.name);
    console.log(`[IndexMigration] Dropped legacy index: ${legacy.name}`);
  }

  await ensureIndex(
    collection,
    { adId: 1, ownerId: 1, ownerType: 1, dateKey: 1 },
    { name: 'idx_adDaily_adId_owner_date', unique: true, background: true }
  );
  await ensureIndex(
    collection,
    { ownerId: 1, ownerType: 1, dateKey: 1 },
    { name: 'idx_adDaily_owner_date', background: true }
  );
};

const migrateAdEventDedupeIndexes = async (db: Db) => {
  const collection = db.collection('adEventDedupes');
  await ensureIndex(
    collection,
    { key: 1 },
    { name: 'idx_adDedupe_key', unique: true, sparse: true, background: true }
  );
  await ensureIndex(
    collection,
    { adId: 1, eventType: 1, fingerprint: 1, dateKey: 1 },
    { name: 'idx_adDedupe_compound', unique: true, background: true }
  );
  await ensureIndex(
    collection,
    { expiresAt: 1 },
    { name: 'idx_adDedupe_ttl', expireAfterSeconds: 0, background: true }
  );
};

const migrateAdAnalyticsIndexes = async (db: Db) => {
  const collection = db.collection('adAnalytics');
  await ensureIndex(
    collection,
    { adId: 1 },
    { name: 'idx_adAnalytics_adId', unique: true, background: true }
  );
  await ensureIndex(
    collection,
    { ownerId: 1, ownerType: 1 },
    { name: 'idx_adAnalytics_owner', background: true }
  );
};

const migrateAdsIndexes = async (db: Db) => {
  const collection = db.collection('ads');
  await ensureIndex(
    collection,
    { ownerId: 1, ownerType: 1, status: 1 },
    { name: 'idx_ads_owner_status', background: true }
  );
  await ensureIndex(
    collection,
    { status: 1, placement: 1, timestamp: -1 },
    { name: 'idx_ads_status_placement_ts', background: true }
  );
};

const migrateApplicationNotesIndexes = async (db: Db) => {
  const collection = db.collection('application_notes');
  await ensureIndex(
    collection,
    { id: 1 },
    { name: 'idx_app_notes_id', unique: true, background: true }
  );
  await ensureIndex(
    collection,
    { applicationId: 1, createdAt: 1 },
    { name: 'idx_app_notes_application_created', background: true }
  );
  await ensureIndex(
    collection,
    { jobId: 1, createdAt: 1 },
    { name: 'idx_app_notes_job_created', background: true }
  );
  await ensureIndex(
    collection,
    { companyId: 1, createdAt: -1 },
    { name: 'idx_app_notes_company_created', background: true }
  );
  await ensureIndex(
    collection,
    { authorId: 1, createdAt: -1 },
    { name: 'idx_app_notes_author_created', background: true }
  );
};

const migrateLearningResourcesCacheIndexes = async (db: Db) => {
  const collection = db.collection('learning_resources_cache');
  await ensureIndex(
    collection,
    { cacheKey: 1 },
    { name: 'idx_learning_resources_cache_key', unique: true, background: true }
  );
  await ensureIndex(
    collection,
    { expiresAt: 1 },
    { name: 'idx_learning_resources_cache_ttl', expireAfterSeconds: 0, background: true }
  );
};

const migrateJobApplicationsIndexes = async (db: Db) => {
  const collection = db.collection('job_applications');
  await ensureIndex(
    collection,
    { companyId: 1, status: 1 },
    { name: 'idx_job_apps_company_status', background: true }
  );
  await ensureIndex(
    collection,
    { companyId: 1, status: 1, jobId: 1 },
    { name: 'idx_job_apps_company_status_job', background: true }
  );
  await ensureIndex(
    collection,
    { companyId: 1, status: 1, reviewedAtDate: 1, createdAtDate: 1 },
    { name: 'idx_job_apps_company_status_review_created', background: true }
  );
  await ensureIndex(
    collection,
    { applicantUserId: 1, createdAt: -1 },
    { name: 'idx_job_apps_applicant_created', background: true }
  );
};

const migrateUserBadgesIndexes = async (db: Db) => {
  const badgesCollection = db.collection('badges');
  await ensureIndex(
    badgesCollection,
    { key: 1 },
    { name: 'idx_badges_key', unique: true, background: true }
  );
  await ensureIndex(
    badgesCollection,
    { category: 1, sortOrder: 1 },
    { name: 'idx_badges_category_sort', background: true }
  );

  const userBadgesCollection = db.collection('user_badges');
  await ensureIndex(
    userBadgesCollection,
    { id: 1 },
    { name: 'idx_user_badges_id', unique: true, background: true }
  );
  await ensureIndex(
    userBadgesCollection,
    { userId: 1, badgeKey: 1 },
    { name: 'idx_user_badges_user_badge', unique: true, background: true }
  );
  await ensureIndex(
    userBadgesCollection,
    { userId: 1, awardedAtDate: -1, awardedAt: -1, createdAt: -1 },
    { name: 'idx_user_badges_user_awarded_v2', background: true }
  );
};

const seedBadgeCatalog = async (db: Db) => {
  const nowIso = new Date().toISOString();
  const operations = Object.values(BADGE_CATALOG).map((definition) => ({
    updateOne: {
      filter: { key: definition.key },
      update: {
        $set: {
          key: definition.key,
          name: definition.name,
          description: definition.description,
          icon: definition.icon,
          sortOrder: definition.sortOrder,
          category: definition.category,
          updatedAt: nowIso,
        },
        $setOnInsert: {
          id: `badge-${definition.key}`,
          createdAt: nowIso,
        },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) {
    await db.collection('badges').bulkWrite(operations, { ordered: false });
  }
};

export async function runIndexMigration(db: Db): Promise<void> {
  console.log('[IndexMigration] Starting...');
  await migrateAdSubscriptionsIndexes(db);
  await migrateAdAnalyticsDailyIndexes(db);
  await migrateAdEventDedupeIndexes(db);
  await migrateAdAnalyticsIndexes(db);
  await migrateAdsIndexes(db);
  await migrateApplicationNotesIndexes(db);
  await migrateLearningResourcesCacheIndexes(db);
  await migrateJobApplicationsIndexes(db);
  await migrateUserBadgesIndexes(db);
  await seedBadgeCatalog(db);
  console.log('[IndexMigration] Done');
}
