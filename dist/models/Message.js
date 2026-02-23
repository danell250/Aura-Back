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
exports.getMessagesCollection = exports.initializeMessageCollection = void 0;
// This will be initialized when the database connection is established
let messagesCollection;
const initializeMessageCollection = (db) => __awaiter(void 0, void 0, void 0, function* () {
    messagesCollection = db.collection('messages');
    // Create indexes for better performance
    yield Promise.all([
        messagesCollection.createIndex({ senderId: 1, receiverId: 1, timestamp: -1 }, { background: true }),
        messagesCollection.createIndex({ senderOwnerType: 1, senderOwnerId: 1, receiverOwnerType: 1, receiverOwnerId: 1, timestamp: -1 }, { background: true }),
        messagesCollection.createIndex({ receiverId: 1, isRead: 1 }, { background: true }),
        messagesCollection.createIndex({ receiverOwnerType: 1, receiverOwnerId: 1, isRead: 1 }, { background: true }),
        messagesCollection.createIndex({ groupId: 1, timestamp: -1 }, { background: true, sparse: true }),
        messagesCollection.createIndex({ groupId: 1, groupMessageId: 1, receiverOwnerType: 1, receiverOwnerId: 1 }, { background: true, sparse: true }),
        messagesCollection.createIndex({ timestamp: -1 }, { background: true }),
    ]);
});
exports.initializeMessageCollection = initializeMessageCollection;
const getMessagesCollection = () => {
    if (!messagesCollection) {
        throw new Error('Messages collection not initialized. Call initializeMessageCollection first.');
    }
    return messagesCollection;
};
exports.getMessagesCollection = getMessagesCollection;
