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
            // Get latest message for each conversation
            const conversations = yield Message_1.Message.aggregate([
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
            ]);
            res.json({
                success: true,
                data: conversations
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
            const messages = yield Message_1.Message.find({
                $or: [
                    { senderId: currentUserId, receiverId: userId },
                    { senderId: userId, receiverId: currentUserId }
                ]
            })
                .sort({ timestamp: -1 })
                .limit(Number(limit))
                .skip((Number(page) - 1) * Number(limit));
            // Mark messages as read
            yield Message_1.Message.updateMany({
                senderId: userId,
                receiverId: currentUserId,
                isRead: false
            }, { isRead: true });
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
            const message = new Message_1.Message({
                senderId,
                receiverId,
                text,
                messageType,
                mediaUrl,
                replyTo
            });
            yield message.save();
            res.status(201).json({
                success: true,
                data: message
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
            const message = yield Message_1.Message.findById(messageId);
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
            message.text = text;
            message.isEdited = true;
            message.editedAt = new Date();
            yield message.save();
            res.json({
                success: true,
                data: message
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
            const message = yield Message_1.Message.findById(messageId);
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
            yield Message_1.Message.findByIdAndDelete(messageId);
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
            yield Message_1.Message.updateMany({
                senderId,
                receiverId,
                isRead: false
            }, { isRead: true });
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
    })
};
