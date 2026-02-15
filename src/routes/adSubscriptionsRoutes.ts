import { Router } from 'express';
import { adSubscriptionsController } from '../controllers/adSubscriptionsController';
import { requireAuth } from '../middleware/authMiddleware';
import rateLimit from 'express-rate-limit';

const router = Router();

const adBillingWriteLimiter = rateLimit({
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
router.get('/user/:userId', requireAuth, adSubscriptionsController.getUserSubscriptions);

// GET /api/ad-subscriptions/user/:userId/active - Get user's active subscriptions
router.get('/user/:userId/active', requireAuth, adSubscriptionsController.getActiveSubscriptions);

// GET /api/ad-subscriptions/:id - Get subscription by ID
router.get('/:id', requireAuth, adSubscriptionsController.getSubscriptionById);

// POST /api/ad-subscriptions - Create new ad subscription
router.post('/', adBillingWriteLimiter, requireAuth, adSubscriptionsController.createSubscription);

// PUT /api/ad-subscriptions/:id/use-ad - Use an ad slot
router.put('/:id/use-ad', adBillingWriteLimiter, requireAuth, adSubscriptionsController.useAdSlot);

// PUT /api/ad-subscriptions/:id/cancel - Cancel subscription
router.put('/:id/cancel', adBillingWriteLimiter, requireAuth, adSubscriptionsController.cancelSubscription);

// POST /api/ad-subscriptions/webhook - PayPal Webhook
router.post('/webhook', adSubscriptionsController.handleWebhook);

export default router;
