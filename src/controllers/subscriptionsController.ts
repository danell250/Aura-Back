import { Request, Response } from 'express';
import { getDB } from '../db';

interface Subscription {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  status: 'active' | 'cancelled' | 'expired';
  paypalSubscriptionId: string;
  nextBillingDate: string;
  amount: string;
  createdDate: string;
  cancelledDate?: string;
}

export const subscriptionsController = {
  // Get user subscriptions
  async getUserSubscriptions(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const db = getDB();
      const subscriptions = await db.collection('subscriptions')
        .find({ userId })
        .sort({ createdDate: -1 })
        .toArray();

      res.json(subscriptions);
    } catch (error) {
      console.error('Error fetching user subscriptions:', error);
      res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
  },

  // Create subscription
  async createSubscription(req: Request, res: Response) {
    try {
      const { userId, planId, planName, paypalSubscriptionId, amount } = req.body;
      
      if (!userId || !planId || !planName || !paypalSubscriptionId || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const db = getDB();
      const subscription: Subscription = {
        id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        planId,
        planName,
        status: 'active',
        paypalSubscriptionId,
        nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
        amount,
        createdDate: new Date().toISOString()
      };

      await db.collection('subscriptions').insertOne(subscription);
      res.status(201).json(subscription);
    } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  },

  // Cancel subscription
  async cancelSubscription(req: Request, res: Response) {
    try {
      const { subscriptionId } = req.params;
      const db = getDB();

      const result = await db.collection('subscriptions').updateOne(
        { id: subscriptionId },
        { 
          $set: { 
            status: 'cancelled',
            cancelledDate: new Date().toISOString()
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      // In a real implementation, you would also call PayPal API to cancel the subscription
      // const paypalResponse = await cancelPayPalSubscription(paypalSubscriptionId);

      res.json({ message: 'Subscription cancelled successfully' });
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  },

  // Handle PayPal webhook events
  async handleWebhook(req: Request, res: Response) {
    try {
      const event = req.body;
      
      // Verify webhook signature in production
      // const isValid = verifyPayPalWebhookSignature(req);
      // if (!isValid) {
      //   return res.status(401).json({ error: 'Invalid webhook signature' });
      // }

      const db = getDB();

      switch (event.event_type) {
        case 'BILLING.SUBSCRIPTION.ACTIVATED':
          // Handle subscription activation
          await db.collection('subscriptions').updateOne(
            { paypalSubscriptionId: event.resource.id },
            { $set: { status: 'active' } }
          );
          break;

        case 'BILLING.SUBSCRIPTION.CANCELLED':
          // Handle subscription cancellation
          await db.collection('subscriptions').updateOne(
            { paypalSubscriptionId: event.resource.id },
            { 
              $set: { 
                status: 'cancelled',
                cancelledDate: new Date().toISOString()
              }
            }
          );
          break;

        case 'BILLING.SUBSCRIPTION.EXPIRED':
          // Handle subscription expiration
          await db.collection('subscriptions').updateOne(
            { paypalSubscriptionId: event.resource.id },
            { $set: { status: 'expired' } }
          );
          break;

        case 'PAYMENT.SALE.COMPLETED':
          // Handle successful payment
          console.log('Payment completed for subscription:', event.resource.billing_agreement_id);
          break;

        default:
          console.log('Unhandled webhook event:', event.event_type);
      }

      res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  }
};