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
exports.notificationsController = exports.createNotificationInDB = void 0;
const db_1 = require("../db");
const userUtils_1 = require("../utils/userUtils");
const identityUtils_1 = require("../utils/identityUtils");
const socketHub_1 = require("../realtime/socketHub");
const resolveTargetCollection = (db, targetId, requestedOwnerType) => __awaiter(void 0, void 0, void 0, function* () {
    const preferred = requestedOwnerType === 'company' ? 'companies' : 'users';
    const fallback = preferred === 'companies' ? 'users' : 'companies';
    const preferredQuery = preferred === 'companies'
        ? { id: targetId, legacyArchived: { $ne: true } }
        : { id: targetId };
    const preferredDoc = yield db.collection(preferred).findOne(preferredQuery, { projection: { id: 1 } });
    if (preferredDoc) {
        return {
            collectionName: preferred,
            ownerType: preferred === 'companies' ? 'company' : 'user',
        };
    }
    const fallbackQuery = fallback === 'companies'
        ? { id: targetId, legacyArchived: { $ne: true } }
        : { id: targetId };
    const fallbackDoc = yield db.collection(fallback).findOne(fallbackQuery, { projection: { id: 1 } });
    if (fallbackDoc) {
        return {
            collectionName: fallback,
            ownerType: fallback === 'companies' ? 'company' : 'user',
        };
    }
    return null;
});
const resolveFromIdentityDoc = (db, fromId) => __awaiter(void 0, void 0, void 0, function* () {
    const userDoc = yield db.collection('users').findOne({ id: fromId });
    if (userDoc)
        return userDoc;
    return db.collection('companies').findOne({
        id: fromId,
        legacyArchived: { $ne: true },
    });
});
const createNotificationInDB = (userId_1, type_1, fromUserId_1, message_1, postId_1, connectionId_1, meta_1, yearKey_1, ...args_1) => __awaiter(void 0, [userId_1, type_1, fromUserId_1, message_1, postId_1, connectionId_1, meta_1, yearKey_1, ...args_1], void 0, function* (userId, type, fromUserId, message, postId, connectionId, meta, yearKey, ownerType = 'user') {
    let db = null;
    if ((0, db_1.isDBConnected)()) {
        try {
            db = (0, db_1.getDB)();
        }
        catch (error) {
            console.error('Error accessing DB for notifications:', error);
        }
    }
    let fromUserDoc = null;
    let targetCollectionName = ownerType === 'company' ? 'companies' : 'users';
    let targetOwnerType = ownerType;
    if (db) {
        try {
            const [resolvedFromUser, resolvedTarget] = yield Promise.all([
                resolveFromIdentityDoc(db, fromUserId),
                resolveTargetCollection(db, userId, ownerType),
            ]);
            fromUserDoc = resolvedFromUser;
            if (resolvedTarget) {
                targetCollectionName = resolvedTarget.collectionName;
                targetOwnerType = resolvedTarget.ownerType;
            }
        }
        catch (error) {
            console.error('Error resolving notification identities in DB:', error);
        }
    }
    if (db && yearKey) {
        try {
            const existingDoc = yield db.collection(targetCollectionName).findOne({
                id: userId,
                notifications: { $elemMatch: { yearKey, type } }
            });
            if (existingDoc && Array.isArray(existingDoc.notifications)) {
                const existingNotification = existingDoc.notifications.find((n) => n.yearKey === yearKey && n.type === type);
                if (existingNotification) {
                    return existingNotification;
                }
            }
        }
        catch (error) {
            console.error('Error checking existing notification in DB:', error);
        }
    }
    const fromUser = fromUserDoc ? {
        id: fromUserDoc.id,
        firstName: fromUserDoc.firstName || '',
        lastName: fromUserDoc.lastName || '',
        name: fromUserDoc.name || `${fromUserDoc.firstName || ''} ${fromUserDoc.lastName || ''}`.trim(),
        handle: fromUserDoc.handle,
        avatar: fromUserDoc.avatar,
        avatarKey: fromUserDoc.avatarKey,
        avatarType: fromUserDoc.avatarType || 'image',
        activeGlow: fromUserDoc.activeGlow
    } : {
        id: fromUserId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`,
        avatarType: 'image',
        activeGlow: undefined
    };
    const newNotification = {
        id: `notif-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        notificationId: `notif-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type,
        fromUser,
        message,
        timestamp: Date.now(),
        createdAt: new Date(),
        updatedAt: new Date(),
        isRead: false,
        readAt: null,
        postId: postId || '',
        connectionId: connectionId || undefined,
        meta: meta || undefined,
        data: meta || undefined, // Alias for 'data' as requested
        yearKey: yearKey || undefined,
        ownerType: targetOwnerType // Store resolved ownerType in notification
    };
    if (db) {
        try {
            yield db.collection(targetCollectionName).updateOne({ id: userId }, {
                $push: { notifications: { $each: [newNotification], $position: 0 } }
            });
        }
        catch (error) {
            console.error(`Error creating notification in DB (${targetCollectionName}):`, error);
        }
    }
    (0, socketHub_1.emitToIdentity)(targetOwnerType, userId, 'notification:new', {
        ownerType: targetOwnerType,
        ownerId: userId,
        notification: Object.assign(Object.assign({}, newNotification), { fromUser: newNotification.fromUser ? (0, userUtils_1.transformUser)(newNotification.fromUser) : newNotification.fromUser }),
    });
    return newNotification;
});
exports.createNotificationInDB = createNotificationInDB;
exports.notificationsController = {
    // GET /api/notifications - Get notifications for the current user or authorized company
    getMyNotifications: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const { page = 1, limit = 20, unreadOnly, ownerType = 'user', ownerId } = req.query;
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType: ownerType,
                ownerId: ownerId
            });
            if (!actor) {
                return res.status(403).json({ success: false, error: 'Unauthorized access to this identity' });
            }
            const targetId = actor.id;
            const collectionName = actor.type === 'company' ? 'companies' : 'users';
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: Number(page), limit: Number(limit), total: 0, pages: 0 },
                    unreadCount: 0
                });
            }
            const db = (0, db_1.getDB)();
            const doc = yield db.collection(collectionName).findOne({ id: targetId });
            if (!doc) {
                return res.status(404).json({
                    success: false,
                    error: `${actor.type === 'company' ? 'Company' : 'User'} not found`
                });
            }
            let notifications = doc.notifications || [];
            if (unreadOnly === 'true') {
                notifications = notifications.filter((notif) => !notif.isRead);
            }
            notifications.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const startIndex = (Number(page) - 1) * Number(limit);
            const paginatedNotifications = notifications.slice(startIndex, startIndex + Number(limit)).map((notification) => {
                if (notification.fromUser) {
                    notification.fromUser = (0, userUtils_1.transformUser)(notification.fromUser);
                }
                return notification;
            });
            res.json({
                success: true,
                data: paginatedNotifications,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total: notifications.length,
                    pages: Math.ceil(notifications.length / Number(limit))
                },
                unreadCount: (doc.notifications || []).filter((n) => !n.isRead).length
            });
        }
        catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
        }
    }),
    // POST /api/notifications - Create new notification
    createNotification: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const { userId, type, fromUserId, message, postId, connectionId, ownerType = 'user', fromOwnerType } = req.body;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            if (!userId || !type || !fromUserId || !message) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }
            // Authorization: Only allow creating notifications if acting as fromUserId (user or company)
            const senderOwnerType = req.body.fromOwnerType || 'user';
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType: senderOwnerType,
                ownerId: fromUserId
            });
            if (!actor) {
                return res.status(403).json({ success: false, error: 'Unauthorized sender identity' });
            }
            const isAdmin = ((_b = req.user) === null || _b === void 0 ? void 0 : _b.role) === 'admin' || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.isAdmin) === true;
            if (!isAdmin && userId !== actor.id) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'You can only create notifications for your own identity'
                });
            }
            const db = (0, db_1.getDB)();
            const senderCollection = actor.type === 'company' ? 'companies' : 'users';
            const fromDoc = yield db.collection(senderCollection).findOne({ id: actor.id });
            const fromUser = fromDoc ? {
                id: fromDoc.id,
                firstName: fromDoc.firstName || '',
                lastName: fromDoc.lastName || '',
                name: fromDoc.name || `${fromDoc.firstName || ''} ${fromDoc.lastName || ''}`.trim(),
                handle: fromDoc.handle,
                avatar: fromDoc.avatar,
                avatarKey: fromDoc.avatarKey,
                avatarType: fromDoc.avatarType || 'image',
                activeGlow: fromDoc.activeGlow
            } : {
                id: fromUserId,
                firstName: 'User',
                lastName: '',
                name: 'User',
                handle: '@user',
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`,
                avatarType: 'image',
                activeGlow: undefined
            };
            const newNotification = {
                id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                userId,
                type,
                fromUser,
                message,
                timestamp: Date.now(),
                isRead: false,
                postId: postId || undefined,
                connectionId: connectionId || undefined,
                ownerType
            };
            const collectionName = ownerType === 'company' ? 'companies' : 'users';
            const targetDoc = yield db.collection(collectionName).findOne({ id: userId });
            if (!targetDoc) {
                return res.status(404).json({ success: false, error: 'Target identity not found' });
            }
            yield db.collection(collectionName).updateOne({ id: userId }, { $push: { notifications: { $each: [newNotification], $position: 0 } } });
            if (newNotification.fromUser) {
                newNotification.fromUser = (0, userUtils_1.transformUser)(newNotification.fromUser);
            }
            res.status(201).json({ success: true, data: newNotification });
        }
        catch (error) {
            console.error('Error creating notification:', error);
            res.status(500).json({ success: false, error: 'Failed to create notification' });
        }
    }),
    // PUT /api/notifications/:id/read - Mark notification as read
    markAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const { ownerId, ownerType = 'user' } = req.body;
            const db = (0, db_1.getDB)();
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId
            });
            if (!actor) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
            const actorId = actor.id;
            const collectionName = actor.type === 'company' ? 'companies' : 'users';
            // Update notification only if it belongs to the authorized actor
            const result = yield db.collection(collectionName).updateOne({ id: actorId, "notifications.id": id }, {
                $set: {
                    "notifications.$.isRead": true,
                    "notifications.$.readAt": new Date(),
                    "notifications.$.updatedAt": new Date()
                }
            });
            if (result.matchedCount === 0) {
                return res.status(404).json({ success: false, error: 'Notification not found' });
            }
            res.json({ success: true, message: 'Notification marked as read' });
        }
        catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }),
    // PUT /api/notifications/read-all - Mark all notifications as read
    markAllAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const { ownerId, ownerType = 'user' } = req.body;
            const db = (0, db_1.getDB)();
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId
            });
            if (!actor) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
            const actorId = actor.id;
            const collectionName = actor.type === 'company' ? 'companies' : 'users';
            const doc = yield db.collection(collectionName).findOne({ id: actorId });
            if (!doc) {
                return res.status(404).json({ success: false, error: 'Identity not found' });
            }
            if (!doc.notifications || doc.notifications.length === 0) {
                return res.json({ success: true, message: 'No notifications' });
            }
            const updatedNotifications = doc.notifications.map((n) => (Object.assign(Object.assign({}, n), { isRead: true })));
            yield db.collection(collectionName).updateOne({ id: actorId }, { $set: { notifications: updatedNotifications } });
            res.json({ success: true, message: 'All notifications marked as read' });
        }
        catch (error) {
            console.error('Error marking all notifications as read:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }),
    // DELETE /api/notifications/:id - Delete notification
    deleteNotification: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const { ownerId, ownerType = 'user' } = req.body;
            const db = (0, db_1.getDB)();
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId
            });
            if (!actor) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
            const actorId = actor.id;
            const collectionName = actor.type === 'company' ? 'companies' : 'users';
            const result = yield db.collection(collectionName).updateOne({ id: actorId, "notifications.id": id }, { $pull: { notifications: { id: id } } });
            if (result.matchedCount === 0) {
                return res.status(404).json({ success: false, error: 'Notification not found' });
            }
            res.json({ success: true, message: 'Notification deleted successfully' });
        }
        catch (error) {
            console.error('Error deleting notification:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    })
};
