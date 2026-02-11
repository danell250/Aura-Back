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
exports.getAdEventDedupesCollection = exports.initializeAdEventDedupesCollection = void 0;
let adEventDedupesCollection;
const initializeAdEventDedupesCollection = (db) => __awaiter(void 0, void 0, void 0, function* () {
    adEventDedupesCollection = db.collection('adEventDedupes');
    // Create unique index to prevent bot/refresh inflation
    yield adEventDedupesCollection.createIndex({ adId: 1, eventType: 1, fingerprint: 1, dateKey: 1 }, { unique: true });
});
exports.initializeAdEventDedupesCollection = initializeAdEventDedupesCollection;
const getAdEventDedupesCollection = () => {
    if (!adEventDedupesCollection) {
        throw new Error('AdEventDedupes collection not initialized.');
    }
    return adEventDedupesCollection;
};
exports.getAdEventDedupesCollection = getAdEventDedupesCollection;
