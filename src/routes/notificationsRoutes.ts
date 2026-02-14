import { Router } from 'express';
import { notificationsController } from '../controllers/notificationsController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// GET /api/notifications - Get notifications for the current user
router.get('/', requireAuth, notificationsController.getMyNotifications);

// POST /api/notifications - Create new notification (system-level or authorized)
router.post('/', requireAuth, notificationsController.createNotification);

// PUT /api/notifications/:id/read - Mark notification as read (Legacy support)
router.put('/:id/read', requireAuth, notificationsController.markAsRead);

// POST /api/notifications/:id/read - Mark notification as read
router.post('/:id/read', requireAuth, notificationsController.markAsRead);

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', requireAuth, notificationsController.markAllAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', requireAuth, notificationsController.deleteNotification);

export default router;