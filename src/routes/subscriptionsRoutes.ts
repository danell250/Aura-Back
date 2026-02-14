import express from 'express';
import { subscriptionsController } from '../controllers/subscriptionsController';
import { requireAuth } from '../middleware/authMiddleware';

const router = express.Router();

// Get user subscriptions
router.get('/user/:userId', requireAuth, subscriptionsController.getUserSubscriptions);

// Create subscription
router.post('/', requireAuth, subscriptionsController.createSubscription);

// Cancel subscription
router.post('/:subscriptionId/cancel', requireAuth, subscriptionsController.cancelSubscription);

// Webhook for PayPal subscription events
router.post('/webhook', subscriptionsController.handleWebhook);

export default router;
