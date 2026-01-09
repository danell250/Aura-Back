"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notificationsController_1 = require("../controllers/notificationsController");
const router = (0, express_1.Router)();
// GET /api/users/:userId/notifications - Get notifications for a user
router.get('/users/:userId/notifications', notificationsController_1.notificationsController.getNotificationsByUser);
// POST /api/notifications - Create new notification
router.post('/', notificationsController_1.notificationsController.createNotification);
// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', notificationsController_1.notificationsController.markAsRead);
// PUT /api/users/:userId/notifications/read-all - Mark all notifications as read
router.put('/users/:userId/notifications/read-all', notificationsController_1.notificationsController.markAllAsRead);
// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', notificationsController_1.notificationsController.deleteNotification);
exports.default = router;
