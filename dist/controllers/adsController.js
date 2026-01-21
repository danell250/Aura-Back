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
const adPlans_1 = require("../constants/adPlans");
const adSubscriptionsController_1 = require("./adSubscriptionsController");
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
            // Check subscription limits and enforce at ACTION TIME
            if (!isSpecialUser) {
                // Fetch active subscription for the user
                subscription = yield db.collection('adSubscriptions').findOne({
                    userId,
                    status: 'active',
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: { $gt: now } }
                    ]
                });
                // If no active subscription, allow creation only if they have credits? 
                // OR strictly enforce plan.
                // Based on "pkg-starter" being $39, we should require a subscription.
                if (!subscription) {
                    return res.status(403).json({
                        success: false,
                        error: 'No active ad plan found. Please purchase a plan to create signals.'
                    });
                }
                // --- NEW LOGIC START ---
                // Ensure subscription period is up to date (resets adsUsed if new month)
                subscription = yield (0, adSubscriptionsController_1.ensureCurrentPeriod)(db, subscription);
                // Hard monthly limit
                if (subscription.adsUsed >= subscription.adLimit) {
                    const resetDate = subscription.periodEnd
                        ? new Date(subscription.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : 'next billing cycle';
                    return res.status(409).json({
                        success: false,
                        code: 'AD_LIMIT_REACHED',
                        error: 'AD_LIMIT_REACHED',
                        message: `You’ve used all ${subscription.adLimit} ads for this month.`,
                        adLimit: subscription.adLimit,
                        adsUsed: subscription.adsUsed,
                        periodEnd: subscription.periodEnd
                    });
                }
                // --- NEW LOGIC END ---
            }
            const newAd = Object.assign(Object.assign({}, adData), { ownerId: userId, id: adData.id || `ad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, timestamp: Date.now(), reactions: {}, reactionUsers: {}, hashtags: (0, hashtagUtils_1.getHashtagsFromText)(adData.description || '') });
            try {
                yield db.collection('ads').insertOne(newAd);
                // Increment usage (atomic)
                if (!isSpecialUser && subscription) {
                    yield db.collection('adSubscriptions').updateOne({ id: subscription.id }, { $inc: { adsUsed: 1 }, $set: { updatedAt: Date.now() } });
                }
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
                console.error('Error during ad creation transaction:', error);
                // If ad was created but subsequent steps failed, we might want to clean up
                // But for now, we just throw to ensure the client gets an error
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
            // Don't allow updating status via updateAd (must use updateAdStatus)
            delete updates.status;
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
            const currentUser = req.user;
            if (!currentUser || !currentUser.id) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            const isAdmin = currentUser.role === 'admin' || currentUser.isAdmin === true;
            if (!isAdmin && ad.ownerId !== currentUser.id) {
                return res.status(403).json({ success: false, error: 'Forbidden' });
            }
            // Enforce limits if activating
            if (status === 'active' && ad.status !== 'active') {
                // Get active subscription
                const now = Date.now();
                let subscription = yield db.collection('adSubscriptions').findOne({
                    userId: currentUser.id,
                    status: 'active',
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: { $gt: now } }
                    ]
                });
                if (subscription) {
                    // Ensure period is current before checking limits
                    subscription = yield (0, adSubscriptionsController_1.ensureCurrentPeriod)(db, subscription);
                }
                // Note: Ad limit is enforced at creation time (Monthly Quota).
                // We do NOT check simultaneous active ads here.
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
            res.json({ success: true, data: result });
        }
        catch (error) {
            console.error('Error updating ad status:', error);
            res.status(500).json({ success: false, error: 'Failed to update ad status' });
        }
    }),
    getAdAnalytics: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
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
            // Check user subscription level
            const now = Date.now();
            const subscription = yield db.collection('adSubscriptions').findOne({
                userId: currentUser.id, // Viewer is owner (checked above)
                status: 'active',
                $or: [{ endDate: { $exists: false } }, { endDate: { $gt: now } }]
            });
            const packageId = subscription ? subscription.packageId : 'pkg-starter';
            const isBasic = packageId === 'pkg-starter';
            const isPro = packageId === 'pkg-pro';
            const isEnterprise = packageId === 'pkg-enterprise';
            const impressions = (_a = analytics === null || analytics === void 0 ? void 0 : analytics.impressions) !== null && _a !== void 0 ? _a : 0;
            const clicks = (_b = analytics === null || analytics === void 0 ? void 0 : analytics.clicks) !== null && _b !== void 0 ? _b : 0;
            const engagement = (_c = analytics === null || analytics === void 0 ? void 0 : analytics.engagement) !== null && _c !== void 0 ? _c : 0;
            const conversions = (_d = analytics === null || analytics === void 0 ? void 0 : analytics.conversions) !== null && _d !== void 0 ? _d : 0;
            const spend = (_e = analytics === null || analytics === void 0 ? void 0 : analytics.spend) !== null && _e !== void 0 ? _e : 0;
            const reach = (_f = analytics === null || analytics === void 0 ? void 0 : analytics.reach) !== null && _f !== void 0 ? _f : impressions;
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const lastUpdated = (_g = analytics === null || analytics === void 0 ? void 0 : analytics.lastUpdated) !== null && _g !== void 0 ? _g : Date.now();
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
                // Mock deep analytics for now
                data.audience = {
                    sentiment: 'positive',
                    demographics: { '18-24': 30, '25-34': 45 }
                };
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
            // Check user subscription level
            const now = Date.now();
            const subscription = yield db.collection('adSubscriptions').findOne({
                userId,
                status: 'active',
                $or: [{ endDate: { $exists: false } }, { endDate: { $gt: now } }]
            });
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
            // Check user subscription level
            const now = Date.now();
            const subscription = yield db.collection('adSubscriptions').findOne({
                userId,
                status: 'active',
                $or: [{ endDate: { $exists: false } }, { endDate: { $gt: now } }]
            });
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
            const build7DayTrend = (analyticsDocs) => {
                const days = 7;
                const start = new Date();
                start.setHours(0, 0, 0, 0);
                start.setDate(start.getDate() - (days - 1));
                const buckets = new Map();
                for (let i = 0; i < days; i++) {
                    const d = new Date(start);
                    d.setDate(start.getDate() + i);
                    const key = d.toISOString().slice(0, 10);
                    buckets.set(key, {
                        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        impressions: 0,
                        clicks: 0,
                        engagement: 0,
                        spend: 0
                    });
                }
                for (const doc of analyticsDocs) {
                    const ts = doc.lastUpdated || Date.now();
                    const d = new Date(ts);
                    d.setHours(0, 0, 0, 0);
                    const key = d.toISOString().slice(0, 10);
                    const b = buckets.get(key);
                    if (!b)
                        continue;
                    b.impressions += doc.impressions || 0;
                    b.clicks += doc.clicks || 0;
                    // Include all metrics regardless of plan
                    b.engagement += doc.engagement || 0;
                    b.spend += doc.spend || 0;
                }
                return Array.from(buckets.values());
            };
            const trendData = build7DayTrend(analyticsDocs);
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
            // 1. Get Ad to find owner
            const ad = yield db.collection('ads').findOne({ id });
            if (!ad) {
                // If ad missing, we can't attribute cost, but we should still track impression?
                // No, if ad is gone, we shouldn't be serving it.
                return res.status(404).json({ success: false, error: 'Ad not found' });
            }
            // 2. Determine Cost Per Impression (CPI)
            let cpi = 0;
            // Look up active subscription for the ad owner
            const now = Date.now();
            const subscription = yield db.collection('adSubscriptions').findOne({
                userId: ad.ownerId,
                status: 'active',
                $or: [{ endDate: { $exists: false } }, { endDate: { $gt: now } }]
            });
            if (subscription && subscription.packageId) {
                const plan = adPlans_1.AD_PLANS[subscription.packageId];
                if (plan && plan.impressionLimit > 0) {
                    cpi = plan.numericPrice / plan.impressionLimit;
                }
            }
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $inc: {
                    impressions: 1,
                    reach: 1,
                    spend: cpi
                },
                $set: { lastUpdated: Date.now() }
            }, { upsert: true });
            res.json({ success: true });
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
            const analytics = yield db.collection('adAnalytics').findOne({ adId: id });
            const impressions = (analytics === null || analytics === void 0 ? void 0 : analytics.impressions) || 1; // Prevent div/0
            const currentClicks = (analytics === null || analytics === void 0 ? void 0 : analytics.clicks) || 0;
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $inc: { clicks: 1 },
                $set: {
                    lastUpdated: Date.now(),
                    ctr: ((currentClicks + 1) / impressions) * 100
                }
            }, { upsert: true });
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
            const db = (0, db_1.getDB)();
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $inc: { engagement: 1 },
                $set: { lastUpdated: Date.now() }
            }, { upsert: true });
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
            // A conversion is a high-value action. We might want to track metadata (e.g. value, type)
            // For now, we just increment the counter.
            yield db.collection('adAnalytics').updateOne({ adId: id }, {
                $inc: { conversions: 1 },
                $set: { lastUpdated: Date.now() }
            }, { upsert: true });
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error tracking conversion:', error);
            res.status(500).json({ success: false, error: 'Failed to track conversion' });
        }
    })
};
