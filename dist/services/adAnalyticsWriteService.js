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
    const { adId, ownerId, ownerType, dateKey, now, cpi, incrementUniqueReach } = input;
    const dailyInc = {
        impressions: 1,
        spend: cpi
    };
    if (incrementUniqueReach) {
        dailyInc.uniqueReach = 1;
    }
    yield Promise.all([
        db.collection('adAnalyticsDaily').updateOne({ adId, ownerId, ownerType, dateKey }, {
            $inc: dailyInc,
            $set: { updatedAt: now },
            $setOnInsert: { createdAt: now }
        }, { upsert: true }),
        db.collection('adAnalytics').updateOne({ adId }, [
            {
                $set: {
                    impressions: { $add: [{ $ifNull: ['$impressions', 0] }, 1] },
                    spend: { $add: [{ $ifNull: ['$spend', 0] }, cpi] },
                    ownerId,
                    ownerType,
                    lastUpdated: now
                }
            },
            {
                $set: {
                    ctr: {
                        $cond: [
                            { $gt: ['$impressions', 0] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$clicks', 0] }, '$impressions'] }, 100] },
                            0
                        ]
                    }
                }
            }
        ], { upsert: true }),
        db.collection('adDailyRollups').updateOne({ adId, ownerId, ownerType, dateKey }, {
            $inc: { impressions: 1 },
            $set: { lastUpdated: now }
        }, { upsert: true })
    ]);
});
exports.recordImpressionAnalytics = recordImpressionAnalytics;
