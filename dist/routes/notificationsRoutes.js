"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const notificationsController_1 = require("../controllers/notificationsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const securityLogger_1 = require("../utils/securityLogger");
const router = (0, express_1.Router)();
const createNotificationRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        var _a, _b, _c;
        const actorId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.id) || 'anonymous';
        const senderId = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.fromUserId) === 'string' ? req.body.fromUserId : 'unknown';
        const senderType = ((_c = req.body) === null || _c === void 0 ? void 0 : _c.fromOwnerType) === 'company' ? 'company' : 'user';
        return `${actorId}:${senderType}:${senderId}`;
    },
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
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
router.get('/', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.getMyNotifications);
// POST /api/notifications - Create new notification (system-level or authorized)
router.post('/', authMiddleware_1.requireAuth, createNotificationRateLimiter, notificationsController_1.notificationsController.createNotification);
// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.markAllAsRead);
// PUT /api/notifications/:id/read - Mark notification as read (Legacy support)
router.put('/:id/read', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.markAsRead);
// POST /api/notifications/:id/read - Mark notification as read
router.post('/:id/read', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.markAsRead);
// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', authMiddleware_1.requireAuth, notificationsController_1.notificationsController.deleteNotification);
exports.default = router;
