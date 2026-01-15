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
// Helper function to create a notification in the database
const createNotificationInDB = (userId, type, fromUserId, message, postId, connectionId) => __awaiter(void 0, void 0, void 0, function* () {
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
    if (db) {
        try {
            fromUserDoc = yield db.collection('users').findOne({ id: fromUserId });
        }
        catch (error) {
            console.error('Error fetching notification fromUser in DB:', error);
        }
    }
    const fromUser = fromUserDoc ? {
        id: fromUserDoc.id,
        firstName: fromUserDoc.firstName || '',
        lastName: fromUserDoc.lastName || '',
        name: fromUserDoc.name || `${fromUserDoc.firstName} ${fromUserDoc.lastName}`,
        handle: fromUserDoc.handle,
        avatar: fromUserDoc.avatar
    } : {
        id: fromUserId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`
    };
    const newNotification = {
        id: `notif-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type,
        fromUser,
        message,
        timestamp: Date.now(),
        isRead: false,
        postId: postId || '',
        connectionId: connectionId || undefined
    };
    if (db) {
        try {
            yield db.collection('users').updateOne({ id: userId }, {
                $push: { notifications: { $each: [newNotification], $position: 0 } }
            });
        }
        catch (error) {
            console.error('Error creating notification in DB:', error);
        }
    }
    return newNotification;
});
exports.createNotificationInDB = createNotificationInDB;
exports.notificationsController = {
    // GET /api/notifications/user/:userId - Get notifications for a user
    getNotificationsByUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const { page = 1, limit = 20, unreadOnly } = req.query;
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: {
                        page: Number(page),
                        limit: Number(limit),
                        total: 0,
                        pages: 0
                    },
                    unreadCount: 0
                });
            }
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: userId });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            let notifications = user.notifications || [];
            // Filter unread only if specified
            if (unreadOnly === 'true') {
                notifications = notifications.filter((notif) => !notif.isRead);
            }
            // Sort by timestamp (newest first)
            notifications.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            // Pagination
            const startIndex = (Number(page) - 1) * Number(limit);
            const endIndex = startIndex + Number(limit);
            const paginatedNotifications = notifications.slice(startIndex, endIndex);
            res.json({
                success: true,
                data: paginatedNotifications,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total: notifications.length,
                    pages: Math.ceil(notifications.length / Number(limit))
                },
                unreadCount: (user.notifications || []).filter((n) => !n.isRead).length
            });
        }
        catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch notifications',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/notifications - Create new notification
    createNotification: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId, type, fromUserId, message, postId, connectionId } = req.body;
            const db = (0, db_1.getDB)();
            // Validate required fields
            if (!userId || !type || !fromUserId || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'userId, type, fromUserId, and message are required'
                });
            }
            // Fetch fromUser from database
            const fromUserDoc = yield db.collection('users').findOne({ id: fromUserId });
            const fromUser = fromUserDoc ? {
                id: fromUserDoc.id,
                firstName: fromUserDoc.firstName || '',
                lastName: fromUserDoc.lastName || '',
                name: fromUserDoc.name || `${fromUserDoc.firstName} ${fromUserDoc.lastName}`,
                handle: fromUserDoc.handle,
                avatar: fromUserDoc.avatar
            } : {
                id: fromUserId,
                firstName: 'User',
                lastName: '',
                name: 'User',
                handle: '@user',
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`
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
                connectionId: connectionId || undefined
            };
            // Save to database
            yield db.collection('users').updateOne({ id: userId }, {
                $push: { notifications: { $each: [newNotification], $position: 0 } }
            });
            res.status(201).json({
                success: true,
                data: newNotification,
                message: 'Notification created successfully'
            });
        }
        catch (error) {
            console.error('Error creating notification:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create notification',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/notifications/:id/read - Mark notification as read
    markAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            // Find user with this notification and update it
            const result = yield db.collection('users').updateOne({ "notifications.id": id }, { $set: { "notifications.$.isRead": true } });
            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found',
                    message: `Notification with ID ${id} does not exist`
                });
            }
            res.json({
                success: true,
                message: 'Notification marked as read'
            });
        }
        catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to mark notification as read',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/notifications/user/:userId/read-all - Mark all notifications as read
    markAllAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: userId });
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            if (!user.notifications || user.notifications.length === 0) {
                return res.json({ success: true, message: 'No notifications to mark as read' });
            }
            // Update all notifications in memory then save, or use array filters
            // Simpler to just map and replace for now
            const updatedNotifications = user.notifications.map((n) => (Object.assign(Object.assign({}, n), { isRead: true })));
            yield db.collection('users').updateOne({ id: userId }, { $set: { notifications: updatedNotifications } });
            res.json({
                success: true,
                message: 'All notifications marked as read'
            });
        }
        catch (error) {
            console.error('Error marking all notifications as read:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to mark all notifications as read',
                message: 'Internal server error'
            });
        }
    }),
    // DELETE /api/notifications/:id - Delete notification
    deleteNotification: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const result = yield db.collection('users').updateOne({ "notifications.id": id }, { $pull: { notifications: { id: id } } });
            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found',
                    message: `Notification with ID ${id} does not exist`
                });
            }
            res.json({
                success: true,
                message: 'Notification deleted successfully'
            });
        }
        catch (error) {
            console.error('Error deleting notification:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete notification',
                message: 'Internal server error'
            });
        }
    })
};
