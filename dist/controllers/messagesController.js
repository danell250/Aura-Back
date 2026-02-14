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
const userUtils_1 = require("../utils/userUtils");
const identityUtils_1 = require("../utils/identityUtils");
exports.messagesController = {
    // GET /api/messages/conversations - Get all conversations for an actor (personal or company)
    getConversations: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType: req.query.ownerType,
                ownerId: req.query.userId
            }, req.headers);
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
            }
            const actorId = actor.id;
            const ownerType = actor.type;
            if (!(0, db_1.isDBConnected)()) {
                return res.json({ success: true, data: [] });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const db = (0, db_1.getDB)();
            // Get latest message for each conversation where actor is sender or receiver
            const conversations = yield messagesCollection.aggregate([
                {
                    $match: {
                        $or: [
                            { senderId: actorId },
                            { receiverId: actorId }
                        ]
                    }
                },
                {
                    $addFields: {
                        conversationWith: {
                            $cond: {
                                if: { $eq: ['$senderId', actorId] },
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
                                            { $eq: ['$receiverId', actorId] },
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
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: 'id',
                        as: 'otherUser'
                    }
                },
                {
                    $lookup: {
                        from: 'companies',
                        localField: '_id',
                        foreignField: 'id',
                        as: 'otherCompany'
                    }
                },
                {
                    $addFields: {
                        otherEntity: {
                            $cond: {
                                if: { $gt: [{ $size: '$otherUser' }, 0] },
                                then: { $arrayElemAt: ['$otherUser', 0] },
                                else: { $arrayElemAt: ['$otherCompany', 0] }
                            }
                        }
                    }
                },
                {
                    $unwind: {
                        path: '$otherEntity',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $sort: { 'lastMessage.timestamp': -1 }
                }
            ]).toArray();
            const collectionName = ownerType === 'company' ? 'companies' : 'users';
            const doc = yield db.collection(collectionName).findOne({ id: actorId });
            const archivedChats = (doc === null || doc === void 0 ? void 0 : doc.archivedChats) || [];
            const conversationsWithArchive = conversations.map(conv => {
                const otherUser = conv.otherEntity ? (0, userUtils_1.transformUser)(conv.otherEntity) : null;
                return Object.assign(Object.assign({}, conv), { otherUser, isArchived: archivedChats.includes(conv._id) });
            });
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
    // GET /api/messages/:otherId - Get messages between actor and another entity
    getMessages: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { userId: otherId } = req.params; // The other person/company
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const { page = 1, limit = 50, ownerType, currentUserId } = req.query;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType: ownerType,
                ownerId: currentUserId
            }, req.headers);
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
            }
            const actorId = actor.id;
            if (!(0, db_1.isDBConnected)()) {
                return res.json({ success: true, data: [] });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const messages = yield messagesCollection.find({
                $and: [
                    {
                        $or: [
                            { senderId: actorId, receiverId: otherId },
                            { senderId: otherId, receiverId: actorId }
                        ]
                    },
                    { deletedFor: { $ne: actorId } }
                ]
            })
                .sort({ timestamp: -1 })
                .limit(Number(limit))
                .skip((Number(page) - 1) * Number(limit))
                .toArray();
            const mappedMessages = messages.map((message) => (Object.assign(Object.assign({}, message), { id: message.id || (message._id ? String(message._id) : undefined) })));
            // Mark messages as read (only those sent by the other entity to the actor)
            yield messagesCollection.updateMany({
                senderId: otherId,
                receiverId: actorId,
                isRead: false
            }, { $set: { isRead: true } });
            res.json({
                success: true,
                data: mappedMessages.reverse()
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
        var _a;
        try {
            const { senderId: requestedSenderId, // Actor ID from client
            ownerType, receiverId, text, messageType = 'text', mediaUrl, mediaKey, mediaMimeType, mediaSize, replyTo } = req.body;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedSenderId
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized to send as this identity' });
            }
            const senderId = actor.id;
            if (!receiverId || !text) {
                return res.status(400).json({
                    success: false,
                    message: 'Receiver ID and text are required'
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({
                    success: false,
                    message: 'Messaging service is temporarily unavailable'
                });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const db = (0, db_1.getDB)();
            const message = {
                senderId,
                receiverId,
                text,
                timestamp: new Date(),
                isRead: false,
                messageType,
                mediaUrl,
                mediaKey,
                mediaMimeType,
                mediaSize,
                replyTo,
                isEdited: false
            };
            const result = yield messagesCollection.insertOne(message);
            const insertedMessage = yield messagesCollection.findOne({ _id: result.insertedId });
            const responseMessage = insertedMessage
                ? Object.assign(Object.assign({}, insertedMessage), { id: insertedMessage._id ? String(insertedMessage._id) : undefined }) : null;
            // Auto-unarchive for receiver
            const unarchiveUpdate = {
                $pull: { archivedChats: senderId },
                $set: { updatedAt: new Date().toISOString() }
            };
            yield Promise.all([
                db.collection('users').updateOne({ id: receiverId }, unarchiveUpdate),
                db.collection('companies').updateOne({ id: receiverId }, unarchiveUpdate)
            ]);
            res.status(201).json({
                success: true,
                data: responseMessage
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
        var _a;
        try {
            const { messageId } = req.params;
            const { text, userId: requestedActorId } = req.body;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!text) {
                return res.status(400).json({ success: false, message: 'Text is required' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, message: 'Service unavailable' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const message = yield messagesCollection.findOne({ _id: new mongodb_1.ObjectId(messageId) });
            if (!message) {
                return res.status(404).json({ success: false, message: 'Message not found' });
            }
            // Authorization: Must be the sender and have access to that identity
            const actorId = message.senderId;
            const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(authenticatedUserId, actorId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Unauthorized to edit this message' });
            }
            const result = yield messagesCollection.findOneAndUpdate({ _id: new mongodb_1.ObjectId(messageId) }, {
                $set: {
                    text,
                    isEdited: true,
                    editedAt: new Date()
                }
            }, { returnDocument: 'after' });
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
        var _a;
        try {
            const { messageId } = req.params;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, message: 'Service unavailable' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const message = yield messagesCollection.findOne({ _id: new mongodb_1.ObjectId(messageId) });
            if (!message) {
                return res.status(404).json({ success: false, message: 'Message not found' });
            }
            // Authorization: Must be the sender and have access to that identity
            const actorId = message.senderId;
            const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(authenticatedUserId, actorId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Unauthorized to delete this message' });
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
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const { userId: requestedActorId, ownerType, otherUserId } = req.body;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            const actorId = actor.id;
            if (!otherUserId) {
                return res.status(400).json({ success: false, message: 'Other party is required' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, message: 'Service unavailable' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            // IMPORTANT: In a "delete conversation" for one side, we usually just clear it for THEM
            // but the current schema seems to delete the messages globally for both. 
            // Following existing logic but with auth.
            yield messagesCollection.updateMany({
                $or: [
                    { senderId: actorId, receiverId: otherUserId },
                    { senderId: otherUserId, receiverId: actorId }
                ]
            }, { $addToSet: { deletedFor: actorId } });
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
    markAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            // Actor is the receiver of the messages being marked as read
            const requestedActorId = req.body.receiverId || req.body.currentUserId || req.body.userId || req.query.receiverId || req.query.currentUserId || req.query.userId;
            const ownerType = req.body.ownerType || req.query.ownerType;
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            const actorId = actor.id;
            // Other party is the sender of the messages
            const otherId = req.body.senderId || req.body.otherUserId || req.query.senderId || req.query.otherUserId;
            if (!otherId) {
                return res.json({ success: true, message: 'Missing sender parameters' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, message: 'Service unavailable' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            yield messagesCollection.updateMany({
                senderId: otherId,
                receiverId: actorId,
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
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const { userId: requestedActorId, ownerType, otherUserId, archived } = req.body;
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            const actorId = actor.id;
            if (!otherUserId || typeof archived !== 'boolean') {
                return res.status(400).json({ success: false, message: 'Invalid parameters' });
            }
            const db = (0, db_1.getDB)();
            const update = archived
                ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } }
                : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } };
            // Update in both collections to be safe
            yield Promise.all([
                db.collection('users').updateOne({ id: actorId }, update),
                db.collection('companies').updateOne({ id: actorId }, update)
            ]);
            res.json({
                success: true,
                message: archived ? 'Conversation archived successfully' : 'Conversation unarchived successfully'
            });
        }
        catch (error) {
            console.error('Error archiving conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update archive state'
            });
        }
    })
};
