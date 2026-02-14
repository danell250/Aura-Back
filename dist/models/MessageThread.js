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
exports.getMessageThreadsCollection = exports.initializeMessageThreadCollection = exports.buildMessageThreadKey = void 0;
let messageThreadsCollection;
const buildMessageThreadKey = (ownerType, ownerId, peerType, peerId) => `${ownerType}:${ownerId}::${peerType}:${peerId}`;
exports.buildMessageThreadKey = buildMessageThreadKey;
const initializeMessageThreadCollection = (db) => __awaiter(void 0, void 0, void 0, function* () {
    messageThreadsCollection = db.collection('message_threads');
    yield Promise.all([
        messageThreadsCollection.createIndex({ key: 1 }, { unique: true }),
        messageThreadsCollection.createIndex({ ownerType: 1, ownerId: 1, state: 1, updatedAt: -1 }),
        messageThreadsCollection.createIndex({ ownerType: 1, ownerId: 1, peerType: 1, peerId: 1 }),
    ]);
});
exports.initializeMessageThreadCollection = initializeMessageThreadCollection;
const getMessageThreadsCollection = () => {
    if (!messageThreadsCollection) {
        throw new Error('Message threads collection not initialized. Call initializeMessageThreadCollection first.');
    }
    return messageThreadsCollection;
};
exports.getMessageThreadsCollection = getMessageThreadsCollection;
