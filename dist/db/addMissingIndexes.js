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
function runIndexMigration(db) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[IndexMigration] Starting...');
        yield migrateAdSubscriptionsIndexes(db);
        yield migrateAdAnalyticsDailyIndexes(db);
        yield migrateAdEventDedupeIndexes(db);
        yield migrateAdAnalyticsIndexes(db);
        yield migrateAdsIndexes(db);
        console.log('[IndexMigration] Done');
    });
}
