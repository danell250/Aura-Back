"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adSubscriptionsController_1 = require("../controllers/adSubscriptionsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const router = (0, express_1.Router)();
const adBillingWriteLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many ad billing requests',
        message: 'Please wait a few minutes before trying this ad billing action again.'
    }
});
// GET /api/ad-subscriptions/user/:userId - Get user's ad subscriptions
router.get('/user/:userId', authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.getUserSubscriptions);
// GET /api/ad-subscriptions/user/:userId/active - Get user's active subscriptions
router.get('/user/:userId/active', authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.getActiveSubscriptions);
// GET /api/ad-subscriptions/:id - Get subscription by ID
router.get('/:id', authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.getSubscriptionById);
// POST /api/ad-subscriptions - Create new ad subscription
router.post('/', adBillingWriteLimiter, authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.createSubscription);
// PUT /api/ad-subscriptions/:id/use-ad - Use an ad slot
router.put('/:id/use-ad', adBillingWriteLimiter, authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.useAdSlot);
// PUT /api/ad-subscriptions/:id/cancel - Cancel subscription
router.put('/:id/cancel', adBillingWriteLimiter, authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.cancelSubscription);
// POST /api/ad-subscriptions/webhook - PayPal Webhook
router.post('/webhook', adSubscriptionsController_1.adSubscriptionsController.handleWebhook);
exports.default = router;
