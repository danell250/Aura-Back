import { Router } from 'express';
import { notificationsController } from '../controllers/notificationsController';
import { requireAuth, requireOwnership, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

// GET /api/notifications/user/:userId - Get notifications for a user (requires auth + ownership)
router.get('/user/:userId', requireAuth, requireOwnership(), notificationsController.getNotificationsByUser);

// POST /api/notifications - Create new notification (requires auth)
router.post('/', requireAuth, notificationsController.createNotification);

// PUT /api/notifications/:id/read - Mark notification as read (requires auth)
router.put('/:id/read', requireAuth, notificationsController.markAsRead);

// PUT /api/notifications/user/:userId/read-all - Mark all notifications as read (requires auth + ownership)
router.put('/user/:userId/read-all', requireAuth, requireOwnership(), notificationsController.markAllAsRead);

// DELETE /api/notifications/:id - Delete notification (requires auth)
router.delete('/:id', requireAuth, notificationsController.deleteNotification);

export default router;