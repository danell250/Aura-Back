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
exports.getAdAnalyticsDailyCollection = exports.initializeAdAnalyticsDailyCollection = void 0;
let adAnalyticsDailyCollection;
const initializeAdAnalyticsDailyCollection = (db) => __awaiter(void 0, void 0, void 0, function* () {
    adAnalyticsDailyCollection = db.collection('adAnalyticsDaily');
    // Remove legacy unique index that can collide across owners sharing the same adId/dateKey.
    const indexes = yield adAnalyticsDailyCollection.indexes();
    const legacyUnique = indexes.find((index) => { var _a, _b; return index.unique && ((_a = index.key) === null || _a === void 0 ? void 0 : _a.adId) === 1 && ((_b = index.key) === null || _b === void 0 ? void 0 : _b.dateKey) === 1; });
    if (legacyUnique === null || legacyUnique === void 0 ? void 0 : legacyUnique.name) {
        yield adAnalyticsDailyCollection.dropIndex(legacyUnique.name);
    }
    // Create indexes matching actual upsert/query filters.
    yield adAnalyticsDailyCollection.createIndex({ adId: 1, ownerId: 1, ownerType: 1, dateKey: 1 }, { unique: true, name: 'ad_analytics_daily_unique_owner_day' });
    yield adAnalyticsDailyCollection.createIndex({ ownerId: 1, ownerType: 1, dateKey: 1 }, { name: 'ad_analytics_daily_owner_date' });
});
exports.initializeAdAnalyticsDailyCollection = initializeAdAnalyticsDailyCollection;
const getAdAnalyticsDailyCollection = () => {
    if (!adAnalyticsDailyCollection) {
        throw new Error('AdAnalyticsDaily collection not initialized.');
    }
    return adAnalyticsDailyCollection;
};
exports.getAdAnalyticsDailyCollection = getAdAnalyticsDailyCollection;
