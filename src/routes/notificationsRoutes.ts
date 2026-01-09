import { Router } from 'express';
import { notificationsController } from '../controllers/notificationsController';

const router = Router();

// GET /api/users/:userId/notifications - Get notifications for a user
router.get('/users/:userId/notifications', notificationsController.getNotificationsByUser);

// POST /api/notifications - Create new notification
router.post('/', notificationsController.createNotification);

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', notificationsController.markAsRead);

// PUT /api/users/:userId/notifications/read-all - Mark all notifications as read
router.put('/users/:userId/notifications/read-all', notificationsController.markAllAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', notificationsController.deleteNotification);

export default router;