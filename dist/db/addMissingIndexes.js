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
exports.runIndexMigration = runIndexMigration;
const badgeCatalog_1 = require("../config/badgeCatalog");
const normalizeKey = (key) => JSON.stringify(Object.entries(key || {}).sort(([a], [b]) => a.localeCompare(b)));
const toExistingIndexMeta = (indexes) => indexes.map((index) => ({
    name: String(index.name),
    keyNorm: normalizeKey(index.key),
    partialNorm: normalizeKey(index.partialFilterExpression || {}),
    unique: Boolean(index.unique),
    sparse: Boolean(index.sparse),
    expireAfterSeconds: typeof index.expireAfterSeconds === 'number' ? index.expireAfterSeconds : undefined
}));
const ensureIndex = (collection, key, options) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = toExistingIndexMeta(yield collection.indexes());
    const targetKeyNorm = normalizeKey(key);
    const targetPartialNorm = normalizeKey(options.partialFilterExpression || {});
    const targetUnique = typeof options.unique === 'boolean' ? options.unique : undefined;
    const targetSparse = typeof options.sparse === 'boolean' ? options.sparse : undefined;
    const targetTtl = typeof options.expireAfterSeconds === 'number' ? options.expireAfterSeconds : undefined;
    if (options.name && existing.some((index) => index.name === options.name)) {
        return;
    }
    const equivalent = existing.find((index) => {
        if (index.keyNorm !== targetKeyNorm)
            return false;
        if (targetUnique !== undefined && index.unique !== targetUnique)
            return false;
        if (targetSparse !== undefined && index.sparse !== targetSparse)
            return false;
        if (targetTtl !== undefined && index.expireAfterSeconds !== targetTtl)
            return false;
        if (index.partialNorm !== targetPartialNorm) {
            return false;
        }
        return true;
    });
    if (equivalent && !options.name)
        return;
    if (equivalent && options.name && equivalent.name !== options.name) {
        yield collection.dropIndex(equivalent.name);
        yield collection.createIndex(key, options);
        return;
    }
    const sameKey = existing.find((index) => index.keyNorm === targetKeyNorm);
    if (sameKey && sameKey.name !== '_id_') {
        yield collection.dropIndex(sameKey.name);
    }
    yield collection.createIndex(key, options);
});
const migrateAdSubscriptionsIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('adSubscriptions');
    yield ensureIndex(collection, { ownerId: 1, ownerType: 1, status: 1, endDate: 1 }, { name: 'idx_adSub_owner_status_end', background: true });
    yield ensureIndex(collection, { userId: 1, ownerType: 1, status: 1, endDate: 1 }, { name: 'idx_adSub_userId_status_end', background: true });
    yield ensureIndex(collection, { paypalSubscriptionId: 1 }, {
        name: 'idx_adSub_ppSubId',
        unique: true,
        sparse: true,
        background: true,
        partialFilterExpression: { paypalSubscriptionId: { $type: 'string' } }
    });
    yield ensureIndex(collection, { paypalOrderId: 1 }, {
        name: 'idx_adSub_ppOrderId',
        unique: true,
        sparse: true,
        background: true,
        partialFilterExpression: { paypalOrderId: { $type: 'string' } }
    });
    yield ensureIndex(collection, { paymentReferenceKey: 1 }, {
        name: 'idx_adSub_payRefKey',
        unique: true,
        sparse: true,
        background: true,
        partialFilterExpression: { paymentReferenceKey: { $type: 'string' } }
    });
});
const migrateAdAnalyticsDailyIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('adAnalyticsDaily');
    const existing = yield collection.indexes();
    const legacy = existing.find((index) => normalizeKey(index.key) === normalizeKey({ adId: 1, dateKey: 1 }) &&
        Boolean(index.unique));
    if (legacy === null || legacy === void 0 ? void 0 : legacy.name) {
        yield collection.dropIndex(legacy.name);
        console.log(`[IndexMigration] Dropped legacy index: ${legacy.name}`);
    }
    yield ensureIndex(collection, { adId: 1, ownerId: 1, ownerType: 1, dateKey: 1 }, { name: 'idx_adDaily_adId_owner_date', unique: true, background: true });
    yield ensureIndex(collection, { ownerId: 1, ownerType: 1, dateKey: 1 }, { name: 'idx_adDaily_owner_date', background: true });
});
const migrateAdEventDedupeIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('adEventDedupes');
    yield ensureIndex(collection, { key: 1 }, { name: 'idx_adDedupe_key', unique: true, sparse: true, background: true });
    yield ensureIndex(collection, { adId: 1, eventType: 1, fingerprint: 1, dateKey: 1 }, { name: 'idx_adDedupe_compound', unique: true, background: true });
    yield ensureIndex(collection, { expiresAt: 1 }, { name: 'idx_adDedupe_ttl', expireAfterSeconds: 0, background: true });
});
const migrateAdAnalyticsIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('adAnalytics');
    yield ensureIndex(collection, { adId: 1 }, { name: 'idx_adAnalytics_adId', unique: true, background: true });
    yield ensureIndex(collection, { ownerId: 1, ownerType: 1 }, { name: 'idx_adAnalytics_owner', background: true });
});
const migrateAdsIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('ads');
    yield ensureIndex(collection, { ownerId: 1, ownerType: 1, status: 1 }, { name: 'idx_ads_owner_status', background: true });
    yield ensureIndex(collection, { status: 1, placement: 1, timestamp: -1 }, { name: 'idx_ads_status_placement_ts', background: true });
});
const migrateApplicationNotesIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('application_notes');
    yield ensureIndex(collection, { id: 1 }, { name: 'idx_app_notes_id', unique: true, background: true });
    yield ensureIndex(collection, { applicationId: 1, createdAt: 1 }, { name: 'idx_app_notes_application_created', background: true });
    yield ensureIndex(collection, { jobId: 1, createdAt: 1 }, { name: 'idx_app_notes_job_created', background: true });
    yield ensureIndex(collection, { companyId: 1, createdAt: -1 }, { name: 'idx_app_notes_company_created', background: true });
    yield ensureIndex(collection, { authorId: 1, createdAt: -1 }, { name: 'idx_app_notes_author_created', background: true });
});
const migrateLearningResourcesCacheIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('learning_resources_cache');
    yield ensureIndex(collection, { cacheKey: 1 }, { name: 'idx_learning_resources_cache_key', unique: true, background: true });
    yield ensureIndex(collection, { expiresAt: 1 }, { name: 'idx_learning_resources_cache_ttl', expireAfterSeconds: 0, background: true });
});
const migrateJobApplicationsIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('job_applications');
    yield ensureIndex(collection, { companyId: 1, status: 1 }, { name: 'idx_job_apps_company_status', background: true });
    yield ensureIndex(collection, { companyId: 1, status: 1, jobId: 1 }, { name: 'idx_job_apps_company_status_job', background: true });
    yield ensureIndex(collection, { companyId: 1, status: 1, reviewedAtDate: 1, createdAtDate: 1 }, { name: 'idx_job_apps_company_status_review_created', background: true });
    yield ensureIndex(collection, { applicantUserId: 1, createdAt: -1 }, { name: 'idx_job_apps_applicant_created', background: true });
    yield ensureIndex(collection, { applicantUserId: 1, jobId: 1 }, { name: 'idx_job_apps_applicant_job', background: true });
});
const migrateJobsIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection('jobs');
    yield ensureIndex(collection, { source: 1, originalId: 1 }, {
        name: 'idx_jobs_source_original_id',
        background: true,
        unique: true,
        partialFilterExpression: {
            source: { $type: 'string' },
            originalId: { $type: 'string' }
        }
    });
    yield ensureIndex(collection, { source: 1, originalUrl: 1 }, {
        name: 'idx_jobs_source_original_url',
        background: true,
        unique: true,
        partialFilterExpression: {
            source: { $type: 'string' },
            originalUrl: { $type: 'string' }
        }
    });
});
const migrateUserBadgesIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const badgesCollection = db.collection('badges');
    yield ensureIndex(badgesCollection, { key: 1 }, { name: 'idx_badges_key', unique: true, background: true });
    yield ensureIndex(badgesCollection, { category: 1, sortOrder: 1 }, { name: 'idx_badges_category_sort', background: true });
    const userBadgesCollection = db.collection('user_badges');
    yield ensureIndex(userBadgesCollection, { id: 1 }, { name: 'idx_user_badges_id', unique: true, background: true });
    yield ensureIndex(userBadgesCollection, { userId: 1, badgeKey: 1 }, { name: 'idx_user_badges_user_badge', unique: true, background: true });
    yield ensureIndex(userBadgesCollection, { userId: 1, awardedAtDate: -1, awardedAt: -1, createdAt: -1 }, { name: 'idx_user_badges_user_awarded_v2', background: true });
});
const seedBadgeCatalog = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const nowIso = new Date().toISOString();
    const operations = Object.values(badgeCatalog_1.BADGE_CATALOG).map((definition) => ({
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
        yield db.collection('badges').bulkWrite(operations, { ordered: false });
    }
});
function runIndexMigration(db) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[IndexMigration] Starting...');
        yield migrateAdSubscriptionsIndexes(db);
        yield migrateAdAnalyticsDailyIndexes(db);
        yield migrateAdEventDedupeIndexes(db);
        yield migrateAdAnalyticsIndexes(db);
        yield migrateAdsIndexes(db);
        yield migrateApplicationNotesIndexes(db);
        yield migrateLearningResourcesCacheIndexes(db);
        yield migrateJobApplicationsIndexes(db);
        yield migrateJobsIndexes(db);
        yield migrateUserBadgesIndexes(db);
        yield seedBadgeCatalog(db);
        console.log('[IndexMigration] Done');
    });
}
