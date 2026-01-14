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
Object.defineProperty(exports, "__esModule", { value: true });
exports.adSubscriptionsController = void 0;
const db_1 = require("../db");
const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';
exports.adSubscriptionsController = {
    // GET /api/ad-subscriptions/user/:userId - Get user's ad subscriptions
    getUserSubscriptions: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            console.log('[AdSubscriptions] Fetching subscriptions for user:', userId);
            // Check if database is connected
            if (!(0, db_1.isDBConnected)()) {
                console.warn('[AdSubscriptions] Database not connected, returning empty array');
                return res.json({
                    success: true,
                    data: [],
                    message: 'Database not available'
                });
            }
            const db = (0, db_1.getDB)();
            const subscriptions = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION)
                .find({ userId })
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
            const { userId, packageId, packageName, paypalSubscriptionId, adLimit, durationDays } = req.body;
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
            yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).insertOne(newSubscription);
            res.status(201).json({
                success: true,
                data: newSubscription,
                message: 'Ad subscription created successfully'
            });
        }
        catch (error) {
            console.error('Error creating subscription:', error);
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
            const db = (0, db_1.getDB)();
            const now = Date.now();
            // Find active subscriptions that haven't expired and have available ad slots
            const activeSubscriptions = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION)
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
            yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).updateMany({
                userId,
                status: 'active',
                endDate: { $exists: true, $lte: now }
            }, {
                $set: { status: 'expired', updatedAt: now }
            });
            res.json({
                success: true,
                data: activeSubscriptions
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
    })
};
