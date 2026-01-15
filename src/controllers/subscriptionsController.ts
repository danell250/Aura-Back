import { Request, Response } from 'express';
import { getDB } from '../db';
import axios from 'axios';
import { logSecurityEvent } from '../utils/securityLogger';

async function verifyPayPalWebhookSignature(req: Request): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!webhookId || !clientId || !clientSecret) {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    return true;
  }
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const apiBase = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
  const tokenResponse = await axios.post(
    `${apiBase}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  const accessToken = tokenResponse.data.access_token;
  const headers = req.headers;
  const verificationBody = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: req.body
  };
  const verifyResponse = await axios.post(
    `${apiBase}/v1/notifications/verify-webhook-signature`,
    verificationBody,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return verifyResponse.data.verification_status === 'SUCCESS';
}

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
      const isValid = await verifyPayPalWebhookSignature(req);
      if (!isValid) {
        logSecurityEvent({
          req,
          type: 'webhook_signature_failed',
          metadata: {
            source: 'subscriptions',
            eventId: event && event.id,
            eventType: event && event.event_type
          }
        });
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }

      const db = getDB();

      if (event && event.id) {
        const existing = await db.collection('paypalWebhookEvents').findOne({ id: event.id });
        if (existing) {
          return res.status(200).json({ message: 'Event already processed' });
        }
        await db.collection('paypalWebhookEvents').insertOne({
          id: event.id,
          eventType: event.event_type,
          source: 'subscriptions',
          createdAt: new Date().toISOString()
        });
      }

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

        default:
          console.log('Unhandled webhook event:', event.event_type);
      }

      res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (error) {
      console.error('Error processing webhook:', error);
      logSecurityEvent({
        req,
        type: 'payment_failure',
        metadata: {
          source: 'subscriptions',
          reason: 'webhook_exception',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  }
};
