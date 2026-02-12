import { Router } from 'express';
import { notificationsController } from '../controllers/notificationsController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// GET /api/notifications - Get notifications for the current user
router.get('/', requireAuth, notificationsController.getMyNotifications);

// GET /api/notifications/user/:userId - Get notifications for a user
router.get('/user/:userId', requireAuth, notificationsController.getNotificationsByUser);

// POST /api/notifications - Create new notification
router.post('/', requireAuth, notificationsController.createNotification);

// PUT /api/notifications/:id/read - Mark notification as read (Legacy support)
router.put('/:id/read', requireAuth, notificationsController.markAsRead);

// POST /api/notifications/:id/read - Mark notification as read
router.post('/:id/read', requireAuth, notificationsController.markAsRead);

// PUT /api/notifications/user/:userId/read-all - Mark all notifications as read
router.put('/user/:userId/read-all', requireAuth, notificationsController.markAllAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', requireAuth, notificationsController.deleteNotification);

export default router;