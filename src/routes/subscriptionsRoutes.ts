import express from 'express';
import { subscriptionsController } from '../controllers/subscriptionsController';

const router = express.Router();

// Get user subscriptions
router.get('/user/:userId', subscriptionsController.getUserSubscriptions);

// Create subscription
router.post('/', subscriptionsController.createSubscription);

// Cancel subscription
router.post('/:subscriptionId/cancel', subscriptionsController.cancelSubscription);

// Webhook for PayPal subscription events
router.post('/webhook', subscriptionsController.handleWebhook);

export default router;