import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { notificationsController } from '../controllers/notificationsController';
import { requireAuth } from '../middleware/authMiddleware';
import { logSecurityEvent } from '../utils/securityLogger';

const router = Router();

const createNotificationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const actorId = (req as any).user?.id || 'anonymous';
    const senderId = typeof req.body?.fromUserId === 'string' ? req.body.fromUserId : 'unknown';
    const senderType = req.body?.fromOwnerType === 'company' ? 'company' : 'user';
    return `${actorId}:${senderType}:${senderId}`;
  },
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/notifications',
      metadata: {
        key: 'notifications_create',
        max: 40,
        windowMs: 60 * 1000
      }
    });
    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many notification actions. Please slow down and try again.'
    });
  }
});

// GET /api/notifications - Get notifications for the current user
router.get('/', requireAuth, notificationsController.getMyNotifications);

// POST /api/notifications - Create new notification (system-level or authorized)
router.post('/', requireAuth, createNotificationRateLimiter, notificationsController.createNotification);

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', requireAuth, notificationsController.markAllAsRead);

// PUT /api/notifications/:id/read - Mark notification as read (Legacy support)
router.put('/:id/read', requireAuth, notificationsController.markAsRead);

// POST /api/notifications/:id/read - Mark notification as read
router.post('/:id/read', requireAuth, notificationsController.markAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', requireAuth, notificationsController.deleteNotification);

export default router;
