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
exports.adsController = exports.emitAdAnalyticsUpdate = void 0;
const db_1 = require("../db");
const hashtagUtils_1 = require("../utils/hashtagUtils");
const identityUtils_1 = require("../utils/identityUtils");
const adPlans_1 = require("../constants/adPlans");
const adSubscriptionsController_1 = require("./adSubscriptionsController");
const crypto_1 = __importDefault(require("crypto"));
function dateKeyUTC(ts = Date.now()) {
    return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
}
function fingerprint(req) {
    var _a, _b;
    const ip = ((_b = (_a = req.headers['x-forwarded-for']) === null || _a === void 0 ? void 0 : _a.split(',')[0]) === null || _b === void 0 ? void 0 : _b.trim()) || req.ip || '';
    const ua = String(req.headers['user-agent'] || '');
    return crypto_1.default.createHash('sha256').update(`${ip}|${ua}`).digest('hex');
}
const emitAdAnalyticsUpdate = (app_1, adId_1, ownerId_1, ...args_1) => __awaiter(void 0, [app_1, adId_1, ownerId_1, ...args_1], void 0, function* (app, adId, ownerId, ownerType = 'user') {
    try {
        if (!adId || !ownerId)
            return;
        const io = (app === null || app === void 0 ? void 0 : app.get) && app.get('io');
        if (!io || typeof io.to !== 'function') {
            console.warn('⚠️ Cannot emit ad analytics update: Socket.IO (io) not found on app');
            return;
        }
        const db = (0, db_1.getDB)();
        const analytics = yield db.collection('adAnalytics').findOne({ adId });
        if (!analytics)
            return;
        console.log(`📡 Emitting live ad analytics update to ${ownerType}: ${ownerId}`);
        const payload = {
            stats: {
                adMetrics: {
                    adId: analytics.adId,
                    impressions: analytics.impressions || 0,
                    clicks: analytics.clicks || 0,
                    ctr: analytics.ctr || 0,
                    reach: analytics.reach || 0,
                    engagement: analytics.engagement || 0,
                    conversions: analytics.conversions || 0,
                    spend: analytics.spend || 0,
                    lastUpdated: analytics.lastUpdated || Date.now()
                }
            }
        };
        if (ownerType === 'company') {
            payload.companyId = ownerId;
            io.to(`company_${ownerId}`).emit('analytics_update', payload);
        }
        else {
            payload.userId = ownerId;
            io.to(ownerId).emit('analytics_update', payload);
        }
    }
    catch (err) {
        console.error('emitAdAnalyticsUpdate error', err);
    }
});
exports.emitAdAnalyticsUpdate = emitAdAnalyticsUpdate;
exports.adsController = {
    // GET /api/ads/me - Get ads for the current user
    getMyAds: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            if (!(currentUser === null || currentUser === void 0 ? void 0 : currentUser.id)) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const ownerType = req.query.ownerType || 'user';
            const ownerId = req.query.ownerId || currentUser.id;
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUser.id, { ownerType, ownerId });
            if (!actor) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'You do not have permission to view ads for this identity.'
                });
            }
            const effectiveOwnerId = actor.id;
            const effectiveOwnerType = actor.type;
            const limit = Math.min(Number(req.query.limit || 50), 200);
            const skip = Math.max(Number(req.query.skip || 0), 0);
            const ads = yield db.collection('ads')
                .find({ ownerId: effectiveOwnerId, ownerType: effectiveOwnerType })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .toArray();
            res.json({ success: true, data: ads });
        }
        catch (e) {
            console.error('getMyAds error', e);
            res.status(500).json({ success: false, error: 'Failed to load ads' });
        }
    }),
    // GET /api/ads - Get all ads
    getAllAds: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { page = 1, limit = 10, placement, status, hashtags, ownerType } = req.query;
            let { ownerId } = req.query;
            const currentUser = req.user;
            const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
            // Security hardening: Only admins can filter by arbitrary ownerId
            if (ownerId && !isAdmin) {
                // Use resolveIdentityActor to check access
                const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUser.id, {
                    ownerType: ownerType,
                    ownerId: ownerId
                });
                if (!actor) {
                    ownerId = undefined;
                }
                else {
                    ownerId = actor.id;
                }
            }
            const currentUserId = currentUser === null || currentUser === void 0 ? void 0 : currentUser.id;
            const db = (0, db_1.getDB)();
            const query = {};
            // Default behavior for public feed: show active ads only
            if (!status) {
                query.status = 'active';
            }
            else {
                query.status = status;
            }
            // Hide own ads from public feed for logged-in users
            if (currentUserId && !ownerId && !isAdmin) {
                query.ownerId = { $ne: currentUserId };
            }
            // Filter by placement if specified
            if (placement) {
                query.placement = placement;
            }
            // Filter by owner if specified (Admins or owner check above)
            if (ownerId) {
                query.ownerId = ownerId;
                if (ownerType) {
                    query.ownerType = ownerType;
                }
            }
            // Filter by hashtags if specified
            if (hashtags) {
                const searchTags = Array.isArray(hashtags) ? hashtags : [hashtags];
                query.hashtags = { $in: searchTags };
            }
            // Filter out expired ads
            const now = Date.now();
            query.$or = [
                { expiryDate: { $exists: false } },
                { expiryDate: { $gt: now } }
            ];
            // Fetch ads with aggregation for sorting and metrics
            const skip = (Number(page) - 1) * Number(limit);
            const ads = yield db.collection('ads').aggregate([
                { $match: query },
                // attach owner's active subscription (if any) 
                {
                    $lookup: {
                        from: 'adSubscriptions',
                        let: { ownerId: '$ownerId', ownerType: '$ownerType' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            {
                                                $or: [
                                                    { $and: [{ $eq: ['$ownerId', '$$ownerId'] }, { $eq: ['$ownerType', '$$ownerType'] }] },
                                                    { $and: [{ $eq: ['$userId', '$$ownerId'] }, { $eq: ['$ownerType', '$$ownerType'] }] },
                                                    // legacy support: if ownerType is user, match documents without ownerType
                                                    {
                                                        $and: [
                                                            { $eq: ['$$ownerType', 'user'] },
                                                            { $eq: ['$userId', '$$ownerId'] },
                                                            { $not: ['$ownerType'] }
                                                        ]
                                                    }
                                                ]
                                            },
                                            { $eq: ['$status', 'active'] },
                                            {
                                                $or: [
                                                    { $not: ['$endDate'] },
                                                    { $gt: ['$endDate', now] }
                                                ]
                                            }
                                        ]
                                    }
                                }
                            },
                            { $sort: { createdAt: -1 } },
                            { $limit: 1 }
                        ],
                        as: 'sub'
                    }
                },
                { $addFields: { sub: { $arrayElemAt: ['$sub', 0] } } },
                // compute tierWeight 
                {
                    $addFields: {
                        tierWeight: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$sub.packageId', 'pkg-enterprise'] }, then: 3 },
                                    { case: { $eq: ['$sub.packageId', 'pkg-pro'] }, then: 2 },
                                    { case: { $eq: ['$sub.packageId', 'pkg-starter'] }, then: 1 }
                                ],
                                default: 0
                            }
                        }
                    }
                },
                // your existing reaction sum 
                {
                    $addFields: {
                        totalReactions: {
                            $sum: {
                                $map: {
                                    input: { $objectToArray: { $ifNull: ['$reactions', {}] } },
                                    as: 'r',
                                    in: '$$r.v'
                                }
                            }
                        }
                    }
                },
                {
                    $addFields: {
                        boostWeight: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$isBoosted', true] },
                                        {
                                            $or: [
                                                { $not: ['$boostedUntil'] },
                                                { $gt: ['$boostedUntil', now] }
                                            ]
                                        }
                                    ]
                                },
                                {
                                    $add: [
                                        2000000,
                                        { $multiply: [{ $ifNull: ['$boostCredits', 50] }, 20000] }
                                    ]
                                },
                                0
                            ]
                        }
                    }
                },
                // score: tier first, then engagement, then recency 
                {
                    $addFields: {
                        signalScore: {
                            $add: [
                                { $multiply: ['$tierWeight', 1000000] },
                                '$boostWeight',
                                { $multiply: ['$totalReactions', 1000] },
                                '$timestamp'
                            ]
                        }
                    }
                },
                { $sort: { signalScore: -1 } },
                { $skip: skip },
                { $limit: Number(limit) }
            ]).toArray();
            // Add userReactions for current user
            if (currentUserId) {
                ads.forEach((ad) => {
                    if (ad.reactionUsers) {
                        ad.userReactions = Object.keys(ad.reactionUsers).filter(emoji => Array.isArray(ad.reactionUsers[emoji]) && ad.reactionUsers[emoji].includes(currentUserId));
                    }
                    else {
                        ad.userReactions = [];
                    }
                });
            }
            const total = yield db.collection('ads').countDocuments(query);
            res.json({
                success: true,
                data: ads,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / Number(limit))
                }
            });
        }
        catch (error) {
            console.error('Error fetching ads:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch ads' });
        }
    }),
    // POST /api/ads - Create a new ad
    createAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            const adData = req.body;
            if (!currentUser || !currentUser.id) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const userId = currentUser.id;
            const ownerId = adData.ownerId || userId;
            const ownerType = adData.ownerType || 'user';
            // Ensure required fields
            if (!adData.headline) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'Ad headline is required to create an ad.'
                });
            }
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(userId, { ownerType, ownerId });
            if (!actor) {
                return res.status(403).json({
                    success: false,
                    error: 'Permission denied',
                    message: 'You do not have permission to create ads for this identity.'
                });
            }
            const effectiveOwnerId = actor.id;
            const effectiveOwnerType = actor.type;
            let reservedSubscriptionId = null;
            let subscription = null;
            const now = Date.now();
            // Check subscription limits and enforce at ACTION TIME
            // Fetch active subscription for the owner (user or company)
            const subscriptionQuery = {
                status: 'active',
                $or: [
                    { endDate: { $exists: false } },
                    { endDate: { $gt: now } }
                ],
                $and: [
                    {
                        $or: [
                            { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
                            { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
                        ]
                    }
                ]
            };
            // If looking for user type, also match legacy documents without ownerType
            if (effectiveOwnerType === 'user') {
                subscriptionQuery.$and[0].$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
            }
            subscription = yield db.collection('adSubscriptions').findOne(subscriptionQuery);
            if (subscription) {
                // Ensure period is current before checking limits
                subscription = yield (0, adSubscriptionsController_1.ensureCurrentPeriod)(db, subscription);
            }
            // If no active subscription, allow creation only if they have credits? 
            // OR strictly enforce plan.
            // Based on "pkg-starter" being $39, we should require a subscription.
            if (!subscription) {
                return res.status(403).json({
                    success: false,
                    error: 'No active ad plan',
                    message: 'No active ad plan found. Please purchase a plan to create ads.'
                });
            }
            // Check active ads limit
            const plan = adPlans_1.AD_PLANS[subscription.packageId];
            const activeAdsLimit = plan ? plan.activeAdsLimit : 0;
            if (activeAdsLimit > 0) {
                const activeAdsCount = yield db.collection('ads').countDocuments({
                    ownerId: effectiveOwnerId,
                    ownerType: effectiveOwnerType,
                    status: 'active'
                });
                if (activeAdsCount >= activeAdsLimit) {
                    return res.status(403).json({
                        success: false,
                        code: 'ACTIVE_AD_LIMIT_REACHED',
                        error: 'Active ad limit reached',
                        message: `You have reached your limit of ${activeAdsLimit} active ads for your current plan. Please deactivate an existing ad or upgrade your plan.`,
                        limit: activeAdsLimit,
                        current: activeAdsCount
                    });
                }
            }
            // Check impression limit
            if (subscription.impressionsUsed >= subscription.impressionLimit) {
                return res.status(403).json({
                    success: false,
                    error: `Monthly impression limit reached (${subscription.impressionLimit}). Upgrade or wait for renewal.`,
                    limit: subscription.impressionLimit,
                    current: subscription.impressionsUsed
                });
            }
            if (subscription.adsUsed >= subscription.adLimit) {
                return res.status(403).json({
                    success: false,
                    code: 'AD_LIMIT_REACHED',
                    error: 'Ad placement limit reached for this billing cycle',
                    message: `You have used ${subscription.adsUsed} of ${subscription.adLimit} ad placements for this billing cycle.`,
                    currentUsage: subscription.adsUsed,
                    limit: subscription.adLimit,
                    resetDate: subscription.periodEnd ? new Date(subscription.periodEnd).toISOString() : undefined
                });
            }
            // Reserve one ad slot atomically so concurrent requests cannot bypass quota.
            const reserveFilter = {
                _id: subscription._id,
                status: 'active',
                adsUsed: { $lt: subscription.adLimit },
                $or: [
                    { endDate: { $exists: false } },
                    { endDate: { $gt: now } }
                ]
            };
            // Ensure we are still in the same billing window that was validated above.
            if (subscription.periodEnd) {
                reserveFilter.periodEnd = subscription.periodEnd;
            }
            const reserved = yield db.collection('adSubscriptions').findOneAndUpdate(reserveFilter, {
                $inc: { adsUsed: 1 },
                $set: { updatedAt: Date.now() }
            }, { returnDocument: 'after' });
            const reservedDoc = reserved && typeof reserved === 'object' && 'value' in reserved
                ? reserved.value
                : reserved;
            if (!reservedDoc) {
                return res.status(403).json({
                    success: false,
                    code: 'AD_LIMIT_REACHED',
                    error: 'Ad placement limit reached for this billing cycle',
                    message: 'No ad slots are currently available. Please wait for renewal or upgrade your plan.'
                });
            }
            reservedSubscriptionId = subscription.id;
            subscription = reservedDoc;
            const newAd = Object.assign(Object.assign({}, adData), { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType, ownerActiveGlow: currentUser.activeGlow, id: adData.id || `ad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, timestamp: Date.now(), reactions: {}, reactionUsers: {}, hashtags: (0, hashtagUtils_1.getHashtagsFromText)(adData.description || '') });
            try {
                yield db.collection('ads').insertOne(newAd);
                yield db.collection('adAnalytics').insertOne({
                    adId: newAd.id,
                    ownerId: newAd.ownerId,
                    ownerType: newAd.ownerType,
                    impressions: 0,
                    clicks: 0,
                    ctr: 0,
                    reach: 0,
                    engagement: 0,
                    conversions: 0,
                    spend: 0,
                    lastUpdated: Date.now()
                });
            }
            catch (error) {
                console.error('Error during ad creation transaction:', error);
                // Roll back reserved quota if insertion fails after slot reservation.
                if (reservedSubscriptionId) {
                    try {
                        yield db.collection('adSubscriptions').updateOne({
                            id: reservedSubscriptionId,
                            ownerId: effectiveOwnerId,
                            ownerType: effectiveOwnerType,
                            adsUsed: { $gt: 0 }
                        }, {
                            $inc: { adsUsed: -1 },
                            $set: { updatedAt: Date.now() }
                        });
                    }
                    catch (rollbackError) {
                        console.error('Failed to roll back reserved ad slot:', rollbackError);
                    }
                }
                throw error;
            }
            res.status(201).json({
                success: true,
                data: newAd,
                message: 'Ad created successfully',
                subscriptionUsage: subscription
                    ? {
                        adsUsed: subscription.adsUsed,
                        adLimit: subscription.adLimit,
                        resetDate: subscription.periodEnd ? new Date(subscription.periodEnd).toISOString() : undefined
                    }
                    : undefined
            });
        }
        catch (error) {
            console.error('Error creating ad:', error);
            res.status(500).json({ success: false, error: 'Failed to create ad' });
        }
    }),
    // POST /api/ads/:id/react - React to an ad
    reactToAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { reaction } = req.body;
            const currentUser = req.user;
            if (!(currentUser === null || currentUser === void 0 ? void 0 : currentUser.id))
                return res.status(401).json({ success: false, error: 'Authentication required' });
            const userId = currentUser.id;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            const reactionUsers = ad.reactionUsers || {};
            const reactions = ad.reactions || {};
            // Initialize if needed
            if (!reactionUsers[reaction])
                reactionUsers[reaction] = [];
            if (!reactions[reaction])
                reactions[reaction] = 0;
            // Toggle reaction
            const userIndex = reactionUsers[reaction].indexOf(userId);
            if (userIndex > -1) {
                // Remove reaction
                reactionUsers[reaction].splice(userIndex, 1);
                reactions[reaction] = Math.max(0, reactions[reaction] - 1);
                if (reactions[reaction] === 0)
                    delete reactions[reaction];
            }
            else {
                // Add reaction
                reactionUsers[reaction].push(userId);
                reactions[reaction]++;
            }
            yield db.collection('ads').updateOne({ id }, {
                $set: {
                    reactions,
                    reactionUsers
                }
            });
            // Calculate userReactions
            const userReactions = Object.keys(reactionUsers).filter(emoji => reactionUsers[emoji].includes(userId));
            res.json({
                success: true,
                data: {
                    reactions,
                    userReactions
                }
            });
        }
        catch (error) {
            console.error('Error reacting to ad:', error);
            res.status(500).json({ success: false, error: 'Failed to react to ad' });
        }
    }),
    // POST /api/ads/:id/boost - Boost ad reach and deduct user credits
    boostAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const { credits } = req.body;
            const db = (0, db_1.getDB)();
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
            }
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            const parsedCredits = typeof credits === 'string' ? Number(credits) : credits;
            const creditsToSpend = typeof parsedCredits === 'number' && parsedCredits > 0 ? Math.round(parsedCredits) : 50;
            const user = yield db.collection('users').findOne({ id: authenticatedUserId });
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            const currentCredits = Number(user.auraCredits || 0);
            if (currentCredits < creditsToSpend) {
                return res.status(400).json({ success: false, error: 'Insufficient credits' });
            }
            const newCredits = currentCredits - creditsToSpend;
            const creditUpdateResult = yield db.collection('users').updateOne({ id: authenticatedUserId }, {
                $set: { auraCredits: newCredits, updatedAt: new Date().toISOString() },
                $inc: { auraCreditsSpent: creditsToSpend }
            });
            if (!creditUpdateResult.matchedCount || !creditUpdateResult.modifiedCount) {
                return res.status(500).json({ success: false, error: 'Failed to update user credits' });
            }
            const now = Date.now();
            const boostedUntil = now + (72 * 60 * 60 * 1000);
            try {
                yield db.collection('ads').updateOne({ id }, {
                    $set: {
                        isBoosted: true,
                        boostedAt: now,
                        boostedUntil,
                        updatedAt: new Date().toISOString()
                    },
                    $inc: {
                        boostCredits: creditsToSpend
                    }
                });
                yield db.collection('adAnalytics').updateOne({ adId: id }, {
                    $inc: { spend: creditsToSpend },
                    $set: { lastUpdated: now }
                }, { upsert: true });
                const boostedAd = yield db.collection('ads').findOne({ id });
                if (!boostedAd) {
                    yield db.collection('users').updateOne({ id: authenticatedUserId }, {
                        $set: { auraCredits: currentCredits, updatedAt: new Date().toISOString() },
                        $inc: { auraCreditsSpent: -creditsToSpend }
                    });
                    return res.status(500).json({ success: false, error: 'Failed to boost ad' });
                }
                try {
                    yield (0, exports.emitAdAnalyticsUpdate)(req.app, id, ad.ownerId, ad.ownerType || 'user');
                }
                catch (emitError) {
                    console.error('Failed to emit ad analytics update after boost:', emitError);
                }
                return res.json({ success: true, data: boostedAd, message: 'Ad boosted successfully' });
            }
            catch (boostError) {
                yield db.collection('users').updateOne({ id: authenticatedUserId }, {
                    $set: { auraCredits: currentCredits, updatedAt: new Date().toISOString() },
                    $inc: { auraCreditsSpent: -creditsToSpend }
                });
                throw boostError;
            }
        }
        catch (error) {
            console.error('Error boosting ad:', error);
            res.status(500).json({ success: false, error: 'Failed to boost ad' });
        }
    }),
    // GET /api/ads/:id - Get ad by ID
    getAdById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            res.json({ success: true, data: ad });
        }
        catch (error) {
            console.error('Error fetching ad:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch ad' });
        }
    }),
    // PUT /api/ads/:id - Update ad
    updateAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const updates = req.body;
            const db = (0, db_1.getDB)();
            // Don't allow updating id or ownerId
            delete updates.id;
            delete updates.ownerId;
            // Don't allow updating status via updateAd (must use updateAdStatus)
            delete updates.status;
            if (typeof updates.description === 'string') {
                updates.hashtags = (0, hashtagUtils_1.getHashtagsFromText)(updates.description || '');
            }
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            const currentUser = req.user;
            const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
            if (!isAdmin) {
                if (!currentUser) {
                    return res.status(401).json({ success: false, error: 'Unauthorized' });
                }
                const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUser.id, {
                    ownerId: ad.ownerId,
                    ownerType: ad.ownerType || 'user'
                });
                if (!actor || actor.id !== ad.ownerId) {
                    return res.status(403).json({ success: false, error: 'Forbidden' });
                }
            }
            const result = yield db.collection('ads').findOneAndUpdate({ id }, { $set: updates }, { returnDocument: 'after' });
            if (!result) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            res.json({ success: true, data: result });
        }
        catch (error) {
            console.error('Error updating ad:', error);
            res.status(500).json({ success: false, error: 'Failed to update ad' });
        }
    }),
    // DELETE /api/ads/:id - Delete ad
    deleteAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            if (!currentUser || !currentUser.id) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required',
                    message: 'Please log in to delete ads'
                });
            }
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            const isAdmin = currentUser.role === 'admin' || currentUser.isAdmin === true;
            if (!isAdmin) {
                const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUser.id, {
                    ownerId: ad.ownerId,
                    ownerType: ad.ownerType || 'user'
                });
                if (!actor || actor.id !== ad.ownerId) {
                    return res.status(403).json({
                        success: false,
                        error: 'Forbidden',
                        message: 'You do not have permission to delete this ad'
                    });
                }
            }
            const result = yield db.collection('ads').deleteOne({ id });
            if (result.deletedCount === 0) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            res.json({ success: true, message: 'Ad deleted successfully' });
        }
        catch (error) {
            console.error('Error deleting ad:', error);
            res.status(500).json({ success: false, error: 'Failed to delete ad' });
        }
    }),
    // PUT /api/ads/:id/status - Update ad status
    updateAdStatus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            if (!currentUser || !currentUser.id) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            const isAdmin = currentUser.role === 'admin' || currentUser.isAdmin === true;
            if (!isAdmin) {
                const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUser.id, {
                    ownerId: ad.ownerId,
                    ownerType: ad.ownerType || 'user'
                });
                if (!actor || actor.id !== ad.ownerId) {
                    return res.status(403).json({ success: false, error: 'Forbidden' });
                }
            }
            // Enforce limits if activating
            if (status === 'active' && ad.status !== 'active') {
                // Get active subscription
                const now = Date.now();
                const effectiveOwnerId = ad.ownerId;
                const effectiveOwnerType = ad.ownerType || 'user';
                const subscriptionQuery = {
                    status: 'active',
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: { $gt: now } }
                    ],
                    $and: [
                        {
                            $or: [
                                { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
                                { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
                            ]
                        }
                    ]
                };
                // If looking for user type, also match legacy documents without ownerType
                if (effectiveOwnerType === 'user') {
                    subscriptionQuery.$and[0].$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
                }
                let subscription = yield db.collection('adSubscriptions').findOne(subscriptionQuery);
                if (subscription) {
                    // Ensure period is current before checking limits
                    subscription = yield (0, adSubscriptionsController_1.ensureCurrentPeriod)(db, subscription);
                }
                // Enforce active ads limit
                if (subscription) {
                    const plan = adPlans_1.AD_PLANS[subscription.packageId];
                    const activeAdsLimit = plan ? plan.activeAdsLimit : 0; // Default to 0 if plan not found or limit not defined
                    if (activeAdsLimit > 0) {
                        const activeAdsCount = yield db.collection('ads').countDocuments({
                            ownerId: ad.ownerId,
                            ownerType: ad.ownerType || 'user',
                            status: 'active'
                        });
                        if (activeAdsCount >= activeAdsLimit) {
                            return res.status(403).json({
                                success: false,
                                code: 'ACTIVE_AD_LIMIT_REACHED',
                                error: 'Active ad limit reached',
                                message: `You have reached your limit of ${activeAdsLimit} active ads for your current plan. Please deactivate an existing ad or upgrade your plan.`,
                                limit: activeAdsLimit,
                                current: activeAdsCount
                            });
                        }
                    }
                }
                // Check impression limit
                if (subscription && subscription.impressionsUsed >= subscription.impressionLimit) {
                    return res.status(403).json({
                        success: false,
                        error: `Monthly impression limit reached (${subscription.impressionLimit}). Upgrade or wait for renewal.`,
                        limit: subscription.impressionLimit,
                        current: subscription.impressionsUsed
                    });
                }
            }
            const result = yield db.collection('ads').findOneAndUpdate({ id }, { $set: { status } }, { returnDocument: 'after' });
            // Emit real-time update
            (0, exports.emitAdAnalyticsUpdate)(req.app, id, ad.ownerId, ad.ownerType || 'user');
            res.json({ success: true, data: result });
        }
        catch (error) {
            console.error('Error updating ad status:', error);
            res.status(500).json({ success: false, error: 'Failed to update ad status' });
        }
    }),
    getAdAnalytics: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            const currentUser = req.user;
            const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
            if (!isAdmin) {
                if (!currentUser) {
                    return res.status(401).json({ success: false, error: 'Unauthorized' });
                }
                const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUser.id, {
                    ownerId: ad.ownerId,
                    ownerType: ad.ownerType || 'user'
                });
                if (!actor || actor.id !== ad.ownerId) {
                    return res.status(403).json({
                        success: false,
                        error: 'Forbidden',
                        message: 'You do not have access to this ad analytics'
                    });
                }
            }
            const analytics = yield db.collection('adAnalytics').findOne({ adId: id });
            // Check owner subscription level
            const now = Date.now();
            const effectiveOwnerId = ad.ownerId;
            const effectiveOwnerType = ad.ownerType || 'user';
            const subscriptionQuery = {
                status: 'active',
                $or: [
                    { endDate: { $exists: false } },
                    { endDate: { $gt: now } }
                ],
                $and: [
                    {
                        $or: [
                            { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
                            { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
                        ]
                    }
                ]
            };
            // If looking for user type, also match legacy documents without ownerType
            if (effectiveOwnerType === 'user') {
                subscriptionQuery.$and[0].$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
            }
            const subscription = yield db.collection('adSubscriptions').findOne(subscriptionQuery);
            const packageId = subscription ? subscription.packageId : 'pkg-starter';
            const isBasic = packageId === 'pkg-starter';
            const isPro = packageId === 'pkg-pro';
            const isEnterprise = packageId === 'pkg-enterprise';
            const impressions = (_a = analytics === null || analytics === void 0 ? void 0 : analytics.impressions) !== null && _a !== void 0 ? _a : 0;
            const clicks = (_b = analytics === null || analytics === void 0 ? void 0 : analytics.clicks) !== null && _b !== void 0 ? _b : 0;
            const engagement = (_c = analytics === null || analytics === void 0 ? void 0 : analytics.engagement) !== null && _c !== void 0 ? _c : 0;
            const conversions = (_d = analytics === null || analytics === void 0 ? void 0 : analytics.conversions) !== null && _d !== void 0 ? _d : 0;
            const spend = (_e = analytics === null || analytics === void 0 ? void 0 : analytics.spend) !== null && _e !== void 0 ? _e : 0;
            const lastUpdated = (_f = analytics === null || analytics === void 0 ? void 0 : analytics.lastUpdated) !== null && _f !== void 0 ? _f : Date.now();
            // Calculate unique reach for the last 7 days
            const days = 7;
            const startDate = new Date();
            startDate.setUTCHours(0, 0, 0, 0);
            startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
            const dateKeys = [];
            for (let i = 0; i < days; i++) {
                const d = new Date(startDate);
                d.setUTCDate(startDate.getUTCDate() + i);
                dateKeys.push(d.toISOString().slice(0, 10));
            }
            const dailyReachDocs = yield db.collection('adAnalyticsDaily')
                .find({ adId: id, dateKey: { $in: dateKeys } })
                .toArray();
            const reach = dailyReachDocs.reduce((sum, doc) => sum + (doc.uniqueReach || 0), 0);
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const data = {
                adId: id,
                impressions,
                clicks,
                ctr,
                reach,
                engagement,
                conversions,
                spend,
                lastUpdated
            };
            if (!isBasic) {
                // data.engagement = engagement; // Always include for consistency
                // data.spend = spend; // Always include for consistency
            }
            if (isEnterprise) {
                data.audience = null; // coming soon
                data.audienceStatus = 'coming_soon';
            }
            res.json({
                success: true,
                data
            });
        }
        catch (error) {
            console.error('Error fetching ad analytics:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch ad analytics' });
        }
    }),
    getUserAdPerformance: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const ownerType = req.query.ownerType || 'user';
            const ownerId = userId; // In this route, the param is named userId but could be companyId
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
            // Security check
            if (!isAdmin) {
                if (!currentUser) {
                    return res.status(401).json({ success: false, error: 'Unauthorized' });
                }
                const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUser.id, {
                    ownerId: ownerId,
                    ownerType: ownerType
                });
                if (!actor || actor.id !== ownerId) {
                    return res.status(403).json({ success: false, error: 'Forbidden' });
                }
            }
            const ads = yield db.collection('ads').find({ ownerId, ownerType }).toArray();
            if (!ads || ads.length === 0) {
                return res.json({ success: true, data: [] });
            }
            const adIds = ads.map((ad) => ad.id);
            const analyticsDocs = yield db
                .collection('adAnalytics')
                .find({ adId: { $in: adIds } })
                .toArray();
            // Check user/company subscription level
            const now = Date.now();
            const effectiveOwnerId = ownerId;
            const effectiveOwnerType = ownerType;
            const subscriptionQuery = {
                status: 'active',
                $or: [
                    { endDate: { $exists: false } },
                    { endDate: { $gt: now } }
                ],
                $and: [
                    {
                        $or: [
                            { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
                            { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
                        ]
                    }
                ]
            };
            // If looking for user type, also match legacy documents without ownerType
            if (effectiveOwnerType === 'user') {
                subscriptionQuery.$and[0].$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
            }
            const subscription = yield db.collection('adSubscriptions').findOne(subscriptionQuery);
            const packageId = subscription ? subscription.packageId : 'pkg-starter';
            const analyticsMap = new Map();
            analyticsDocs.forEach(doc => {
                analyticsMap.set(doc.adId, doc);
            });
            const data = ads.map((ad) => {
                var _a, _b, _c, _d, _e, _f, _g;
                const analytics = analyticsMap.get(ad.id);
                const impressions = (_a = analytics === null || analytics === void 0 ? void 0 : analytics.impressions) !== null && _a !== void 0 ? _a : 0;
                const clicks = (_b = analytics === null || analytics === void 0 ? void 0 : analytics.clicks) !== null && _b !== void 0 ? _b : 0;
                const engagement = (_c = analytics === null || analytics === void 0 ? void 0 : analytics.engagement) !== null && _c !== void 0 ? _c : 0;
                const conversions = (_d = analytics === null || analytics === void 0 ? void 0 : analytics.conversions) !== null && _d !== void 0 ? _d : 0;
                const spend = (_e = analytics === null || analytics === void 0 ? void 0 : analytics.spend) !== null && _e !== void 0 ? _e : 0;
                const reach = (_f = analytics === null || analytics === void 0 ? void 0 : analytics.reach) !== null && _f !== void 0 ? _f : impressions;
                const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
                const lastUpdated = (_g = analytics === null || analytics === void 0 ? void 0 : analytics.lastUpdated) !== null && _g !== void 0 ? _g : ad.timestamp;
                return {
                    adId: ad.id,
                    adName: ad.headline,
                    status: ad.status,
                    impressions,
                    clicks,
                    ctr,
                    engagement,
                    spend,
                    reach,
                    conversions,
                    lastUpdated,
                    roi: spend > 0 ? (engagement + clicks) / spend : 0,
                    createdAt: ad.timestamp
                };
            });
            res.json({
                success: true,
                data
            });
        }
        catch (error) {
            console.error('Error fetching user ad performance:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch user ad performance' });
        }
    }),
    getCampaignPerformance: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const ownerType = req.query.ownerType || 'user';
            const ownerId = userId;
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
            // Security check
            if (!isAdmin) {
                if (!currentUser) {
                    return res.status(401).json({ success: false, error: 'Unauthorized' });
                }
                const actor = yield (0, identityUtils_1.resolveIdentityActor)(currentUser.id, {
                    ownerId: ownerId,
                    ownerType: ownerType
                });
                if (!actor || actor.id !== ownerId) {
                    return res.status(403).json({ success: false, error: 'Forbidden' });
                }
            }
            const ads = yield db.collection('ads').find({ ownerId, ownerType }).toArray();
            if (!ads || ads.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        totalImpressions: 0,
                        totalClicks: 0,
                        totalReach: 0,
                        totalEngagement: 0,
                        totalSpend: 0,
                        averageCTR: 0,
                        activeAds: 0,
                        performanceScore: 0,
                        trendData: []
                    }
                });
            }
            // Check user/company subscription level
            const now = Date.now();
            const effectiveOwnerId = ownerId;
            const effectiveOwnerType = ownerType;
            const subscriptionQuery = {
                status: 'active',
                $or: [
                    { endDate: { $exists: false } },
                    { endDate: { $gt: now } }
                ],
                $and: [
                    {
                        $or: [
                            { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
                            { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
                        ]
                    }
                ]
            };
            // If looking for user type, also match legacy documents without ownerType
            if (effectiveOwnerType === 'user') {
                subscriptionQuery.$and[0].$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
            }
            const subscription = yield db.collection('adSubscriptions').findOne(subscriptionQuery);
            const packageId = subscription ? subscription.packageId : 'pkg-starter';
            const isBasic = packageId === 'pkg-starter';
            // const isPro = packageId === 'pkg-pro';
            // const isEnterprise = packageId === 'pkg-enterprise';
            let totalImpressions = 0;
            let totalClicks = 0;
            let totalEngagement = 0;
            let totalSpend = 0;
            let totalConversions = 0;
            let activeAds = 0;
            let totalReach = 0;
            const adIds = ads.map((ad) => ad.id);
            const analyticsDocs = yield db
                .collection('adAnalytics')
                .find({ adId: { $in: adIds } })
                .toArray();
            const analyticsMap = new Map();
            analyticsDocs.forEach(doc => {
                analyticsMap.set(doc.adId, doc);
            });
            ads.forEach((ad) => {
                var _a, _b, _c, _d, _e, _f, _g;
                if (ad.status === 'active')
                    activeAds++;
                const analytics = analyticsMap.get(ad.id);
                if (analytics) {
                    totalImpressions += ((_a = analytics.impressions) !== null && _a !== void 0 ? _a : 0);
                    totalClicks += ((_b = analytics.clicks) !== null && _b !== void 0 ? _b : 0);
                    // Include all metrics regardless of plan for now to ensure data visibility
                    // We can enforce strict plan limits later if needed
                    totalEngagement += ((_c = analytics.engagement) !== null && _c !== void 0 ? _c : 0);
                    totalSpend += ((_d = analytics.spend) !== null && _d !== void 0 ? _d : 0);
                    totalConversions += ((_e = analytics.conversions) !== null && _e !== void 0 ? _e : 0);
                    totalReach += ((_g = (_f = analytics.reach) !== null && _f !== void 0 ? _f : analytics.impressions) !== null && _g !== void 0 ? _g : 0);
                }
            });
            const averageCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
            // Calculate a performance score (0-100)
            // Weighted: 30% CTR, 30% Engagement Rate, 40% active/fresh factor
            const ctrScore = Math.min(100, (averageCTR / 2) * 100); // 2% CTR = 100 score
            let performanceScore = 0;
            if (isBasic) {
                // For basic plan, weight: 50% CTR, 50% active/fresh
                performanceScore = Math.round((ctrScore * 0.5) + (Math.min(100, activeAds * 20) * 0.5));
            }
            else {
                const engRate = totalImpressions > 0 ? totalEngagement / totalImpressions : 0;
                const engScore = Math.min(100, (engRate / 0.05) * 100); // 5% engagement = 100 score
                performanceScore = Math.round((ctrScore * 0.3) + (engScore * 0.3) + (Math.min(100, activeAds * 20) * 0.4));
            }
            const daysToNextExpiry = (subscription === null || subscription === void 0 ? void 0 : subscription.endDate)
                ? Math.ceil((subscription.endDate - now) / (1000 * 60 * 60 * 24))
                : null;
            const build7DayTrend = (ownerId, ownerType) => __awaiter(void 0, void 0, void 0, function* () {
                const days = 7;
                const start = new Date();
                start.setUTCHours(0, 0, 0, 0);
                start.setUTCDate(start.getUTCDate() - (days - 1));
                const keys = [];
                for (let i = 0; i < days; i++) {
                    const d = new Date(start);
                    d.setUTCDate(start.getUTCDate() + i);
                    keys.push(d.toISOString().slice(0, 10));
                }
                const docs = yield db.collection('adAnalyticsDaily')
                    .find({ ownerId, ownerType, dateKey: { $in: keys } })
                    .toArray();
                const map = new Map();
                for (const k of keys) {
                    const d = new Date(`${k}T00:00:00.000Z`);
                    map.set(k, {
                        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        impressions: 0,
                        clicks: 0,
                        engagement: 0,
                        spend: 0
                    });
                }
                for (const doc of docs) {
                    const row = map.get(doc.dateKey);
                    if (!row)
                        continue;
                    row.impressions += doc.impressions || 0;
                    row.clicks += doc.clicks || 0;
                    row.engagement += doc.engagement || 0;
                    row.spend += doc.spend || 0;
                }
                return Array.from(map.values());
            });
            const trendData = yield build7DayTrend(ownerId, ownerType);
            const data = {
                totalImpressions,
                totalClicks,
                totalReach,
                totalEngagement,
                totalSpend,
                totalConversions,
                averageCTR,
                activeAds,
                daysToNextExpiry,
                performanceScore,
                trendData
            };
            res.json({
                success: true,
                data
            });
        }
        catch (error) {
            console.error('Error fetching campaign performance:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch campaign performance' });
        }
    }),
    trackImpression: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const now = Date.now();
            const todayKey = dateKeyUTC(now);
            const userFingerprint = fingerprint(req);
            // 1. Get Ad to find owner and current status
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            // Only track impressions for active ads
            if (ad.status !== 'active') {
                return res.status(200).json({ success: true, message: 'Ad not active, impression not tracked.' });
            }
            // 2. Get Ad Owner's Subscription
            const effectiveOwnerId = ad.ownerId;
            const effectiveOwnerType = ad.ownerType || 'user';
            const subscriptionQuery = {
                status: 'active',
                $or: [
                    { endDate: { $exists: false } },
                    { endDate: { $gt: now } }
                ],
                $and: [
                    {
                        $or: [
                            { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
                            { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
                        ]
                    }
                ]
            };
            // If looking for user type, also match legacy documents without ownerType
            if (effectiveOwnerType === 'user') {
                subscriptionQuery.$and[0].$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
            }
            let subscription = yield db.collection('adSubscriptions').findOne(subscriptionQuery);
            if (!subscription) {
                return res.status(200).json({ success: true, message: 'No active subscription for ad owner, impression not tracked.' });
            }
            // Ensure subscription period is current (resets usage if new month)
            subscription = yield (0, adSubscriptionsController_1.ensureCurrentPeriod)(db, subscription);
            if (!subscription) {
                return res.status(200).json({ success: true, message: 'Subscription check failed, impression not tracked.' });
            }
            const plan = adPlans_1.AD_PLANS[subscription.packageId];
            if (!plan) {
                console.warn(`⚠️ Ad plan not found for packageId: ${subscription.packageId}`);
                return res.status(200).json({ success: true, message: 'Ad plan not found, impression not tracked.' });
            }
            // 3. Check Impression Limit (overall)
            if (subscription.impressionsUsed >= plan.impressionLimit) {
                return res.status(403).json({
                    success: false,
                    code: 'IMPRESSION_LIMIT_REACHED',
                    error: `Monthly impression limit reached (${plan.impressionLimit}). Upgrade or wait for renewal.`,
                    limit: plan.impressionLimit,
                    current: subscription.impressionsUsed
                });
            }
            // 4. Deduplicate Impressions (per day, per user fingerprint)
            const dedupKey = `${id}-${todayKey}-${userFingerprint}`;
            const existingDedupe = yield db.collection('adEventDedupes').findOne({ key: dedupKey });
            if (existingDedupe) {
                return res.status(200).json({ success: true, message: 'Duplicate impression, not tracked.' });
            }
            // Record deduplication key
            yield db.collection('adEventDedupes').insertOne({
                key: dedupKey,
                adId: id,
                ownerId: ad.ownerId,
                ownerType: ad.ownerType || 'user',
                dateKey: todayKey,
                fingerprint: userFingerprint,
                timestamp: now,
                expiresAt: new Date(now + 24 * 60 * 60 * 1000) // Expires in 24 hours
            });
            // Increment uniqueReach in adAnalyticsDaily
            yield db.collection('adAnalyticsDaily').updateOne({ adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: todayKey }, { $inc: { uniqueReach: 1 } }, { upsert: true });
            // 5. Determine Cost Per Impression (CPI)
            let cpi = 0;
            if (plan.impressionLimit > 0 && plan.numericPrice) {
                cpi = plan.numericPrice / plan.impressionLimit;
            }
            // 6. Atomically Update Ad Analytics and Subscription Usage
            // Update adAnalytics
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $inc: {
                    impressions: 1,
                    spend: cpi
                },
                $set: {
                    lastUpdated: now,
                    ownerId: ad.ownerId,
                    ownerType: ad.ownerType || 'user'
                }
            }, { upsert: true });
            // Update adSubscription impressionsUsed
            yield db.collection('adSubscriptions').updateOne({ _id: subscription._id }, // Use _id for direct document update
            { $inc: { impressionsUsed: 1 }, $set: { updatedAt: now } });
            // 7. Update Daily Rollup (for trends and accurate CTR calculation)
            yield db.collection('adDailyRollups').updateOne({ adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: todayKey }, {
                $inc: { impressions: 1 },
                $set: { lastUpdated: now }
            }, { upsert: true });
            // 8. Recalculate CTR (optional, can be done in a separate job or on analytics fetch)
            // For now, we'll update it directly here for immediate accuracy
            const updatedAnalytics = yield db.collection('adAnalytics').findOne({ adId: id });
            if (updatedAnalytics && updatedAnalytics.impressions > 0) {
                const newCtr = (updatedAnalytics.clicks / updatedAnalytics.impressions) * 100;
                yield db.collection('adAnalytics').updateOne({ adId: id }, { $set: { ctr: newCtr, lastUpdated: now } });
            }
            // Emit real-time update
            (0, exports.emitAdAnalyticsUpdate)(req.app, id, ad.ownerId, ad.ownerType || 'user');
            res.json({ success: true, message: 'Impression tracked successfully.' });
        }
        catch (error) {
            console.error('Error tracking impression:', error);
            res.status(500).json({ success: false, error: 'Failed to track impression' });
        }
    }),
    trackClick: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad)
                return res.status(404).json({ success: false, error: 'Ad not found' });
            const now = Date.now();
            const dKey = dateKeyUTC(now);
            const fp = fingerprint(req);
            const dedupe = yield db.collection('adEventDedupes').updateOne({ adId: id, eventType: 'click', fingerprint: fp, dateKey: dKey }, { $setOnInsert: { adId: id, ownerId: ad.ownerId, eventType: 'click', fingerprint: fp, dateKey: dKey, createdAt: now } }, { upsert: true });
            if (dedupe.upsertedCount === 0)
                return res.json({ success: true, deduped: true });
            yield db.collection('adAnalytics').updateOne({ adId: id }, [
                { $set: { clicks: { $add: [{ $ifNull: ['$clicks', 0] }, 1] }, lastUpdated: now } },
                {
                    $set: {
                        ctr: {
                            $cond: [
                                { $gt: ['$impressions', 0] },
                                { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] },
                                0
                            ]
                        }
                    }
                }
            ], { upsert: true });
            yield db.collection('adAnalyticsDaily').updateOne({ adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: dKey }, { $inc: { clicks: 1 }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
            // Emit real-time update
            (0, exports.emitAdAnalyticsUpdate)(req.app, id, ad.ownerId, ad.ownerType || 'user');
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error tracking click:', error);
            res.status(500).json({ success: false, error: 'Failed to track click' });
        }
    }),
    trackEngagement: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { engagementType } = req.body;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad)
                return res.status(404).json({ success: false, error: 'Ad not found' });
            const now = Date.now();
            const dKey = dateKeyUTC(now);
            const fp = fingerprint(req);
            // dedupe engagement per day per type
            const dedupe = yield db.collection('adEventDedupes').updateOne({ adId: id, eventType: `engagement:${engagementType || 'unknown'}`, fingerprint: fp, dateKey: dKey }, { $setOnInsert: { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', eventType: `engagement:${engagementType || 'unknown'}`, fingerprint: fp, dateKey: dKey, createdAt: now } }, { upsert: true });
            if (dedupe.upsertedCount === 0) {
                return res.json({ success: true, deduped: true });
            }
            const inc = { engagement: 1 };
            if (engagementType)
                inc[`engagementByType.${engagementType}`] = 1;
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $inc: inc,
                $set: {
                    lastUpdated: now,
                    ownerId: ad.ownerId,
                    ownerType: ad.ownerType || 'user'
                }
            }, { upsert: true });
            yield db.collection('adAnalyticsDaily').updateOne({ adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: dKey }, { $inc: Object.assign({ engagement: 1 }, (engagementType ? { [`engagementByType.${engagementType}`]: 1 } : {})), $set: { updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
            // Emit real-time update
            (0, exports.emitAdAnalyticsUpdate)(req.app, id, ad.ownerId, ad.ownerType || 'user');
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error tracking engagement:', error);
            res.status(500).json({ success: false, error: 'Failed to track engagement' });
        }
    }),
    trackConversion: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad)
                return res.status(404).json({ success: false, error: 'Ad not found' });
            const now = Date.now();
            const dKey = dateKeyUTC(now);
            const fp = fingerprint(req);
            const dedupe = yield db.collection('adEventDedupes').updateOne({ adId: id, eventType: 'conversion', fingerprint: fp, dateKey: dKey }, { $setOnInsert: { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', eventType: 'conversion', fingerprint: fp, dateKey: dKey, createdAt: now } }, { upsert: true });
            if (dedupe.upsertedCount === 0)
                return res.json({ success: true, deduped: true });
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $inc: { conversions: 1 },
                $set: {
                    lastUpdated: now,
                    ownerId: ad.ownerId,
                    ownerType: ad.ownerType || 'user'
                }
            }, { upsert: true });
            yield db.collection('adAnalyticsDaily').updateOne({ adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: dKey }, { $inc: { conversions: 1 }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
            // Emit real-time update
            (0, exports.emitAdAnalyticsUpdate)(req.app, id, ad.ownerId, ad.ownerType || 'user');
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error tracking conversion:', error);
            res.status(500).json({ success: false, error: 'Failed to track conversion' });
        }
    })
};
