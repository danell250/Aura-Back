import { Request, Response } from 'express';
import { getDB } from '../db';
import axios from 'axios';
import { logSecurityEvent } from '../utils/securityLogger';
import { resolveIdentityActor } from '../utils/identityUtils';

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
import { AD_PLANS } from '../constants/adPlans';

export function getCurrentBillingWindow(subscriptionStart: Date) {
  const start = new Date(subscriptionStart);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

const BILLING_MS = 30 * 24 * 60 * 60 * 1000;

export async function ensureCurrentPeriod(db: any, subscription: any) {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  // If still in current period, return as-is
  if (subscription.periodEnd && now < subscription.periodEnd) {
    return subscription;
  }

  // Calculate new period bounds
  const durationDays = subscription.durationDays || 30;
  const periodStart = now;
  const periodEnd = now + (durationDays * oneDayMs);

  // Use findOneAndUpdate for atomicity - only update if period hasn't been reset by another request
  const updated = await db.collection('adSubscriptions').findOneAndUpdate(
    {
      id: subscription.id,
      // Conditional check to prevent race conditions
      periodEnd: subscription.periodEnd
    },
    {
      $set: {
        adsUsed: 0,
        impressionsUsed: 0,
        periodStart,
        periodEnd,
        updatedAt: now
      }
    },
    { returnDocument: 'after' }
  );

  // Return updated document or original if no update occurred
  return updated.value || subscription;
}

const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';
type OwnerType = 'user' | 'company';

const parseOwnerType = (value: unknown): OwnerType | null => {
  if (value === undefined || value === null || value === '') return 'user';
  if (value === 'user' || value === 'company') return value;
  return null;
};

const buildOwnerScope = (ownerId: string, ownerType: OwnerType) => {
  const clauses: any[] = [
    { ownerId, ownerType },
    { userId: ownerId, ownerType } // backward compatibility
  ];

  if (ownerType === 'user') {
    clauses.push({ userId: ownerId, ownerType: { $exists: false } });
  }

  return { $or: clauses };
};

const getSubscriptionOwner = (subscription: any): { ownerId: string; ownerType: OwnerType } | null => {
  const ownerId = typeof subscription?.ownerId === 'string' && subscription.ownerId
    ? subscription.ownerId
    : (typeof subscription?.userId === 'string' ? subscription.userId : '');

  if (!ownerId) return null;
  const ownerType: OwnerType = subscription?.ownerType === 'company' ? 'company' : 'user';
  return { ownerId, ownerType };
};

export const adSubscriptionsController = {
  // GET /api/ad-subscriptions/user/:userId - Get user's ad subscriptions
  getUserSubscriptions: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const ownerType = parseOwnerType(req.query.ownerType);
      if (!ownerType) {
        return res.status(400).json({
          success: false,
          error: 'Invalid ownerType. Use "user" or "company".'
        });
      }

      const requestedOwnerId = req.params.userId;
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedOwnerId
      });
      if (!actor || actor.id !== requestedOwnerId || actor.type !== ownerType) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized to access subscriptions for this identity'
        });
      }

      console.log(`[AdSubscriptions] Fetching subscriptions for ${ownerType}:`, requestedOwnerId);

      const db = getDB();
      const query = buildOwnerScope(actor.id, actor.type);

      const subscriptions = await db.collection(AD_SUBSCRIPTIONS_COLLECTION)
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      console.log('[AdSubscriptions] Found subscriptions:', subscriptions.length);

      res.json({
        success: true,
        data: subscriptions
      });
    } catch (error) {
      console.error('[AdSubscriptions] Error fetching user subscriptions:', error);
      // Return empty array instead of error to prevent frontend from getting stuck
      res.json({
        success: true,
        data: [],
        error: 'Failed to fetch subscriptions'
      });
    }
  },

  // POST /api/ad-subscriptions - Create new ad subscription
  createSubscription: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const {
        userId,
        packageId,
        packageName,
        paypalSubscriptionId,
        adLimit,
        durationDays,
        ownerType = 'user'
      } = req.body;

      const normalizedOwnerType = parseOwnerType(ownerType);
      if (!normalizedOwnerType) {
        return res.status(400).json({
          success: false,
          error: 'Invalid ownerType. Use "user" or "company".'
        });
      }

      const requestedOwnerId = typeof userId === 'string' && userId ? userId : authenticatedUserId;
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType: normalizedOwnerType,
        ownerId: requestedOwnerId
      });
      if (!actor || actor.id !== requestedOwnerId || actor.type !== normalizedOwnerType) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized to create subscription for this identity'
        });
      }

      if (!packageId || !packageName || !adLimit) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'packageId, packageName, and adLimit are required'
        });
      }

      const db = getDB();
      const now = Date.now();

      // Calculate end date for one-time packages
      const endDate = durationDays ? now + (durationDays * 24 * 60 * 60 * 1000) : undefined;

      // For subscriptions, next billing is typically 30 days from start
      const nextBillingDate = !durationDays ? now + (30 * 24 * 60 * 60 * 1000) : undefined;

      const plan = AD_PLANS[packageId as keyof typeof AD_PLANS];
      const impressionLimit = plan ? plan.impressionLimit : 0;

      const periodStart = now;
      const periodEnd = nextBillingDate || (now + BILLING_MS);

      const newSubscription = {
        id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        userId: actor.id, // Legacy field
        ownerId: actor.id, // New standardized field
        ownerType: actor.type,
        packageId,
        packageName,
        status: 'active',
        startDate: now,
        endDate,
        nextBillingDate,
        paypalSubscriptionId: paypalSubscriptionId || null,
        periodStart,
        periodEnd,
        adsUsed: 0,
        impressionsUsed: 0,
        adLimit,
        impressionLimit,
        createdAt: now,
        updatedAt: now
      };

      await db.collection(AD_SUBSCRIPTIONS_COLLECTION).insertOne(newSubscription);

      // Log the transaction
      await db.collection('transactions').insertOne({
        userId: actor.id,
        ownerId: actor.id,
        ownerType: actor.type,
        type: 'ad_subscription',
        packageId,
        packageName,
        transactionId: paypalSubscriptionId || `tx-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        paymentMethod: 'paypal',
        status: 'completed',
        details: {
          adLimit,
          durationDays,
          subscriptionId: newSubscription.id
        },
        createdAt: now
      });

      res.status(201).json({
        success: true,
        data: newSubscription,
        message: 'Ad subscription created successfully'
      });
    } catch (error) {
      console.error('Error creating subscription:', error);
      logSecurityEvent({
        req,
        type: 'payment_failure',
        userId: (req.user as any)?.id || (req.body && req.body.userId),
        metadata: {
          source: 'ad_subscriptions',
          reason: 'create_subscription_exception',
          packageId: req.body && req.body.packageId,
          packageName: req.body && req.body.packageName,
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create subscription',
        message: 'Internal server error'
      });
    }
  },

  // PUT /api/ad-subscriptions/:id/use-ad - Increment ads used count
  useAdSlot: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const { id } = req.params;
      const db = getDB();

      const subscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });

      if (!subscription) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found',
          message: 'The requested subscription could not be found.'
        });
      }

      const owner = getSubscriptionOwner(subscription);
      if (!owner) {
        return res.status(500).json({
          success: false,
          error: 'Subscription ownership metadata is invalid'
        });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, owner);
      if (!actor || actor.id !== owner.ownerId || actor.type !== owner.ownerType) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized to use this subscription'
        });
      }

      if (subscription.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: 'Subscription is not active',
          message: 'This subscription is not currently active.'
        });
      }

      if (subscription.adsUsed >= subscription.adLimit) {
        return res.status(400).json({
          success: false,
          error: 'Ad limit reached for this subscription',
          message: 'You have reached the maximum number of ads allowed for this subscription.'
        });
      }

      // Check if subscription has expired
      if (subscription.endDate && Date.now() > subscription.endDate) {
        await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
          { id },
          { $set: { status: 'expired', updatedAt: Date.now() } }
        );

        return res.status(400).json({
          success: false,
          error: 'Subscription has expired'
        });
      }

      // Increment ads used
      const result = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
        { id, ownerId: owner.ownerId, ownerType: owner.ownerType },
        {
          $inc: { adsUsed: 1 },
          $set: { updatedAt: Date.now() }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found'
        });
      }

      const updatedSubscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });

      res.json({
        success: true,
        data: updatedSubscription,
        message: 'Ad slot used successfully'
      });
    } catch (error) {
      console.error('Error using ad slot:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to use ad slot',
        message: 'Internal server error'
      });
    }
  },

  // PUT /api/ad-subscriptions/:id/cancel - Cancel subscription
  cancelSubscription: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const { id } = req.params;
      const db = getDB();
      const subscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });
      if (!subscription) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found'
        });
      }

      const owner = getSubscriptionOwner(subscription);
      if (!owner) {
        return res.status(500).json({
          success: false,
          error: 'Subscription ownership metadata is invalid'
        });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, owner);
      if (!actor || actor.id !== owner.ownerId || actor.type !== owner.ownerType) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized to cancel this subscription'
        });
      }

      const result = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
        { id, ownerId: owner.ownerId, ownerType: owner.ownerType },
        {
          $set: {
            status: 'cancelled',
            updatedAt: Date.now()
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found'
        });
      }

      const updatedSubscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });

      res.json({
        success: true,
        data: updatedSubscription,
        message: 'Subscription cancelled successfully'
      });
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel subscription',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/ad-subscriptions/user/:userId/active - Get user's active subscriptions with available ad slots
  getActiveSubscriptions: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const ownerType = parseOwnerType(req.query.ownerType);
      if (!ownerType) {
        return res.status(400).json({
          success: false,
          error: 'Invalid ownerType. Use "user" or "company".'
        });
      }

      const requestedOwnerId = req.params.userId;
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedOwnerId
      });
      if (!actor || actor.id !== requestedOwnerId || actor.type !== ownerType) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized to access active subscriptions for this identity'
        });
      }

      const db = getDB();
      const now = Date.now();

      const baseQuery = {
        status: 'active',
        $or: [
          { endDate: { $exists: false } }, // Ongoing subscriptions
          { endDate: { $gt: now } } // Not expired
        ]
      };

      const query: any = {
        $and: [
          baseQuery,
          buildOwnerScope(actor.id, actor.type)
        ]
      };

      // Find active subscriptions that haven't expired
      const activeSubscriptions = await db.collection(AD_SUBSCRIPTIONS_COLLECTION)
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      // Update subscription periods and return
      const updated = [];
      for (const sub of activeSubscriptions) {
        updated.push(await ensureCurrentPeriod(db, sub));
      }

      // Auto-expire any subscriptions that have passed their end date
      const expireQuery: any = {
        status: 'active',
        endDate: { $exists: true, $lte: now },
        ...buildOwnerScope(actor.id, actor.type)
      };

      await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateMany(
        expireQuery,
        {
          $set: { status: 'expired', updatedAt: now }
        }
      );

      res.json({
        success: true,
        data: updated
      });
    } catch (error) {
      console.error('Error fetching active subscriptions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch active subscriptions',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/ad-subscriptions/:id - Get subscription by ID
  getSubscriptionById: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const { id } = req.params;
      const db = getDB();

      const subscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });

      if (!subscription) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found'
        });
      }

      const owner = getSubscriptionOwner(subscription);
      if (!owner) {
        return res.status(500).json({
          success: false,
          error: 'Subscription ownership metadata is invalid'
        });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, owner);
      if (!actor || actor.id !== owner.ownerId || actor.type !== owner.ownerType) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized to access this subscription'
        });
      }

      res.json({
        success: true,
        data: subscription
      });
    } catch (error) {
      console.error('Error fetching subscription:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch subscription',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/ad-subscriptions/webhook - Handle PayPal webhooks
  handleWebhook: async (req: Request, res: Response) => {
    try {
      const event = req.body;
      const isValid = await verifyPayPalWebhookSignature(req);
      if (!isValid) {
        logSecurityEvent({
          req,
          type: 'webhook_signature_failed',
          metadata: {
            source: 'ad_subscriptions',
            eventId: event && event.id,
            eventType: event && event.event_type
          }
        });
        return res.status(401).json({
          success: false,
          error: 'Invalid webhook signature',
          message: 'Webhook verification failed'
        });
      }
      const db = getDB();

      if (event && event.id) {
        const existing = await db.collection('paypalWebhookEvents').findOne({ id: event.id });
        if (existing) {
          return res.status(200).json({
            success: true,
            message: 'Event already processed'
          });
        }
        await db.collection('paypalWebhookEvents').insertOne({
          id: event.id,
          eventType: event.event_type,
          source: 'ad-subscriptions',
          createdAt: new Date().toISOString()
        });
      }

      const eventType = event.event_type;
      const resource = event.resource;

      console.log(`[AdSubscriptions] Webhook received: ${eventType}`);

      if (
        eventType === 'PAYMENT.SALE.COMPLETED' ||
        eventType === 'BILLING.SUBSCRIPTION.PAYMENT.SUCCEEDED' ||
        eventType === 'PAYMENT.CAPTURE.COMPLETED'
      ) {
        const subscriptionId =
          resource.billing_agreement_id ||
          resource.id ||
          (resource.supplementary_data && resource.supplementary_data.related_ids && resource.supplementary_data.related_ids.billing_agreement_id);

        if (subscriptionId) {
          console.log(`[AdSubscriptions] Processing renewal for subscription: ${subscriptionId}`);

          const subscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({
            paypalSubscriptionId: subscriptionId
          });

          if (subscription) {
            await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
              { _id: subscription._id },
              {
                $set: {
                  adsUsed: 0,
                  impressionsUsed: 0,
                  updatedAt: Date.now(),
                  status: 'active'
                }
              }
            );

            const amount =
              (resource.amount && (resource.amount.total || resource.amount.value)) ||
              undefined;
            const currency =
              (resource.amount && (resource.amount.currency || resource.amount.currency_code)) ||
              undefined;

            await db.collection('transactions').insertOne({
              userId: subscription.userId,
              type: 'ad_subscription_renewal',
              packageId: subscription.packageId,
              packageName: subscription.packageName,
              transactionId: resource.id,
              paymentMethod: 'paypal_subscription',
              status: 'completed',
              amount,
              currency,
              details: {
                subscriptionId: subscription.id,
                paypalSubscriptionId: subscriptionId
              },
              createdAt: new Date().toISOString()
            });

            console.log(`[AdSubscriptions] Successfully renewed subscription ${subscription.id}`);
          } else {
            console.warn(`[AdSubscriptions] No subscription found for PayPal ID: ${subscriptionId}`);
          }
        }
      } else if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
        const subscriptionId = resource.id;
        console.log(`[AdSubscriptions] Processing cancellation for subscription: ${subscriptionId}`);

        await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
          { paypalSubscriptionId: subscriptionId },
          {
            $set: {
              status: 'cancelled',
              updatedAt: Date.now()
            }
          }
        );
      } else if (eventType === 'BILLING.SUBSCRIPTION.EXPIRED' || eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
        const subscriptionId = resource.id;
        console.log(`[AdSubscriptions] Processing expiration/suspension for subscription: ${subscriptionId}`);

        await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
          { paypalSubscriptionId: subscriptionId },
          {
            $set: {
              status: 'expired',
              updatedAt: Date.now()
            }
          }
        );
      }

      res.status(200).json({ success: true, message: 'Webhook processed' });
    } catch (error) {
      console.error('[AdSubscriptions] Error processing webhook:', error);
      logSecurityEvent({
        req,
        type: 'payment_failure',
        metadata: {
          source: 'ad_subscriptions',
          reason: 'webhook_exception',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
      res.status(500).json({
        success: false,
        error: 'Failed to process webhook',
        message: 'Internal server error'
      });
    }
  }
};
