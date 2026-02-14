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
const db_1 = require("../db");
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield (0, db_1.connectDB)();
        const db = (0, db_1.getDB)();
        yield db.collection('users').updateMany({ userMode: { $in: ['business', 'corporate'] } }, { $set: { userMode: 'company' } });
        const companies = yield db.collection('companies').find({}).toArray();
        for (const c of companies) {
            const subscribers = Array.isArray(c.subscribers)
                ? [...new Set(c.subscribers)]
                : Array.isArray(c.acquaintances)
                    ? [...new Set(c.acquaintances)]
                    : [];
            yield db.collection('companies').updateOne({ id: c.id }, { $set: { subscribers, subscriberCount: subscribers.length }, $unset: { acquaintances: '' } });
            if (subscribers.length) {
                yield db.collection('users').updateMany({ id: { $in: subscribers } }, { $addToSet: { subscribedCompanyIds: c.id } });
            }
        }
        console.log('Migration completed');
    }
    finally {
        yield (0, db_1.closeDB)();
    }
}))();
