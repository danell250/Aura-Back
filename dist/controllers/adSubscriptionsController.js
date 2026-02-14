"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adSubscriptionsController = void 0;
exports.getCurrentBillingWindow = getCurrentBillingWindow;
exports.ensureCurrentPeriod = ensureCurrentPeriod;
const db_1 = require("../db");
const axios_1 = __importDefault(require("axios"));
const securityLogger_1 = require("../utils/securityLogger");
function verifyPayPalWebhookSignature(req) {
    return __awaiter(this, void 0, void 0, function* () {
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
        const tokenResponse = yield axios_1.default.post(`${apiBase}/v1/oauth2/token`, 'grant_type=client_credentials', {
            headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
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
        const verifyResponse = yield axios_1.default.post(`${apiBase}/v1/notifications/verify-webhook-signature`, verificationBody, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        return verifyResponse.data.verification_status === 'SUCCESS';
    });
}
const adPlans_1 = require("../constants/adPlans");
function getCurrentBillingWindow(subscriptionStart) {
    const start = new Date(subscriptionStart);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return { start, end };
}
const BILLING_MS = 30 * 24 * 60 * 60 * 1000;
function ensureCurrentPeriod(db, subscription) {
    return __awaiter(this, void 0, void 0, function* () {
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
        const updated = yield db.collection('adSubscriptions').findOneAndUpdate({
            id: subscription.id,
            // Conditional check to prevent race conditions
            periodEnd: subscription.periodEnd
        }, {
            $set: {
                adsUsed: 0,
                impressionsUsed: 0,
                periodStart,
                periodEnd,
                updatedAt: now
            }
        }, { returnDocument: 'after' });
        // Return updated document or original if no update occurred
        return updated.value || subscription;
    });
}
const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';
exports.adSubscriptionsController = {
    // GET /api/ad-subscriptions/user/:userId - Get user's ad subscriptions
    getUserSubscriptions: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const { ownerType = 'user' } = req.query;
            console.log(`[AdSubscriptions] Fetching subscriptions for ${ownerType}:`, userId);
            const db = (0, db_1.getDB)();
            const query = {
                $or: [
                    { ownerId: userId, ownerType },
                    { userId: userId, ownerType } // backward compatibility
                ]
            };
            // If no ownerType was explicitly set in the document yet (old data), 
            // and we're looking for 'user' type, also match documents without ownerType
            if (ownerType === 'user') {
                query.$or.push({ userId, ownerType: { $exists: false } });
            }
            const subscriptions = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION)
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();
            console.log('[AdSubscriptions] Found subscriptions:', subscriptions.length);
            res.json({
                success: true,
                data: subscriptions
            });
        }
        catch (error) {
            console.error('[AdSubscriptions] Error fetching user subscriptions:', error);
            // Return empty array instead of error to prevent frontend from getting stuck
            res.json({
                success: true,
                data: [],
                error: 'Failed to fetch subscriptions'
            });
        }
    }),
    // POST /api/ad-subscriptions - Create new ad subscription
    createSubscription: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId, packageId, packageName, paypalSubscriptionId, adLimit, durationDays, ownerType = 'user' } = req.body;
            if (!userId || !packageId || !packageName || !adLimit) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'userId, packageId, packageName, and adLimit are required'
                });
            }
            const db = (0, db_1.getDB)();
            const now = Date.now();
            // Calculate end date for one-time packages
            const endDate = durationDays ? now + (durationDays * 24 * 60 * 60 * 1000) : undefined;
            // For subscriptions, next billing is typically 30 days from start
            const nextBillingDate = !durationDays ? now + (30 * 24 * 60 * 60 * 1000) : undefined;
            const plan = adPlans_1.AD_PLANS[packageId];
            const impressionLimit = plan ? plan.impressionLimit : 0;
            const BILLING_MS = 30 * 24 * 60 * 60 * 1000;
            const periodStart = now;
            const periodEnd = nextBillingDate || (now + BILLING_MS);
            const newSubscription = {
                id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                userId, // Legacy field
                ownerId: userId, // New standardized field
                ownerType,
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
            yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).insertOne(newSubscription);
            // Log the transaction
            yield db.collection('transactions').insertOne({
                userId,
                ownerId: userId,
                ownerType,
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
        }
        catch (error) {
            console.error('Error creating subscription:', error);
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'payment_failure',
                userId: req.body && req.body.userId,
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
    }),
    // PUT /api/ad-subscriptions/:id/use-ad - Increment ads used count
    useAdSlot: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const subscription = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });
            if (!subscription) {
                return res.status(404).json({
                    success: false,
                    error: 'Subscription not found',
                    message: 'The requested subscription could not be found.'
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
                yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ id }, { $set: { status: 'expired', updatedAt: Date.now() } });
                return res.status(400).json({
                    success: false,
                    error: 'Subscription has expired'
                });
            }
            // Increment ads used
            const result = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ id }, {
                $inc: { adsUsed: 1 },
                $set: { updatedAt: Date.now() }
            });
            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Subscription not found'
                });
            }
            const updatedSubscription = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });
            res.json({
                success: true,
                data: updatedSubscription,
                message: 'Ad slot used successfully'
            });
        }
        catch (error) {
            console.error('Error using ad slot:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to use ad slot',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/ad-subscriptions/:id/cancel - Cancel subscription
    cancelSubscription: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const result = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ id }, {
                $set: {
                    status: 'cancelled',
                    updatedAt: Date.now()
                }
            });
            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Subscription not found'
                });
            }
            const updatedSubscription = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });
            res.json({
                success: true,
                data: updatedSubscription,
                message: 'Subscription cancelled successfully'
            });
        }
        catch (error) {
            console.error('Error cancelling subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to cancel subscription',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/ad-subscriptions/user/:userId/active - Get user's active subscriptions with available ad slots
    getActiveSubscriptions: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const { ownerType = 'user' } = req.query;
            const db = (0, db_1.getDB)();
            const now = Date.now();
            const baseQuery = {
                status: 'active',
                $or: [
                    { endDate: { $exists: false } }, // Ongoing subscriptions
                    { endDate: { $gt: now } } // Not expired
                ]
            };
            const query = {
                $and: [
                    baseQuery,
                    {
                        $or: [
                            { ownerId: userId, ownerType },
                            { userId: userId, ownerType }
                        ]
                    }
                ]
            };
            // Handle legacy 'user' subscriptions without ownerType field
            if (ownerType === 'user') {
                query.$and[1].$or.push({ userId, ownerType: { $exists: false } });
            }
            // Find active subscriptions that haven't expired
            const activeSubscriptions = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION)
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();
            // Update subscription periods and return
            const updated = [];
            for (const sub of activeSubscriptions) {
                updated.push(yield ensureCurrentPeriod(db, sub));
            }
            // Auto-expire any subscriptions that have passed their end date
            const expireQuery = {
                status: 'active',
                endDate: { $exists: true, $lte: now },
                $or: [
                    { ownerId: userId, ownerType },
                    { userId: userId, ownerType }
                ]
            };
            if (ownerType === 'user') {
                expireQuery.$or.push({ userId, ownerType: { $exists: false } });
            }
            yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateMany(expireQuery, {
                $set: { status: 'expired', updatedAt: now }
            });
            res.json({
                success: true,
                data: updated
            });
        }
        catch (error) {
            console.error('Error fetching active subscriptions:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch active subscriptions',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/ad-subscriptions/:id - Get subscription by ID
    getSubscriptionById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const subscription = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });
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
        }
        catch (error) {
            console.error('Error fetching subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch subscription',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/ad-subscriptions/webhook - Handle PayPal webhooks
    handleWebhook: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const event = req.body;
            const isValid = yield verifyPayPalWebhookSignature(req);
            if (!isValid) {
                (0, securityLogger_1.logSecurityEvent)({
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
            const db = (0, db_1.getDB)();
            if (event && event.id) {
                const existing = yield db.collection('paypalWebhookEvents').findOne({ id: event.id });
                if (existing) {
                    return res.status(200).json({
                        success: true,
                        message: 'Event already processed'
                    });
                }
                yield db.collection('paypalWebhookEvents').insertOne({
                    id: event.id,
                    eventType: event.event_type,
                    source: 'ad-subscriptions',
                    createdAt: new Date().toISOString()
                });
            }
            const eventType = event.event_type;
            const resource = event.resource;
            console.log(`[AdSubscriptions] Webhook received: ${eventType}`);
            if (eventType === 'PAYMENT.SALE.COMPLETED' ||
                eventType === 'BILLING.SUBSCRIPTION.PAYMENT.SUCCEEDED' ||
                eventType === 'PAYMENT.CAPTURE.COMPLETED') {
                const subscriptionId = resource.billing_agreement_id ||
                    resource.id ||
                    (resource.supplementary_data && resource.supplementary_data.related_ids && resource.supplementary_data.related_ids.billing_agreement_id);
                if (subscriptionId) {
                    console.log(`[AdSubscriptions] Processing renewal for subscription: ${subscriptionId}`);
                    const subscription = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({
                        paypalSubscriptionId: subscriptionId
                    });
                    if (subscription) {
                        yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ _id: subscription._id }, {
                            $set: {
                                adsUsed: 0,
                                impressionsUsed: 0,
                                updatedAt: Date.now(),
                                status: 'active'
                            }
                        });
                        const amount = (resource.amount && (resource.amount.total || resource.amount.value)) ||
                            undefined;
                        const currency = (resource.amount && (resource.amount.currency || resource.amount.currency_code)) ||
                            undefined;
                        yield db.collection('transactions').insertOne({
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
                    }
                    else {
                        console.warn(`[AdSubscriptions] No subscription found for PayPal ID: ${subscriptionId}`);
                    }
                }
            }
            else if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
                const subscriptionId = resource.id;
                console.log(`[AdSubscriptions] Processing cancellation for subscription: ${subscriptionId}`);
                yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ paypalSubscriptionId: subscriptionId }, {
                    $set: {
                        status: 'cancelled',
                        updatedAt: Date.now()
                    }
                });
            }
            else if (eventType === 'BILLING.SUBSCRIPTION.EXPIRED' || eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
                const subscriptionId = resource.id;
                console.log(`[AdSubscriptions] Processing expiration/suspension for subscription: ${subscriptionId}`);
                yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ paypalSubscriptionId: subscriptionId }, {
                    $set: {
                        status: 'expired',
                        updatedAt: Date.now()
                    }
                });
            }
            res.status(200).json({ success: true, message: 'Webhook processed' });
        }
        catch (error) {
            console.error('[AdSubscriptions] Error processing webhook:', error);
            (0, securityLogger_1.logSecurityEvent)({
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
    })
};
