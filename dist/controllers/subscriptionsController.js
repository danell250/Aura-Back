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
exports.subscriptionsController = void 0;
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
exports.subscriptionsController = {
    // Get user subscriptions
    getUserSubscriptions(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
                const { userId } = req.params;
                if (!authenticatedUserId) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                if (authenticatedUserId !== userId) {
                    return res.status(403).json({ error: 'Forbidden', message: 'You can only view your own subscriptions' });
                }
                const db = (0, db_1.getDB)();
                const subscriptions = yield db.collection('subscriptions')
                    .find({ userId })
                    .sort({ createdDate: -1 })
                    .toArray();
                res.json(subscriptions);
            }
            catch (error) {
                console.error('Error fetching user subscriptions:', error);
                res.status(500).json({ error: 'Failed to fetch subscriptions' });
            }
        });
    },
    // Create subscription
    createSubscription(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
                if (!authenticatedUserId) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                // Hard-disabled for production safety: this legacy flow trusted client-supplied
                // pricing and payment identifiers. Active paid plans must use /api/ad-subscriptions.
                (0, securityLogger_1.logSecurityEvent)({
                    req,
                    type: 'payment_failure',
                    userId: authenticatedUserId,
                    metadata: {
                        source: 'subscriptions_legacy',
                        reason: 'legacy_flow_disabled'
                    }
                });
                return res.status(410).json({
                    error: 'Legacy endpoint disabled',
                    message: 'Use /api/ad-subscriptions for verified subscription purchases.'
                });
            }
            catch (error) {
                console.error('Error creating subscription:', error);
                res.status(500).json({ error: 'Failed to create subscription' });
            }
        });
    },
    // Cancel subscription
    cancelSubscription(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
                const { subscriptionId } = req.params;
                if (!authenticatedUserId) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                const db = (0, db_1.getDB)();
                const subscription = yield db.collection('subscriptions').findOne({ id: subscriptionId });
                if (!subscription) {
                    return res.status(404).json({ error: 'Subscription not found' });
                }
                if (subscription.userId !== authenticatedUserId) {
                    return res.status(403).json({ error: 'Forbidden', message: 'You can only cancel your own subscriptions' });
                }
                const result = yield db.collection('subscriptions').updateOne({ id: subscriptionId, userId: authenticatedUserId }, {
                    $set: {
                        status: 'cancelled',
                        cancelledDate: new Date().toISOString()
                    }
                });
                // In a real implementation, you would also call PayPal API to cancel the subscription
                // const paypalResponse = await cancelPayPalSubscription(paypalSubscriptionId);
                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: 'Subscription not found' });
                }
                res.json({ message: 'Subscription cancelled successfully' });
            }
            catch (error) {
                console.error('Error cancelling subscription:', error);
                res.status(500).json({ error: 'Failed to cancel subscription' });
            }
        });
    },
    // Handle PayPal webhook events
    handleWebhook(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const event = req.body;
                const isValid = yield verifyPayPalWebhookSignature(req);
                if (!isValid) {
                    (0, securityLogger_1.logSecurityEvent)({
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
                const db = (0, db_1.getDB)();
                if (event && event.id) {
                    const existing = yield db.collection('paypalWebhookEvents').findOne({ id: event.id });
                    if (existing) {
                        return res.status(200).json({ message: 'Event already processed' });
                    }
                    yield db.collection('paypalWebhookEvents').insertOne({
                        id: event.id,
                        eventType: event.event_type,
                        source: 'subscriptions',
                        createdAt: new Date().toISOString()
                    });
                }
                switch (event.event_type) {
                    case 'BILLING.SUBSCRIPTION.ACTIVATED':
                        // Handle subscription activation
                        yield db.collection('subscriptions').updateOne({ paypalSubscriptionId: event.resource.id }, { $set: { status: 'active' } });
                        break;
                    case 'BILLING.SUBSCRIPTION.CANCELLED':
                        // Handle subscription cancellation
                        yield db.collection('subscriptions').updateOne({ paypalSubscriptionId: event.resource.id }, {
                            $set: {
                                status: 'cancelled',
                                cancelledDate: new Date().toISOString()
                            }
                        });
                        break;
                    case 'BILLING.SUBSCRIPTION.EXPIRED':
                        // Handle subscription expiration
                        yield db.collection('subscriptions').updateOne({ paypalSubscriptionId: event.resource.id }, { $set: { status: 'expired' } });
                        break;
                    default:
                        console.log('Unhandled webhook event:', event.event_type);
                }
                res.status(200).json({ message: 'Webhook processed successfully' });
            }
            catch (error) {
                console.error('Error processing webhook:', error);
                (0, securityLogger_1.logSecurityEvent)({
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
        });
    }
};
