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
    // Create indexes for performance and uniqueness
    yield adAnalyticsDailyCollection.createIndex({ adId: 1, dateKey: 1 }, { unique: true });
    yield adAnalyticsDailyCollection.createIndex({ ownerId: 1, dateKey: 1 });
});
exports.initializeAdAnalyticsDailyCollection = initializeAdAnalyticsDailyCollection;
const getAdAnalyticsDailyCollection = () => {
    if (!adAnalyticsDailyCollection) {
        throw new Error('AdAnalyticsDaily collection not initialized.');
    }
    return adAnalyticsDailyCollection;
};
exports.getAdAnalyticsDailyCollection = getAdAnalyticsDailyCollection;
