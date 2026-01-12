import { Router } from 'express';
import { notificationsController } from '../controllers/notificationsController';

const router = Router();

// GET /api/notifications/user/:userId - Get notifications for a user
router.get('/user/:userId', notificationsController.getNotificationsByUser);

// POST /api/notifications - Create new notification
router.post('/', notificationsController.createNotification);

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', notificationsController.markAsRead);

// PUT /api/notifications/user/:userId/read-all - Mark all notifications as read
router.put('/user/:userId/read-all', notificationsController.markAllAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', notificationsController.deleteNotification);

export default router;