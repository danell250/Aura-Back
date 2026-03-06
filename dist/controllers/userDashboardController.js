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
exports.userDashboardController = void 0;
const db_1 = require("../db");
const jobMarketDemandService_1 = require("../services/jobMarketDemandService");
const jobMarketDemandPersonalizationService_1 = require("../services/jobMarketDemandPersonalizationService");
const dashboardDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const formatDashboardHour = (hour) => {
    const normalized = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 12;
    const meridiem = normalized >= 12 ? 'PM' : 'AM';
    const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
    return `${hour12}:00 ${meridiem}`;
};
const deriveDashboardTiming = (topPosts) => {
    if (!topPosts.length) {
        return {
            bestTimeToPost: 'Wednesday 6:00 PM',
            peakActivity: 'Weekends',
        };
    }
    const dayWeights = new Array(7).fill(0);
    const hourWeights = new Array(24).fill(0);
    for (const post of topPosts) {
        const date = new Date(post.timestamp || Date.now());
        const weight = Math.max(1, post.views || 1);
        dayWeights[date.getDay()] += weight;
        hourWeights[date.getHours()] += weight;
    }
    const bestDay = dayWeights.indexOf(Math.max(...dayWeights));
    const bestHour = hourWeights.indexOf(Math.max(...hourWeights));
    return {
        bestTimeToPost: `${dashboardDayNames[bestDay]} ${formatDashboardHour(bestHour)}`,
        peakActivity: bestDay === 0 || bestDay === 6 ? 'Weekends' : `${dashboardDayNames[bestDay]}s`,
    };
};
const deriveDashboardReachVelocity = (avgViews) => {
    if (avgViews >= 1000)
        return 'Very High';
    if (avgViews >= 300)
        return 'High';
    if (avgViews >= 100)
        return 'Rising';
    if (avgViews > 0)
        return 'Growing';
    return 'Low';
};
const buildDashboardNeuralInsights = (totals, topPosts, adImpressions, adClicks, country) => {
    const totalViews = Math.max(0, totals.totalViews || 0);
    const totalPosts = Math.max(0, totals.totalPosts || 0);
    const boostedPosts = Math.max(0, totals.boostedPosts || 0);
    const totalRadiance = Math.max(0, totals.totalRadiance || 0);
    const boostRatio = totalPosts > 0 ? boostedPosts / totalPosts : 0;
    const avgViewsPerPost = totalPosts > 0 ? totalViews / totalPosts : 0;
    const engagementRateValue = totalViews > 0 ? (totalRadiance / totalViews) * 100 : 0;
    const retentionScore = Math.max(20, Math.min(95, Math.round(40 + boostRatio * 30 + Math.min(25, avgViewsPerPost / 40))));
    const engagementHealthScore = Math.max(1, Math.min(99, Math.round(30 + engagementRateValue * 20 + boostRatio * 25)));
    const ctrValue = adImpressions > 0 ? (adClicks / adImpressions) * 100 : 0;
    const conversionScore = Math.max(0, Math.min(100, Math.round(20 + ctrValue * 12 + engagementRateValue * 5 + boostRatio * 20)));
    const timing = deriveDashboardTiming(topPosts);
    const topLocations = country && country.trim() ? [country.trim()] : ['Global'];
    return {
        engagementHealth: `${engagementHealthScore}%`,
        reachVelocity: deriveDashboardReachVelocity(avgViewsPerPost),
        audienceBehavior: {
            retention: retentionScore >= 80 ? 'High' : retentionScore >= 55 ? 'Moderate' : 'Emerging',
            engagementRate: `${engagementRateValue.toFixed(1)}%`,
            topLocations,
        },
        timingOptimization: timing,
        conversionInsights: {
            clickThroughRate: `${ctrValue.toFixed(1)}%`,
            conversionScore,
        },
    };
};
exports.userDashboardController = {
    getMyDashboard: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        try {
            const db = (0, db_1.getDB)();
            const currentUser = req.user;
            if (!(currentUser === null || currentUser === void 0 ? void 0 : currentUser.id)) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const authorId = currentUser.id;
            const personalPostMatch = {
                'author.id': authorId,
                $or: [
                    { 'author.type': 'user' },
                    { 'author.type': { $exists: false } },
                ],
            };
            const [agg] = yield db.collection('posts').aggregate([
                { $match: personalPostMatch },
                {
                    $group: {
                        _id: null,
                        totalPosts: { $sum: 1 },
                        totalViews: { $sum: { $ifNull: ['$viewCount', 0] } },
                        boostedPosts: { $sum: { $cond: [{ $eq: ['$isBoosted', true] }, 1, 0] } },
                        totalRadiance: { $sum: { $ifNull: ['$radiance', 0] } },
                    },
                },
            ]).toArray();
            const topPosts = yield db.collection('posts')
                .find(personalPostMatch)
                .project({ id: 1, content: 1, viewCount: 1, timestamp: 1, isBoosted: 1, radiance: 1 })
                .sort({ viewCount: -1 })
                .limit(5)
                .toArray();
            const [user, activeSub, adAgg] = yield Promise.all([
                db.collection('users').findOne({ id: authorId }, {
                    projection: {
                        auraCredits: 1,
                        auraCreditsSpent: 1,
                        country: 1,
                        profileViews: 1,
                        title: 1,
                        preferredRoles: 1,
                        preferredLocations: 1,
                        preferredWorkModels: 1,
                    },
                }),
                db.collection('adSubscriptions').findOne({
                    userId: authorId,
                    status: 'active',
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: { $gt: Date.now() } },
                    ],
                }),
                db.collection('adAnalytics').aggregate([
                    {
                        $match: {
                            $or: [
                                { ownerId: authorId, ownerType: 'user' },
                                { ownerId: authorId, ownerType: { $exists: false } },
                                { userId: authorId },
                            ],
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            totalImpressions: { $sum: { $ifNull: ['$impressions', 0] } },
                            totalClicks: { $sum: { $ifNull: ['$clicks', 0] } },
                        },
                    },
                ]).toArray().then((rows) => rows[0] || null),
            ]);
            const profileViewIds = Array.from(new Set((Array.isArray(user === null || user === void 0 ? void 0 : user.profileViews) ? user.profileViews : [])
                .map((id) => String(id || '').trim())
                .filter((id) => id.length > 0)));
            let profileViewers = [];
            if (profileViewIds.length > 0) {
                const viewerDocs = yield db.collection('users')
                    .find({ id: { $in: profileViewIds } })
                    .project({ id: 1, name: 1, handle: 1, avatar: 1, avatarType: 1 })
                    .toArray();
                const viewerById = new Map();
                for (const viewer of viewerDocs) {
                    if (viewer === null || viewer === void 0 ? void 0 : viewer.id) {
                        viewerById.set(String(viewer.id), viewer);
                    }
                }
                profileViewers = profileViewIds.map((viewerId) => {
                    const viewer = viewerById.get(viewerId);
                    return {
                        id: viewerId,
                        name: (viewer === null || viewer === void 0 ? void 0 : viewer.name) || 'Aura member',
                        handle: (viewer === null || viewer === void 0 ? void 0 : viewer.handle) || '@aura',
                        avatar: (viewer === null || viewer === void 0 ? void 0 : viewer.avatar) || '',
                        avatarType: (viewer === null || viewer === void 0 ? void 0 : viewer.avatarType) === 'video' ? 'video' : 'image',
                    };
                });
            }
            let analyticsLevel = 'none';
            if (activeSub) {
                if (activeSub.packageId === 'pkg-enterprise')
                    analyticsLevel = 'deep';
                else if (activeSub.packageId === 'pkg-pro')
                    analyticsLevel = 'creator';
                else if (activeSub.packageId === 'pkg-starter')
                    analyticsLevel = 'basic';
            }
            const totals = {
                totalPosts: (_a = agg === null || agg === void 0 ? void 0 : agg.totalPosts) !== null && _a !== void 0 ? _a : 0,
                totalViews: (_b = agg === null || agg === void 0 ? void 0 : agg.totalViews) !== null && _b !== void 0 ? _b : 0,
                boostedPosts: (_c = agg === null || agg === void 0 ? void 0 : agg.boostedPosts) !== null && _c !== void 0 ? _c : 0,
                totalRadiance: (_d = agg === null || agg === void 0 ? void 0 : agg.totalRadiance) !== null && _d !== void 0 ? _d : 0,
            };
            const mappedTopPosts = topPosts.map((post) => {
                var _a, _b;
                return ({
                    id: post.id,
                    preview: (post.content || '').slice(0, 120),
                    views: (_a = post.viewCount) !== null && _a !== void 0 ? _a : 0,
                    timestamp: post.timestamp,
                    isBoosted: !!post.isBoosted,
                    radiance: (_b = post.radiance) !== null && _b !== void 0 ? _b : 0,
                });
            });
            const neuralInsights = buildDashboardNeuralInsights(totals, mappedTopPosts, (_e = adAgg === null || adAgg === void 0 ? void 0 : adAgg.totalImpressions) !== null && _e !== void 0 ? _e : 0, (_f = adAgg === null || adAgg === void 0 ? void 0 : adAgg.totalClicks) !== null && _f !== void 0 ? _f : 0, user === null || user === void 0 ? void 0 : user.country);
            const marketDemand = yield (0, jobMarketDemandService_1.listJobMarketDemand)({
                db,
                query: (0, jobMarketDemandPersonalizationService_1.buildPersonalizedJobMarketDemandQuery)(user, 3),
                personalized: true,
            });
            return res.json({
                success: true,
                data: {
                    totals,
                    credits: {
                        balance: (_g = user === null || user === void 0 ? void 0 : user.auraCredits) !== null && _g !== void 0 ? _g : 0,
                        spent: (_h = user === null || user === void 0 ? void 0 : user.auraCreditsSpent) !== null && _h !== void 0 ? _h : 0,
                    },
                    profileViews: profileViewIds,
                    profileViewers,
                    topPosts: mappedTopPosts,
                    neuralInsights,
                    marketDemand,
                },
                planLevel: analyticsLevel,
            });
        }
        catch (error) {
            console.error('getMyDashboard error', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch dashboard data' });
        }
    }),
};
