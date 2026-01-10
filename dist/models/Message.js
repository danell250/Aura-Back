"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMessagesCollection = exports.initializeMessageCollection = void 0;
// This will be initialized when the database connection is established
let messagesCollection;
const initializeMessageCollection = (db) => {
    messagesCollection = db.collection('messages');
    // Create indexes for better performance
    messagesCollection.createIndex({ senderId: 1, receiverId: 1, timestamp: -1 });
    messagesCollection.createIndex({ receiverId: 1, isRead: 1 });
    messagesCollection.createIndex({ timestamp: -1 });
};
exports.initializeMessageCollection = initializeMessageCollection;
const getMessagesCollection = () => {
    if (!messagesCollection) {
        throw new Error('Messages collection not initialized. Call initializeMessageCollection first.');
    }
    return messagesCollection;
};
exports.getMessagesCollection = getMessagesCollection;
