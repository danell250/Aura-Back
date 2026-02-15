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
const identityUtils_1 = require("../utils/identityUtils");
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
const parseOwnerType = (value) => {
    if (value === undefined || value === null || value === '')
        return 'user';
    if (value === 'user' || value === 'company')
        return value;
    return null;
};
const buildOwnerScope = (ownerId, ownerType) => {
    const clauses = [
        { ownerId, ownerType },
        { userId: ownerId, ownerType } // backward compatibility
    ];
    if (ownerType === 'user') {
        clauses.push({ userId: ownerId, ownerType: { $exists: false } });
    }
    return { $or: clauses };
};
const getSubscriptionOwner = (subscription) => {
    const ownerId = typeof (subscription === null || subscription === void 0 ? void 0 : subscription.ownerId) === 'string' && subscription.ownerId
        ? subscription.ownerId
        : (typeof (subscription === null || subscription === void 0 ? void 0 : subscription.userId) === 'string' ? subscription.userId : '');
    if (!ownerId)
        return null;
    const ownerType = (subscription === null || subscription === void 0 ? void 0 : subscription.ownerType) === 'company' ? 'company' : 'user';
    return { ownerId, ownerType };
};
exports.adSubscriptionsController = {
    // GET /api/ad-subscriptions/user/:userId - Get user's ad subscriptions
    getUserSubscriptions: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
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
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
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
            const db = (0, db_1.getDB)();
            const query = buildOwnerScope(actor.id, actor.type);
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
        var _a, _b, _c;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }
            const payload = (req.body && typeof req.body === 'object')
                ? req.body
                : {};
            const userId = typeof payload.userId === 'string' ? payload.userId : undefined;
            const packageId = typeof payload.packageId === 'string' ? payload.packageId.trim() : '';
            const ownerType = parseOwnerType(payload.ownerType);
            const paypalSubscriptionId = typeof payload.paypalSubscriptionId === 'string'
                ? payload.paypalSubscriptionId.trim()
                : '';
            const paypalOrderId = typeof payload.paypalOrderId === 'string'
                ? payload.paypalOrderId.trim()
                : '';
            if (!ownerType) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid ownerType. Use "user" or "company".'
                });
            }
            const requestedOwnerId = userId && userId.trim() ? userId : authenticatedUserId;
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedOwnerId
            });
            if (!actor || actor.id !== requestedOwnerId || actor.type !== ownerType) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'Unauthorized to create subscription for this identity'
                });
            }
            if (!packageId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'packageId is required'
                });
            }
            const plan = adPlans_1.AD_PLANS[packageId];
            if (!plan) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid package',
                    message: `Unknown ad package: ${packageId}`
                });
            }
            const isRecurringPlan = plan.paymentType === 'subscription';
            if (isRecurringPlan && !paypalSubscriptionId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing payment proof',
                    message: 'paypalSubscriptionId is required for recurring plans'
                });
            }
            if (!isRecurringPlan && !paypalOrderId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing payment proof',
                    message: 'paypalOrderId is required for one-time plans'
                });
            }
            const paymentReferenceKey = isRecurringPlan
                ? `paypal_subscription:${paypalSubscriptionId}`
                : `paypal_order:${paypalOrderId}`;
            const db = (0, db_1.getDB)();
            const existingPayment = yield db.collection('transactions').findOne({
                type: 'ad_subscription',
                paymentReferenceKey
            });
            if (existingPayment) {
                return res.status(409).json({
                    success: false,
                    error: 'Duplicate transaction',
                    message: 'This ad subscription payment was already processed'
                });
            }
            const existingSubscription = isRecurringPlan
                ? yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ paypalSubscriptionId })
                : yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ paypalOrderId });
            if (existingSubscription) {
                return res.status(409).json({
                    success: false,
                    error: 'Duplicate subscription',
                    message: 'A subscription already exists for this payment reference'
                });
            }
            const apiBase = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
            const clientId = process.env.PAYPAL_CLIENT_ID;
            const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
            if (!clientId || !clientSecret) {
                (0, securityLogger_1.logSecurityEvent)({
                    req,
                    type: 'payment_failure',
                    userId: actor.id,
                    metadata: {
                        source: 'ad_subscriptions',
                        reason: 'missing_paypal_credentials',
                        packageId
                    }
                });
                return res.status(500).json({
                    success: false,
                    error: 'Payment configuration error',
                    message: 'PayPal credentials not configured'
                });
            }
            const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            let accessToken;
            try {
                const tokenResponse = yield axios_1.default.post(`${apiBase}/v1/oauth2/token`, 'grant_type=client_credentials', {
                    headers: {
                        Authorization: `Basic ${basicAuth}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });
                accessToken = tokenResponse.data.access_token;
            }
            catch (tokenError) {
                console.error('[AdSubscriptions] Failed to obtain PayPal access token:', tokenError);
                return res.status(502).json({
                    success: false,
                    error: 'Payment verification failed',
                    message: 'Unable to verify PayPal payment credentials'
                });
            }
            let verifiedAmountUsd = null;
            let verifiedCaptureId = null;
            let verifiedPlanId = null;
            if (isRecurringPlan) {
                try {
                    const subscriptionResponse = yield axios_1.default.get(`${apiBase}/v1/billing/subscriptions/${paypalSubscriptionId}`, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`
                        }
                    });
                    const subscription = subscriptionResponse.data;
                    const subscriptionStatus = typeof (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'string' ? subscription.status : '';
                    const allowedStatuses = new Set(['ACTIVE', 'APPROVAL_PENDING']);
                    if (!allowedStatuses.has(subscriptionStatus)) {
                        return res.status(400).json({
                            success: false,
                            error: 'Subscription not active',
                            message: `PayPal subscription status is ${subscriptionStatus || 'UNKNOWN'}`
                        });
                    }
                    verifiedPlanId = typeof (subscription === null || subscription === void 0 ? void 0 : subscription.plan_id) === 'string' ? subscription.plan_id : null;
                    const expectedSubscriptionPlanId = 'subscriptionPlanId' in plan && typeof plan.subscriptionPlanId === 'string'
                        ? plan.subscriptionPlanId
                        : null;
                    if (expectedSubscriptionPlanId && verifiedPlanId !== expectedSubscriptionPlanId) {
                        (0, securityLogger_1.logSecurityEvent)({
                            req,
                            type: 'payment_failure',
                            userId: actor.id,
                            metadata: {
                                source: 'ad_subscriptions',
                                reason: 'paypal_plan_mismatch',
                                expectedPlanId: expectedSubscriptionPlanId,
                                actualPlanId: verifiedPlanId,
                                packageId
                            }
                        });
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid PayPal plan',
                            message: 'PayPal subscription does not match the selected package'
                        });
                    }
                }
                catch (verificationError) {
                    console.error('[AdSubscriptions] Failed to verify PayPal subscription:', verificationError);
                    return res.status(502).json({
                        success: false,
                        error: 'Payment verification failed',
                        message: 'Unable to verify PayPal subscription'
                    });
                }
            }
            else {
                try {
                    const orderResponse = yield axios_1.default.get(`${apiBase}/v2/checkout/orders/${paypalOrderId}`, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`
                        }
                    });
                    const order = orderResponse.data;
                    if (!order || order.status !== 'COMPLETED') {
                        return res.status(400).json({
                            success: false,
                            error: 'Payment not completed',
                            message: 'PayPal order is not completed'
                        });
                    }
                    const purchaseUnits = Array.isArray(order.purchase_units) ? order.purchase_units : [];
                    const firstUnit = purchaseUnits[0];
                    const amount = firstUnit === null || firstUnit === void 0 ? void 0 : firstUnit.amount;
                    const currency = typeof (amount === null || amount === void 0 ? void 0 : amount.currency_code) === 'string' ? amount.currency_code : '';
                    const rawAmount = typeof (amount === null || amount === void 0 ? void 0 : amount.value) === 'string' ? amount.value : '';
                    const paidAmount = parseFloat(rawAmount);
                    if (currency !== 'USD') {
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid payment currency',
                            message: 'PayPal payment must be in USD'
                        });
                    }
                    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - plan.numericPrice) > 0.01) {
                        (0, securityLogger_1.logSecurityEvent)({
                            req,
                            type: 'payment_failure',
                            userId: actor.id,
                            metadata: {
                                source: 'ad_subscriptions',
                                reason: 'amount_mismatch',
                                packageId,
                                paidAmount,
                                expectedAmount: plan.numericPrice
                            }
                        });
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid payment amount',
                            message: 'PayPal payment amount does not match selected package'
                        });
                    }
                    const captures = Array.isArray((_b = firstUnit === null || firstUnit === void 0 ? void 0 : firstUnit.payments) === null || _b === void 0 ? void 0 : _b.captures) ? firstUnit.payments.captures : [];
                    const completedCapture = captures.find((capture) => capture && capture.status === 'COMPLETED');
                    verifiedCaptureId = completedCapture && typeof completedCapture.id === 'string'
                        ? completedCapture.id
                        : null;
                    verifiedAmountUsd = paidAmount;
                }
                catch (verificationError) {
                    console.error('[AdSubscriptions] Failed to verify PayPal order:', verificationError);
                    return res.status(502).json({
                        success: false,
                        error: 'Payment verification failed',
                        message: 'Unable to verify PayPal order payment'
                    });
                }
            }
            const now = Date.now();
            const durationDays = typeof plan.durationDays === 'number' && plan.durationDays > 0 ? plan.durationDays : 30;
            const recurringBillingEnd = now + BILLING_MS;
            const nextBillingDate = isRecurringPlan ? recurringBillingEnd : undefined;
            const endDate = isRecurringPlan
                ? recurringBillingEnd
                : now + (durationDays * 24 * 60 * 60 * 1000);
            const periodStart = now;
            const periodEnd = now + (durationDays * 24 * 60 * 60 * 1000);
            const newSubscription = {
                id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                userId: actor.id, // Legacy field
                ownerId: actor.id, // New standardized field
                ownerType: actor.type,
                packageId: plan.id,
                packageName: plan.name,
                status: 'active',
                startDate: now,
                durationDays,
                endDate,
                nextBillingDate,
                paypalSubscriptionId: isRecurringPlan ? paypalSubscriptionId : null,
                paypalOrderId: isRecurringPlan ? null : paypalOrderId,
                paymentReferenceKey,
                periodStart,
                periodEnd,
                adsUsed: 0,
                impressionsUsed: 0,
                adLimit: plan.adLimit,
                impressionLimit: plan.impressionLimit,
                createdAt: now,
                updatedAt: now
            };
            try {
                yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).insertOne(newSubscription);
            }
            catch (insertError) {
                if (insertError && insertError.code === 11000) {
                    return res.status(409).json({
                        success: false,
                        error: 'Duplicate subscription',
                        message: 'A subscription for this payment reference already exists'
                    });
                }
                throw insertError;
            }
            const transactionId = isRecurringPlan
                ? paypalSubscriptionId
                : (verifiedCaptureId || paypalOrderId);
            try {
                yield db.collection('transactions').insertOne({
                    userId: actor.id,
                    ownerId: actor.id,
                    ownerType: actor.type,
                    type: 'ad_subscription',
                    packageId: plan.id,
                    packageName: plan.name,
                    transactionId,
                    paymentMethod: isRecurringPlan ? 'paypal_subscription' : 'paypal_order',
                    paymentReferenceKey,
                    status: 'completed',
                    details: {
                        adLimit: plan.adLimit,
                        durationDays,
                        subscriptionId: newSubscription.id,
                        paypalOrderId: isRecurringPlan ? null : paypalOrderId,
                        paypalSubscriptionId: isRecurringPlan ? paypalSubscriptionId : null,
                        verifiedCaptureId,
                        verifiedPlanId,
                        verifiedAmountUsd
                    },
                    createdAt: now
                });
            }
            catch (txInsertError) {
                if (txInsertError && txInsertError.code === 11000) {
                    return res.status(409).json({
                        success: false,
                        error: 'Duplicate transaction',
                        message: 'This ad subscription payment was already processed'
                    });
                }
                throw txInsertError;
            }
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
                userId: ((_c = req.user) === null || _c === void 0 ? void 0 : _c.id) || (req.body && req.body.userId),
                metadata: {
                    source: 'ad_subscriptions',
                    reason: 'create_subscription_exception',
                    packageId: req.body && req.body.packageId,
                    paypalOrderId: req.body && req.body.paypalOrderId,
                    paypalSubscriptionId: req.body && req.body.paypalSubscriptionId,
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
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }
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
            const owner = getSubscriptionOwner(subscription);
            if (!owner) {
                return res.status(500).json({
                    success: false,
                    error: 'Subscription ownership metadata is invalid'
                });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, owner);
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
                yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ id }, { $set: { status: 'expired', updatedAt: Date.now() } });
                return res.status(400).json({
                    success: false,
                    error: 'Subscription has expired'
                });
            }
            // Increment ads used
            const result = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ id, ownerId: owner.ownerId, ownerType: owner.ownerType }, {
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
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const subscription = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });
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
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, owner);
            if (!actor || actor.id !== owner.ownerId || actor.type !== owner.ownerType) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'Unauthorized to cancel this subscription'
                });
            }
            const result = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ id, ownerId: owner.ownerId, ownerType: owner.ownerType }, {
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
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
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
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
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
                    buildOwnerScope(actor.id, actor.type)
                ]
            };
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
            const expireQuery = Object.assign({ status: 'active', endDate: { $exists: true, $lte: now } }, buildOwnerScope(actor.id, actor.type));
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
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const subscription = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({ id });
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
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, owner);
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
                        const renewalNow = Date.now();
                        const renewalDays = subscription.durationDays || 30;
                        const nextBillingDate = renewalNow + (30 * 24 * 60 * 60 * 1000);
                        const nextPeriodEnd = renewalNow + (renewalDays * 24 * 60 * 60 * 1000);
                        yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateOne({ _id: subscription._id }, {
                            $set: {
                                adsUsed: 0,
                                impressionsUsed: 0,
                                periodStart: renewalNow,
                                periodEnd: nextPeriodEnd,
                                nextBillingDate,
                                endDate: nextBillingDate,
                                updatedAt: renewalNow,
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
