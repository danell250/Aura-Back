import { Request, Response } from 'express';
import { getDB } from '../db';

const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';

export const adSubscriptionsController = {
  // GET /api/ad-subscriptions/user/:userId - Get user's ad subscriptions
  getUserSubscriptions: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      console.log('[AdSubscriptions] Fetching subscriptions for user:', userId);
      
      const db = getDB();

      const subscriptions = await db.collection(AD_SUBSCRIPTIONS_COLLECTION)
        .find({ userId })
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
      const {
        userId,
        packageId,
        packageName,
        paypalSubscriptionId,
        adLimit,
        durationDays
      } = req.body;

      if (!userId || !packageId || !packageName || !adLimit) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'userId, packageId, packageName, and adLimit are required'
        });
      }

      const db = getDB();
      const now = Date.now();
      
      // Calculate end date for one-time packages
      const endDate = durationDays ? now + (durationDays * 24 * 60 * 60 * 1000) : undefined;
      
      // For subscriptions, next billing is typically 30 days from start
      const nextBillingDate = !durationDays ? now + (30 * 24 * 60 * 60 * 1000) : undefined;

      const newSubscription = {
        id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        userId,
        packageId,
        packageName,
        status: 'active',
        startDate: now,
        endDate,
        nextBillingDate,
        paypalSubscriptionId: paypalSubscriptionId || null,
        adsUsed: 0,
        adLimit,
        createdAt: now,
        updatedAt: now
      };

      await db.collection(AD_SUBSCRIPTIONS_COLLECTION).insertOne(newSubscription);

      // Log the transaction
      await db.collection('transactions').insertOne({
        userId,
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
      const { id } = req.params;
      const db = getDB();

      const subscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });
      
      if (!subscription) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found'
        });
      }

      if (subscription.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: 'Subscription is not active'
        });
      }

      if (subscription.adsUsed >= subscription.adLimit) {
        return res.status(400).json({
          success: false,
          error: 'Ad limit reached for this subscription'
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
        { id },
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
      const { id } = req.params;
      const db = getDB();

      const result = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
        { id },
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
      const { userId } = req.params;
      const db = getDB();
      const now = Date.now();

      // Find active subscriptions that haven't expired and have available ad slots
      const activeSubscriptions = await db.collection(AD_SUBSCRIPTIONS_COLLECTION)
        .find({
          userId,
          status: 'active',
          $or: [
            { endDate: { $exists: false } }, // Ongoing subscriptions
            { endDate: { $gt: now } } // Not expired
          ],
          $expr: { $lt: ['$adsUsed', '$adLimit'] } // Has available ad slots
        })
        .sort({ createdAt: -1 })
        .toArray();

      // Auto-expire any subscriptions that have passed their end date
      await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateMany(
        {
          userId,
          status: 'active',
          endDate: { $exists: true, $lte: now }
        },
        {
          $set: { status: 'expired', updatedAt: now }
        }
      );

      res.json({
        success: true,
        data: activeSubscriptions
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
      const { id } = req.params;
      const db = getDB();

      const subscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });

      if (!subscription) {
        return res.status(404).json({
          success: false,
          error: 'Subscription not found'
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
      const eventType = event.event_type;
      const resource = event.resource;
      
      console.log(`[AdSubscriptions] Webhook received: ${eventType}`);
      
      const db = getDB();

      if (eventType === 'PAYMENT.SALE.COMPLETED') {
        const subscriptionId = resource.billing_agreement_id;
        
        if (subscriptionId) {
          console.log(`[AdSubscriptions] Processing renewal for subscription: ${subscriptionId}`);
          
          // Find the subscription
          const subscription = await db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ 
            paypalSubscriptionId: subscriptionId 
          });
          
          if (subscription) {
            // Reset adsUsed for the new cycle and update timestamp
            await db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne(
              { _id: subscription._id },
              { 
                $set: { 
                  adsUsed: 0,
                  updatedAt: Date.now(),
                  status: 'active' // Ensure it's active
                } 
              }
            );
            
            // Log the renewal transaction
            await db.collection('transactions').insertOne({
              userId: subscription.userId,
              type: 'ad_subscription_renewal',
              packageId: subscription.packageId,
              packageName: subscription.packageName,
              transactionId: resource.id,
              paymentMethod: 'paypal_subscription',
              status: 'completed',
              amount: resource.amount?.total,
              currency: resource.amount?.currency,
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
      res.status(500).json({
        success: false,
        error: 'Failed to process webhook',
        message: 'Internal server error'
      });
    }
  }
};
