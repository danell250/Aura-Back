"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notificationsController_1 = require("../controllers/notificationsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
// GET /api/notifications - Get notifications for the current user
router.get('/', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.getMyNotifications);
// GET /api/notifications/user/:userId - Get notifications for a user
router.get('/user/:userId', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.getNotificationsByUser);
// POST /api/notifications - Create new notification
router.post('/', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.createNotification);
// PUT /api/notifications/:id/read - Mark notification as read (Legacy support)
router.put('/:id/read', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.markAsRead);
// POST /api/notifications/:id/read - Mark notification as read
router.post('/:id/read', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.markAsRead);
// PUT /api/notifications/user/:userId/read-all - Mark all notifications as read
router.put('/user/:userId/read-all', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.markAllAsRead);
// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.deleteNotification);
exports.default = router;
