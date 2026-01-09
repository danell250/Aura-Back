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
exports.notificationsController = void 0;
// Mock data - in production this would come from database
const mockNotifications = [
    {
        id: 'notif-1',
        userId: '1',
        type: 'like',
        fromUser: {
            id: '2',
            firstName: 'Sarah',
            lastName: 'Williams',
            name: 'Sarah Williams',
            handle: '@sarahwilliams',
            avatar: 'https://picsum.photos/id/65/150/150'
        },
        message: 'liked your post',
        timestamp: Date.now() - 3600000,
        isRead: false,
        postId: 'post-1'
    }
];
exports.notificationsController = {
    // GET /api/users/:userId/notifications - Get notifications for a user
    getNotificationsByUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const { page = 1, limit = 20, unreadOnly } = req.query;
            let filteredNotifications = mockNotifications.filter(notif => notif.userId === userId);
            // Filter unread only if specified
            if (unreadOnly === 'true') {
                filteredNotifications = filteredNotifications.filter(notif => !notif.isRead);
            }
            // Sort by timestamp (newest first)
            filteredNotifications.sort((a, b) => b.timestamp - a.timestamp);
            // Pagination
            const startIndex = (Number(page) - 1) * Number(limit);
            const endIndex = startIndex + Number(limit);
            const paginatedNotifications = filteredNotifications.slice(startIndex, endIndex);
            res.json({
                success: true,
                data: paginatedNotifications,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total: filteredNotifications.length,
                    pages: Math.ceil(filteredNotifications.length / Number(limit))
                },
                unreadCount: mockNotifications.filter(n => n.userId === userId && !n.isRead).length
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
            // Validate required fields
            if (!userId || !type || !fromUserId || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'userId, type, fromUserId, and message are required'
                });
            }
            // In production, fetch fromUser from database
            const fromUser = {
                id: fromUserId,
                firstName: 'User',
                lastName: '',
                name: 'User',
                handle: '@user',
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`
            };
            const newNotification = {
                id: `notif-${Date.now()}`,
                userId,
                type,
                fromUser,
                message,
                timestamp: Date.now(),
                isRead: false,
                postId: postId || undefined,
                connectionId: connectionId || undefined
            };
            // In production, save to database
            mockNotifications.push(newNotification);
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
            const notificationIndex = mockNotifications.findIndex(n => n.id === id);
            if (notificationIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found',
                    message: `Notification with ID ${id} does not exist`
                });
            }
            // Mark as read
            mockNotifications[notificationIndex].isRead = true;
            res.json({
                success: true,
                data: mockNotifications[notificationIndex],
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
    // PUT /api/users/:userId/notifications/read-all - Mark all notifications as read
    markAllAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            // Mark all user's notifications as read
            mockNotifications.forEach(notif => {
                if (notif.userId === userId) {
                    notif.isRead = true;
                }
            });
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
            const notificationIndex = mockNotifications.findIndex(n => n.id === id);
            if (notificationIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found',
                    message: `Notification with ID ${id} does not exist`
                });
            }
            // Remove notification
            mockNotifications.splice(notificationIndex, 1);
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
