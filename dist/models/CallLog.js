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
exports.getCallLogsCollection = exports.initializeCallLogsCollection = void 0;
let callLogsCollection;
const initializeCallLogsCollection = (db) => __awaiter(void 0, void 0, void 0, function* () {
    callLogsCollection = db.collection('call_logs');
    yield Promise.all([
        callLogsCollection.createIndex({ callId: 1 }, { unique: true }),
        callLogsCollection.createIndex({ toType: 1, toId: 1, status: 1, startedAt: -1 }),
        callLogsCollection.createIndex({ fromType: 1, fromId: 1, startedAt: -1 }),
        callLogsCollection.createIndex({ fromType: 1, fromId: 1, toType: 1, toId: 1, startedAt: -1 }),
    ]);
});
exports.initializeCallLogsCollection = initializeCallLogsCollection;
const getCallLogsCollection = () => {
    if (!callLogsCollection) {
        throw new Error('Call logs collection not initialized. Call initializeCallLogsCollection first.');
    }
    return callLogsCollection;
};
exports.getCallLogsCollection = getCallLogsCollection;
