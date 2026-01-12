"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notificationsController_1 = require("../controllers/notificationsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
// GET /api/notifications/user/:userId - Get notifications for a user (requires auth + ownership)
router.get('/user/:userId', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)('userId'), notificationsController_1.notificationsController.getNotificationsByUser);
// POST /api/notifications - Create new notification (requires auth)
router.post('/', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.createNotification);
// PUT /api/notifications/:id/read - Mark notification as read (requires auth)
router.put('/:id/read', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.markAsRead);
// PUT /api/notifications/user/:userId/read-all - Mark all notifications as read (requires auth + ownership)
router.put('/user/:userId/read-all', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)('userId'), notificationsController_1.notificationsController.markAllAsRead);
// DELETE /api/notifications/:id - Delete notification (requires auth)
router.delete('/:id', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.deleteNotification);
exports.default = router;
