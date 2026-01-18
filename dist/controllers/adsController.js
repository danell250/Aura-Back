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
exports.adsController = void 0;
const db_1 = require("../db");
const hashtagUtils_1 = require("../utils/hashtagUtils");
exports.adsController = {
    // GET /api/ads - Get all ads
    getAllAds: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { page = 1, limit = 10, placement, status, ownerId, hashtags } = req.query;
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const db = (0, db_1.getDB)();
            const query = {};
            // Filter by placement if specified
            if (placement) {
                query.placement = placement;
            }
            // Filter by status if specified
            if (status) {
                query.status = status;
            }
            // Filter by owner if specified
            if (ownerId) {
                query.ownerId = ownerId;
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
            const skip = (Number(page) - 1) * Number(limit);
            const ads = yield db.collection('ads')
                .find(query)
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(Number(limit))
                .toArray();
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
            // Ensure required fields
            if (!adData.headline) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }
            if (adData.ownerId && adData.ownerId !== userId) {
                return res.status(403).json({
                    success: false,
                    error: 'Owner mismatch',
                    message: 'ownerId must match the authenticated user'
                });
            }
            const isSpecialUser = adData.ownerEmail &&
                adData.ownerEmail.toLowerCase() === 'danelloosthuizen3@gmail.com';
            let reservedSubscriptionId = null;
            let subscription = null;
            const now = Date.now();
            // Check subscription limits and reserve slot atomically if subscriptionId is provided and not special user
            if (adData.subscriptionId && !isSpecialUser) {
                subscription = yield db.collection('adSubscriptions').findOne({
                    id: adData.subscriptionId
                });
                if (!subscription) {
                    return res.status(404).json({
                        success: false,
                        error: 'Subscription not found'
                    });
                }
                if (subscription.userId !== userId) {
                    return res.status(403).json({
                        success: false,
                        error: 'Subscription does not belong to the authenticated user'
                    });
                }
                if (subscription.status !== 'active') {
                    return res.status(400).json({
                        success: false,
                        error: 'Subscription is not active'
                    });
                }
                // Check if subscription has expired
                if (subscription.endDate && now > subscription.endDate) {
                    yield db.collection('adSubscriptions').updateOne({ id: subscription.id }, {
                        $set: {
                            status: 'expired',
                            updatedAt: now
                        }
                    });
                    return res.status(400).json({
                        success: false,
                        error: 'Subscription has expired'
                    });
                }
                const reserve = yield db.collection('adSubscriptions').updateOne(Object.assign(Object.assign({ id: subscription.id, userId, status: 'active' }, (subscription.endDate ? { endDate: { $gt: now } } : {})), { $expr: { $lt: ['$adsUsed', '$adLimit'] } }), {
                    $inc: { adsUsed: 1 },
                    $set: { updatedAt: now }
                });
                if (reserve.matchedCount === 0) {
                    return res.status(400).json({
                        success: false,
                        error: `Ad limit reached. You can create ${subscription.adLimit} ads with this plan.`,
                        limit: subscription.adLimit,
                        used: subscription.adsUsed
                    });
                }
                reservedSubscriptionId = subscription.id;
            }
            const newAd = Object.assign(Object.assign({}, adData), { ownerId: userId, id: adData.id || `ad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, timestamp: Date.now(), reactions: {}, reactionUsers: {}, hashtags: (0, hashtagUtils_1.getHashtagsFromText)(adData.description || '') });
            try {
                yield db.collection('ads').insertOne(newAd);
                yield db.collection('adAnalytics').insertOne({
                    adId: newAd.id,
                    ownerId: newAd.ownerId,
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
                if (reservedSubscriptionId) {
                    yield db.collection('adSubscriptions').updateOne({ id: reservedSubscriptionId }, {
                        $inc: { adsUsed: -1 },
                        $set: { updatedAt: Date.now() }
                    });
                }
                throw error;
            }
            res.status(201).json({
                success: true,
                data: newAd,
                message: 'Ad created successfully'
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
            const { reaction, userId } = req.body;
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
            if (typeof updates.description === 'string') {
                updates.hashtags = (0, hashtagUtils_1.getHashtagsFromText)(updates.description || '');
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
            if (!isAdmin && ad.ownerId !== currentUser.id) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'You can only delete your own ads'
                });
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
            const result = yield db.collection('ads').findOneAndUpdate({ id }, { $set: { status } }, { returnDocument: 'after' });
            if (!result) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            res.json({ success: true, data: result });
        }
        catch (error) {
            console.error('Error updating ad status:', error);
            res.status(500).json({ success: false, error: 'Failed to update ad status' });
        }
    }),
    getAdAnalytics: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            const currentUser = req.user;
            const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
            if (!isAdmin && (!currentUser || currentUser.id !== ad.ownerId)) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'You do not have access to this ad analytics'
                });
            }
            const analytics = yield db.collection('adAnalytics').findOne({ adId: id });
            const impressions = (analytics === null || analytics === void 0 ? void 0 : analytics.impressions) || 0;
            const clicks = (analytics === null || analytics === void 0 ? void 0 : analytics.clicks) || 0;
            const engagement = (analytics === null || analytics === void 0 ? void 0 : analytics.engagement) || 0;
            const conversions = (analytics === null || analytics === void 0 ? void 0 : analytics.conversions) || 0;
            const spend = (analytics === null || analytics === void 0 ? void 0 : analytics.spend) || 0;
            const reach = (analytics === null || analytics === void 0 ? void 0 : analytics.reach) || impressions;
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const lastUpdated = (analytics === null || analytics === void 0 ? void 0 : analytics.lastUpdated) || Date.now();
            res.json({
                success: true,
                data: {
                    adId: id,
                    impressions,
                    clicks,
                    ctr,
                    reach,
                    engagement,
                    conversions,
                    spend,
                    lastUpdated
                }
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
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
            if (!isAdmin && (!currentUser || currentUser.id !== userId)) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'You can only view analytics for your own ads'
                });
            }
            const ads = yield db.collection('ads').find({ ownerId: userId }).toArray();
            if (!ads || ads.length === 0) {
                return res.json({ success: true, data: [] });
            }
            const adIds = ads.map((ad) => ad.id);
            const analyticsDocs = yield db
                .collection('adAnalytics')
                .find({ adId: { $in: adIds } })
                .toArray();
            const analyticsMap = new Map();
            analyticsDocs.forEach(doc => {
                analyticsMap.set(doc.adId, doc);
            });
            const metrics = ads.map((ad) => {
                const analytics = analyticsMap.get(ad.id) || {};
                const impressions = analytics.impressions || 0;
                const clicks = analytics.clicks || 0;
                const engagement = analytics.engagement || 0;
                const spend = analytics.spend || 0;
                const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
                const roi = spend > 0 ? (engagement + clicks) / spend : 0;
                return {
                    adId: ad.id,
                    adName: ad.headline || ad.title || 'Untitled Ad',
                    status: ad.status || 'active',
                    impressions,
                    clicks,
                    ctr,
                    engagement,
                    spend,
                    roi,
                    createdAt: ad.timestamp || Date.now()
                };
            });
            res.json({
                success: true,
                data: metrics
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
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
            if (!isAdmin && (!currentUser || currentUser.id !== userId)) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'You can only view campaign analytics for your own ads'
                });
            }
            const ads = yield db.collection('ads').find({ ownerId: userId }).toArray();
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
            const adIds = ads.map((ad) => ad.id);
            const analyticsDocs = yield db
                .collection('adAnalytics')
                .find({ adId: { $in: adIds } })
                .toArray();
            let totalImpressions = 0;
            let totalClicks = 0;
            let totalEngagement = 0;
            let totalSpend = 0;
            analyticsDocs.forEach(doc => {
                totalImpressions += doc.impressions || 0;
                totalClicks += doc.clicks || 0;
                totalEngagement += doc.engagement || 0;
                totalSpend += doc.spend || 0;
            });
            const totalReach = totalImpressions;
            const averageCTR = analyticsDocs.length > 0 && totalImpressions > 0
                ? (totalClicks / totalImpressions) * 100
                : 0;
            const activeAds = ads.filter((ad) => ad.status === 'active').length;
            // Calculate next expiry
            const now = Date.now();
            const activeAdsList = ads.filter((ad) => ad.status === 'active' && ad.expiryDate && ad.expiryDate > now);
            const nextExpiringAd = activeAdsList.sort((a, b) => (a.expiryDate || 0) - (b.expiryDate || 0))[0];
            const daysToNextExpiry = nextExpiringAd
                ? Math.ceil((nextExpiringAd.expiryDate - now) / (1000 * 60 * 60 * 24))
                : null;
            const performanceScore = Math.min(100, Math.round((totalClicks * 2 + totalEngagement + totalImpressions * 0.01) /
                (activeAds || 1)));
            const trendData = [];
            res.json({
                success: true,
                data: {
                    totalImpressions,
                    totalClicks,
                    totalReach,
                    totalEngagement,
                    totalSpend,
                    averageCTR,
                    activeAds,
                    daysToNextExpiry,
                    performanceScore,
                    trendData
                }
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
            const ad = yield db.collection('ads').findOne({ id });
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $setOnInsert: {
                    adId: id,
                    ownerId: (ad === null || ad === void 0 ? void 0 : ad.ownerId) || null,
                    spend: 0,
                    conversions: 0,
                    clicks: 0,
                    engagement: 0
                },
                $inc: {
                    impressions: 1,
                    reach: 1
                },
                $set: {
                    lastUpdated: Date.now()
                }
            }, { upsert: true });
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error tracking ad impression:', error);
            res.status(500).json({ success: false, error: 'Failed to track ad impression' });
        }
    }),
    trackClick: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $setOnInsert: {
                    adId: id,
                    ownerId: (ad === null || ad === void 0 ? void 0 : ad.ownerId) || null,
                    spend: 0,
                    conversions: 0,
                    impressions: 0,
                    reach: 0,
                    engagement: 0
                },
                $inc: {
                    clicks: 1
                },
                $set: {
                    lastUpdated: Date.now()
                }
            }, { upsert: true });
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error tracking ad click:', error);
            res.status(500).json({ success: false, error: 'Failed to track ad click' });
        }
    }),
    trackEngagement: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const ad = yield db.collection('ads').findOne({ id });
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $setOnInsert: {
                    adId: id,
                    ownerId: (ad === null || ad === void 0 ? void 0 : ad.ownerId) || null,
                    spend: 0,
                    conversions: 0
                },
                $inc: {
                    engagement: 1
                },
                $set: {
                    lastUpdated: Date.now()
                }
            }, { upsert: true });
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error tracking ad engagement:', error);
            res.status(500).json({ success: false, error: 'Failed to track ad engagement' });
        }
    })
};
