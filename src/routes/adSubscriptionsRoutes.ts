import { Router } from 'express';
import { adSubscriptionsController } from '../controllers/adSubscriptionsController';
import { requireAuth, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

// GET /api/ad-subscriptions/user/:userId - Get user's ad subscriptions
router.get('/user/:userId', optionalAuth, adSubscriptionsController.getUserSubscriptions);

// GET /api/ad-subscriptions/user/:userId/active - Get user's active subscriptions
router.get('/user/:userId/active', optionalAuth, adSubscriptionsController.getActiveSubscriptions);

// GET /api/ad-subscriptions/:id - Get subscription by ID
router.get('/:id', optionalAuth, adSubscriptionsController.getSubscriptionById);

// POST /api/ad-subscriptions - Create new ad subscription
router.post('/', requireAuth, adSubscriptionsController.createSubscription);

// PUT /api/ad-subscriptions/:id/use-ad - Use an ad slot
router.put('/:id/use-ad', requireAuth, adSubscriptionsController.useAdSlot);

// PUT /api/ad-subscriptions/:id/cancel - Cancel subscription
router.put('/:id/cancel', requireAuth, adSubscriptionsController.cancelSubscription);

export default router;