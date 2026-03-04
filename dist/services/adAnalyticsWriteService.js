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
exports.recordImpressionAnalytics = void 0;
const recordImpressionAnalytics = (db, input) => __awaiter(void 0, void 0, void 0, function* () {
    const { adId, ownerId, ownerType, dateKey, now, cpi } = input;
    yield db.collection('adAnalyticsDaily').updateOne({ adId, ownerId, ownerType, dateKey }, {
        $inc: { uniqueReach: 1, impressions: 1, spend: cpi },
        $set: { updatedAt: now },
        $setOnInsert: { createdAt: now }
    }, { upsert: true });
    yield db.collection('adAnalytics').updateOne({ adId }, {
        $inc: { impressions: 1, spend: cpi },
        $set: { lastUpdated: now, ownerId, ownerType }
    }, { upsert: true });
    yield db.collection('adDailyRollups').updateOne({ adId, ownerId, ownerType, dateKey }, {
        $inc: { impressions: 1 },
        $set: { lastUpdated: now }
    }, { upsert: true });
});
exports.recordImpressionAnalytics = recordImpressionAnalytics;
