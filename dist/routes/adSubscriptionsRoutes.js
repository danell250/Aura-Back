"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adSubscriptionsController_1 = require("../controllers/adSubscriptionsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
// GET /api/ad-subscriptions/user/:userId - Get user's ad subscriptions
router.get('/user/:userId', authMiddleware_1.optionalAuth, adSubscriptionsController_1.adSubscriptionsController.getUserSubscriptions);
// GET /api/ad-subscriptions/user/:userId/active - Get user's active subscriptions
router.get('/user/:userId/active', authMiddleware_1.optionalAuth, adSubscriptionsController_1.adSubscriptionsController.getActiveSubscriptions);
// GET /api/ad-subscriptions/:id - Get subscription by ID
router.get('/:id', authMiddleware_1.optionalAuth, adSubscriptionsController_1.adSubscriptionsController.getSubscriptionById);
// POST /api/ad-subscriptions - Create new ad subscription
router.post('/', authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.createSubscription);
// PUT /api/ad-subscriptions/:id/use-ad - Use an ad slot
router.put('/:id/use-ad', authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.useAdSlot);
// PUT /api/ad-subscriptions/:id/cancel - Cancel subscription
router.put('/:id/cancel', authMiddleware_1.requireAuth, adSubscriptionsController_1.adSubscriptionsController.cancelSubscription);
// POST /api/ad-subscriptions/webhook - PayPal Webhook
router.post('/webhook', adSubscriptionsController_1.adSubscriptionsController.handleWebhook);
exports.default = router;
