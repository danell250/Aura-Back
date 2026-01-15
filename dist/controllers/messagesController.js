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
exports.messagesController = void 0;
const Message_1 = require("../models/Message");
const mongodb_1 = require("mongodb");
const db_1 = require("../db");
exports.messagesController = {
    // GET /api/messages/conversations - Get all conversations for a user
    getConversations: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.query;
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: []
                });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const db = (0, db_1.getDB)();
            // Get latest message for each conversation
            const conversations = yield messagesCollection.aggregate([
                {
                    $match: {
                        $or: [
                            { senderId: userId },
                            { receiverId: userId }
                        ]
                    }
                },
                {
                    $addFields: {
                        conversationWith: {
                            $cond: {
                                if: { $eq: ['$senderId', userId] },
                                then: '$receiverId',
                                else: '$senderId'
                            }
                        }
                    }
                },
                {
                    $sort: { timestamp: -1 }
                },
                {
                    $group: {
                        _id: '$conversationWith',
                        lastMessage: { $first: '$$ROOT' },
                        unreadCount: {
                            $sum: {
                                $cond: {
                                    if: {
                                        $and: [
                                            { $eq: ['$receiverId', userId] },
                                            { $eq: ['$isRead', false] }
                                        ]
                                    },
                                    then: 1,
                                    else: 0
                                }
                            }
                        }
                    }
                },
                {
                    $sort: { 'lastMessage.timestamp': -1 }
                }
            ]).toArray();
            const user = yield db.collection('users').findOne({ id: userId });
            const archivedChats = (user === null || user === void 0 ? void 0 : user.archivedChats) || [];
            const conversationsWithArchive = conversations.map(conv => (Object.assign(Object.assign({}, conv), { isArchived: archivedChats.includes(conv._id) })));
            res.json({
                success: true,
                data: conversationsWithArchive
            });
        }
        catch (error) {
            console.error('Error fetching conversations:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch conversations'
            });
        }
    }),
    // GET /api/messages/:userId - Get messages between current user and another user
    getMessages: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const { currentUserId, page = 1, limit = 50 } = req.query;
            if (!currentUserId) {
                return res.status(400).json({
                    success: false,
                    message: 'Current user ID is required'
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: []
                });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const messages = yield messagesCollection.find({
                $or: [
                    { senderId: currentUserId, receiverId: userId },
                    { senderId: userId, receiverId: currentUserId }
                ]
            })
                .sort({ timestamp: -1 })
                .limit(Number(limit))
                .skip((Number(page) - 1) * Number(limit))
                .toArray();
            // Mark messages as read
            yield messagesCollection.updateMany({
                senderId: userId,
                receiverId: currentUserId,
                isRead: false
            }, { $set: { isRead: true } });
            res.json({
                success: true,
                data: messages.reverse() // Return in chronological order
            });
        }
        catch (error) {
            console.error('Error fetching messages:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch messages'
            });
        }
    }),
    // POST /api/messages - Send a new message
    sendMessage: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { senderId, receiverId, text, messageType = 'text', mediaUrl, replyTo } = req.body;
            if (!senderId || !receiverId || !text) {
                return res.status(400).json({
                    success: false,
                    message: 'Sender ID, receiver ID, and text are required'
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({
                    success: false,
                    message: 'Messaging service is temporarily unavailable'
                });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const message = {
                senderId,
                receiverId,
                text,
                timestamp: new Date(),
                isRead: false,
                messageType,
                mediaUrl,
                replyTo,
                isEdited: false
            };
            const result = yield messagesCollection.insertOne(message);
            const insertedMessage = yield messagesCollection.findOne({ _id: result.insertedId });
            res.status(201).json({
                success: true,
                data: insertedMessage
            });
        }
        catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send message'
            });
        }
    }),
    // PUT /api/messages/:messageId - Edit a message
    editMessage: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { messageId } = req.params;
            const { text, userId } = req.body;
            if (!text || !userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Text and user ID are required'
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({
                    success: false,
                    message: 'Messaging service is temporarily unavailable'
                });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const message = yield messagesCollection.findOne({ _id: new mongodb_1.ObjectId(messageId) });
            if (!message) {
                return res.status(404).json({
                    success: false,
                    message: 'Message not found'
                });
            }
            if (message.senderId !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only edit your own messages'
                });
            }
            const result = yield messagesCollection.findOneAndUpdate({ _id: new mongodb_1.ObjectId(messageId) }, {
                $set: {
                    text,
                    isEdited: true,
                    editedAt: new Date()
                }
            }, { returnDocument: 'after' });
            if (!result) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update message'
                });
            }
            res.json({
                success: true,
                data: result
            });
        }
        catch (error) {
            console.error('Error editing message:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to edit message'
            });
        }
    }),
    // DELETE /api/messages/:messageId - Delete a message
    deleteMessage: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { messageId } = req.params;
            const { userId } = req.body;
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({
                    success: false,
                    message: 'Messaging service is temporarily unavailable'
                });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const message = yield messagesCollection.findOne({ _id: new mongodb_1.ObjectId(messageId) });
            if (!message) {
                return res.status(404).json({
                    success: false,
                    message: 'Message not found'
                });
            }
            if (message.senderId !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only delete your own messages'
                });
            }
            yield messagesCollection.deleteOne({ _id: new mongodb_1.ObjectId(messageId) });
            res.json({
                success: true,
                message: 'Message deleted successfully'
            });
        }
        catch (error) {
            console.error('Error deleting message:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete message'
            });
        }
    }),
    // DELETE /api/messages/conversation - Delete all messages in a conversation
    deleteConversation: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId, otherUserId } = req.body;
            if (!userId || !otherUserId) {
                return res.status(400).json({
                    success: false,
                    message: 'userId and otherUserId are required'
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({
                    success: false,
                    message: 'Messaging service is temporarily unavailable'
                });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            yield messagesCollection.deleteMany({
                $or: [
                    { senderId: userId, receiverId: otherUserId },
                    { senderId: otherUserId, receiverId: userId }
                ]
            });
            res.json({
                success: true,
                message: 'Conversation deleted successfully'
            });
        }
        catch (error) {
            console.error('Error deleting conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete conversation'
            });
        }
    }),
    // PUT /api/messages/mark-read - Mark messages as read
    markAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { senderId, receiverId } = req.body;
            if (!senderId || !receiverId) {
                return res.status(400).json({
                    success: false,
                    message: 'Sender ID and receiver ID are required'
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({
                    success: false,
                    message: 'Messaging service is temporarily unavailable'
                });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            yield messagesCollection.updateMany({
                senderId,
                receiverId,
                isRead: false
            }, { $set: { isRead: true } });
            res.json({
                success: true,
                message: 'Messages marked as read'
            });
        }
        catch (error) {
            console.error('Error marking messages as read:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to mark messages as read'
            });
        }
    }),
    archiveConversation: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId, otherUserId, archived } = req.body;
            if (!userId || !otherUserId || typeof archived !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    message: 'userId, otherUserId and archived flag are required'
                });
            }
            const db = (0, db_1.getDB)();
            const update = archived
                ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } }
                : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } };
            yield db.collection('users').updateOne({ id: userId }, update);
            res.json({
                success: true,
                message: archived ? 'Conversation archived successfully' : 'Conversation unarchived successfully'
            });
        }
        catch (error) {
            console.error('Error archiving conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update archive state for conversation'
            });
        }
    })
};
