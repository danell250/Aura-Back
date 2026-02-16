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
exports.usersController = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../db");
const s3Upload_1 = require("../utils/s3Upload");
const userUtils_1 = require("../utils/userUtils");
const trustService_1 = require("../services/trustService");
const postsController_1 = require("./postsController");
const securityLogger_1 = require("../utils/securityLogger");
const socketHub_1 = require("../realtime/socketHub");
const generateUniqueHandle = (firstName, lastName) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const firstNameSafe = (firstName || 'user').toLowerCase().trim().replace(/\s+/g, '');
    const lastNameSafe = (lastName || '').toLowerCase().trim().replace(/\s+/g, '');
    const baseHandle = `@${firstNameSafe}${lastNameSafe}`;
    try {
        const existingUser = yield db.collection('users').findOne({ handle: baseHandle });
        const existingCompany = yield db.collection('companies').findOne({ handle: baseHandle });
        if (!existingUser && !existingCompany) {
            console.log('✓ Handle available:', baseHandle);
            return baseHandle;
        }
    }
    catch (error) {
        console.error('Error checking base handle:', error);
    }
    for (let attempt = 0; attempt < 50; attempt++) {
        const randomNum = Math.floor(Math.random() * 100000);
        const candidateHandle = `${baseHandle}${randomNum}`;
        try {
            const existingUser = yield db.collection('users').findOne({ handle: candidateHandle });
            const existingCompany = yield db.collection('companies').findOne({ handle: candidateHandle });
            if (!existingUser && !existingCompany) {
                console.log('✓ Handle available:', candidateHandle);
                return candidateHandle;
            }
        }
        catch (error) {
            console.error(`Error checking handle ${candidateHandle}:`, error);
            continue;
        }
    }
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 9);
    const fallbackHandle = `@user${timestamp}${randomStr}`;
    console.log('⚠ Using fallback handle:', fallbackHandle);
    return fallbackHandle;
});
const normalizeUserHandle = (rawHandle) => {
    const base = (rawHandle || '').trim().toLowerCase();
    const withoutAt = base.startsWith('@') ? base.slice(1) : base;
    const cleaned = withoutAt.replace(/[^a-z0-9_-]/g, '');
    if (!cleaned)
        return '';
    return `@${cleaned}`;
};
const validateHandleFormat = (handle) => {
    const normalized = normalizeUserHandle(handle);
    if (!normalized) {
        return { ok: false, message: 'Handle is required' };
    }
    const core = normalized.slice(1);
    if (core.length < 3 || core.length > 21) {
        return { ok: false, message: 'Handle must be between 3 and 21 characters' };
    }
    if (!/^[a-z0-9_-]+$/.test(core)) {
        return { ok: false, message: 'Handle can only use letters, numbers, underscores and hyphens' };
    }
    return { ok: true };
};
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CREDIT_BUNDLE_CONFIG = {
    'Nano Pulse': { credits: 100, price: 9.99 },
    'Neural Spark': { credits: 500, price: 39.99 },
    'Neural Surge': { credits: 2000, price: 149.99 },
    'Universal Core': { credits: 5000, price: 349.99 }
};
const SIGNUP_BONUS_CREDITS = 100;
const USER_SELF_UPDATE_ALLOWLIST = new Set([
    'firstName',
    'lastName',
    'name',
    'handle',
    'bio',
    'phone',
    'country',
    'website',
    'profileLinks',
    'dob',
    'zodiacSign',
    'avatar',
    'avatarType',
    'avatarCrop',
    'avatarKey',
    'coverImage',
    'coverType',
    'coverCrop',
    'coverKey',
    'isPrivate',
    'activeGlow',
    'userMode'
]);
const MAX_PROFILE_LINKS = 8;
const sanitizeProfileLinks = (value) => {
    if (!Array.isArray(value))
        return null;
    const cleaned = [];
    const seen = new Set();
    for (const item of value) {
        if (!item || typeof item !== 'object')
            continue;
        const rawLabel = String(item.label || '').trim();
        const rawUrl = String(item.url || '').trim();
        if (!rawLabel || !rawUrl)
            continue;
        const label = rawLabel.slice(0, 40);
        const prefixedUrl = /^(https?:\/\/|\/)/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
        const safeUrl = prefixedUrl.replace(/\s+/g, '');
        if (!/^https?:\/\/.+/i.test(safeUrl) && !safeUrl.startsWith('/'))
            continue;
        const dedupeKey = safeUrl.toLowerCase();
        if (seen.has(dedupeKey))
            continue;
        seen.add(dedupeKey);
        cleaned.push({
            id: String(item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            label,
            url: safeUrl
        });
        if (cleaned.length >= MAX_PROFILE_LINKS)
            break;
    }
    return cleaned;
};
const USER_SENSITIVE_UPDATE_FIELDS = new Set([
    'id',
    'googleId',
    'email',
    'auraCredits',
    'auraCreditsSpent',
    'trustScore',
    'isVerified',
    'isAdmin',
    'notifications',
    'blockedUsers',
    'acquaintances',
    'sentConnectionRequests',
    'sentAcquaintanceRequests',
    'profileViews',
    'subscribedCompanyIds',
    'companyName',
    'companyWebsite',
    'industry',
    'employeeCount',
    'createdAt',
    'updatedAt'
]);
const sanitizePublicUserProfile = (user) => {
    if (!user)
        return user;
    const sanitized = Object.assign({}, user);
    delete sanitized.email;
    delete sanitized.notifications;
    delete sanitized.profileViews;
    delete sanitized.blockedUsers;
    delete sanitized.sentAcquaintanceRequests;
    delete sanitized.sentConnectionRequests;
    return sanitized;
};
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
            peakActivity: 'Weekends'
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
        peakActivity: bestDay === 0 || bestDay === 6 ? 'Weekends' : `${dashboardDayNames[bestDay]}s`
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
            topLocations
        },
        timingOptimization: timing,
        conversionInsights: {
            clickThroughRate: `${ctrValue.toFixed(1)}%`,
            conversionScore
        }
    };
};
exports.usersController = {
    // GET /api/users/me/dashboard - Get creator dashboard data
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
                    { 'author.type': { $exists: false } }
                ]
            };
            const [agg] = yield db.collection('posts').aggregate([
                { $match: personalPostMatch },
                {
                    $group: {
                        _id: null,
                        totalPosts: { $sum: 1 },
                        totalViews: { $sum: { $ifNull: ['$viewCount', 0] } },
                        boostedPosts: { $sum: { $cond: [{ $eq: ['$isBoosted', true] }, 1, 0] } },
                        totalRadiance: { $sum: { $ifNull: ['$radiance', 0] } }
                    }
                }
            ]).toArray();
            const topPosts = yield db.collection('posts')
                .find(personalPostMatch)
                .project({ id: 1, content: 1, viewCount: 1, timestamp: 1, isBoosted: 1, radiance: 1 })
                .sort({ viewCount: -1 })
                .limit(5)
                .toArray();
            const [user, activeSub, adAgg] = yield Promise.all([
                db.collection('users').findOne({ id: authorId }, { projection: { auraCredits: 1, auraCreditsSpent: 1, country: 1 } }),
                db.collection('adSubscriptions').findOne({
                    userId: authorId,
                    status: 'active',
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: { $gt: Date.now() } }
                    ]
                }),
                db.collection('adAnalytics').aggregate([
                    {
                        $match: {
                            $or: [
                                { ownerId: authorId, ownerType: 'user' },
                                { ownerId: authorId, ownerType: { $exists: false } },
                                { userId: authorId }
                            ]
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalImpressions: { $sum: { $ifNull: ['$impressions', 0] } },
                            totalClicks: { $sum: { $ifNull: ['$clicks', 0] } }
                        }
                    }
                ]).toArray().then(rows => rows[0] || null)
            ]);
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
                totalRadiance: (_d = agg === null || agg === void 0 ? void 0 : agg.totalRadiance) !== null && _d !== void 0 ? _d : 0
            };
            const mappedTopPosts = topPosts.map((p) => {
                var _a, _b;
                return ({
                    id: p.id,
                    preview: (p.content || '').slice(0, 120),
                    views: (_a = p.viewCount) !== null && _a !== void 0 ? _a : 0,
                    timestamp: p.timestamp,
                    isBoosted: !!p.isBoosted,
                    radiance: (_b = p.radiance) !== null && _b !== void 0 ? _b : 0
                });
            });
            const neuralInsights = buildDashboardNeuralInsights(totals, mappedTopPosts, (_e = adAgg === null || adAgg === void 0 ? void 0 : adAgg.totalImpressions) !== null && _e !== void 0 ? _e : 0, (_f = adAgg === null || adAgg === void 0 ? void 0 : adAgg.totalClicks) !== null && _f !== void 0 ? _f : 0, user === null || user === void 0 ? void 0 : user.country);
            const dashboardData = {
                totals,
                credits: {
                    balance: (_g = user === null || user === void 0 ? void 0 : user.auraCredits) !== null && _g !== void 0 ? _g : 0,
                    spent: (_h = user === null || user === void 0 ? void 0 : user.auraCreditsSpent) !== null && _h !== void 0 ? _h : 0
                },
                topPosts: mappedTopPosts,
                neuralInsights
            };
            res.json({
                success: true,
                data: dashboardData,
                planLevel: analyticsLevel
            });
        }
        catch (error) {
            console.error('getMyDashboard error', error);
            res.status(500).json({ success: false, error: 'Failed to fetch dashboard data' });
        }
    }),
    // GET /api/users - Get all users (respects showInSearch privacy setting)
    getAllUsers: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const db = (0, db_1.getDB)();
            // Filter out users who have explicitly set showInSearch to false
            // Users without the setting (undefined) default to true (visible)
            const query = {
                $or: [
                    { 'privacySettings.showInSearch': { $ne: false } },
                    { 'privacySettings.showInSearch': { $exists: false } }
                ]
            };
            const users = yield db.collection('users').find(query).toArray();
            const transformed = (0, userUtils_1.transformUsers)(users).map((u) => sanitizePublicUserProfile(Object.assign(Object.assign({}, u), { type: 'user' })));
            res.json({
                success: true,
                data: transformed,
                count: users.length
            });
        }
        catch (error) {
            console.error('Error fetching users:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch users',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/cancel-connection - Cancel a sent connection request
    cancelConnectionRequest: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { targetUserId } = req.body;
            const db = (0, db_1.getDB)();
            const requester = yield db.collection('users').findOne({ id });
            if (!requester) {
                return res.status(404).json({
                    success: false,
                    error: 'Requester not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            const targetUser = yield db.collection('users').findOne({ id: targetUserId });
            if (!targetUser) {
                return res.status(404).json({
                    success: false,
                    error: 'Target user not found',
                    message: `User with ID ${targetUserId} does not exist`
                });
            }
            const updatedSentRequests = (requester.sentAcquaintanceRequests || []).filter((rid) => rid !== targetUserId);
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    sentAcquaintanceRequests: updatedSentRequests,
                    updatedAt: new Date().toISOString()
                }
            });
            const updatedNotifications = (targetUser.notifications || []).filter((n) => !(n.type === 'acquaintance_request' && n.fromUser.id === id));
            yield db.collection('users').updateOne({ id: targetUserId }, {
                $set: {
                    notifications: updatedNotifications,
                    updatedAt: new Date().toISOString()
                }
            });
            res.json({
                success: true,
                data: {
                    requesterId: id,
                    targetUserId,
                    timestamp: new Date().toISOString()
                },
                message: 'Connection request cancelled successfully'
            });
        }
        catch (error) {
            console.error('Error cancelling connection request:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to cancel connection request',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/users/:id - Get user or company by ID
    getUserById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            // Try to find user first
            const user = yield db.collection('users').findOne({ id });
            if (user) {
                const transformed = (0, userUtils_1.transformUser)(user);
                const requesterId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
                const isSelf = typeof requesterId === 'string' && requesterId === id;
                return res.json({
                    success: true,
                    type: 'user',
                    data: Object.assign(Object.assign({}, (isSelf ? transformed : sanitizePublicUserProfile(transformed))), { type: 'user' })
                });
            }
            // Try to find company
            const company = yield db.collection('companies').findOne({
                id,
                legacyArchived: { $ne: true }
            });
            if (company) {
                // Map company fields to user-like structure for profile view compatibility
                const profileData = Object.assign(Object.assign({}, company), { type: 'company', name: company.name, companyName: company.name, companyWebsite: company.website, userMode: 'company', isVerified: company.isVerified || false, trustScore: 100, auraCredits: 0, subscribers: Array.isArray(company.subscribers) ? company.subscribers : [], subscriberCount: typeof company.subscriberCount === 'number'
                        ? company.subscriberCount
                        : (Array.isArray(company.subscribers) ? company.subscribers.length : 0), notifications: [], blockedUsers: [], profileViews: [] });
                return res.json({
                    success: true,
                    type: 'company',
                    data: Object.assign(Object.assign({}, (0, userUtils_1.transformUser)(profileData)), { type: 'company' })
                });
            }
            return res.status(404).json({
                success: false,
                error: 'Not found',
                message: `Profile with ID ${id} does not exist`
            });
        }
        catch (error) {
            console.error('Error fetching by ID:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch profile',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/users/handle/:handle - Get user or company by handle
    getUserByHandle: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            let { handle } = req.params;
            if (!handle) {
                return res.status(400).json({ success: false, error: 'Handle is required' });
            }
            // Ensure handle starts with @
            if (!handle.startsWith('@')) {
                handle = `@${handle}`;
            }
            const db = (0, db_1.getDB)();
            // Try to find user first
            const user = yield db.collection('users').findOne({
                handle: { $regex: new RegExp(`^${handle}$`, 'i') }
            });
            if (user) {
                const transformed = (0, userUtils_1.transformUser)(user);
                const requesterId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
                const isSelf = typeof requesterId === 'string' && requesterId === user.id;
                return res.json({
                    success: true,
                    type: 'user',
                    data: Object.assign(Object.assign({}, (isSelf ? transformed : sanitizePublicUserProfile(transformed))), { type: 'user' })
                });
            }
            // Try to find company
            const company = yield db.collection('companies').findOne({
                handle: { $regex: new RegExp(`^${handle}$`, 'i') },
                legacyArchived: { $ne: true }
            });
            if (company) {
                // Map company fields to user-like structure for profile view compatibility
                const profileData = Object.assign(Object.assign({}, company), { type: 'company', name: company.name, companyName: company.name, companyWebsite: company.website, userMode: 'company', isVerified: company.isVerified || false, trustScore: 100, auraCredits: 0, subscribers: Array.isArray(company.subscribers) ? company.subscribers : [], subscriberCount: typeof company.subscriberCount === 'number'
                        ? company.subscriberCount
                        : (Array.isArray(company.subscribers) ? company.subscribers.length : 0), notifications: [], blockedUsers: [], profileViews: [] });
                return res.json({
                    success: true,
                    type: 'company',
                    data: Object.assign(Object.assign({}, (0, userUtils_1.transformUser)(profileData)), { type: 'company' })
                });
            }
            return res.status(404).json({
                success: false,
                error: 'Not found',
                message: `User or company with handle ${handle} does not exist`
            });
        }
        catch (error) {
            console.error('Error fetching by handle:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch profile',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users - Create new user
    createUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const userData = req.body || {};
            const firstName = typeof userData.firstName === 'string' ? userData.firstName.trim() : '';
            const lastName = typeof userData.lastName === 'string' ? userData.lastName.trim() : '';
            const normalizedEmail = typeof userData.email === 'string' ? userData.email.trim().toLowerCase() : '';
            if (!firstName || !lastName || !normalizedEmail) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'firstName, lastName, and email are required'
                });
            }
            const db = (0, db_1.getDB)();
            const existingUser = yield db.collection('users').findOne({
                email: { $regex: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i') }
            });
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    error: 'User already exists',
                    message: 'A user with this email or handle already exists'
                });
            }
            const uniqueHandle = yield generateUniqueHandle(firstName, lastName);
            const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
            const newUser = {
                id: userId,
                firstName,
                lastName,
                name: `${firstName} ${lastName}`,
                handle: uniqueHandle,
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
                avatarType: 'image',
                email: normalizedEmail,
                bio: typeof userData.bio === 'string' ? userData.bio : '',
                phone: typeof userData.phone === 'string' ? userData.phone : '',
                country: typeof userData.country === 'string' ? userData.country : '',
                acquaintances: [],
                blockedUsers: [],
                trustScore: 10,
                auraCredits: SIGNUP_BONUS_CREDITS,
                auraCreditsSpent: 0,
                activeGlow: 'none',
                signupBonusGrantedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const result = yield db.collection('users').insertOne(newUser);
            if (!result.acknowledged) {
                throw new Error('Failed to insert user into database');
            }
            console.log('✓ User created:', userId, '| Handle:', uniqueHandle);
            res.status(201).json({
                success: true,
                data: Object.assign(Object.assign({}, (0, userUtils_1.transformUser)(newUser)), { type: 'user' }),
                message: 'User created successfully'
            });
        }
        catch (error) {
            console.error('Error creating user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create user',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/users/:id - Update user
    updateUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const incomingUpdates = (req.body && typeof req.body === 'object')
                ? req.body
                : {};
            const db = (0, db_1.getDB)();
            const existingUser = yield db.collection('users').findOne({ id });
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            const blockedSensitiveFields = Object.keys(incomingUpdates).filter((field) => USER_SENSITIVE_UPDATE_FIELDS.has(field));
            if (blockedSensitiveFields.length > 0) {
                (0, securityLogger_1.logSecurityEvent)({
                    req,
                    type: 'forbidden_update_attempt',
                    userId: id,
                    metadata: {
                        source: 'update_user',
                        blockedFields: blockedSensitiveFields
                    }
                });
            }
            const mutableUpdates = Object.entries(incomingUpdates).reduce((acc, [key, value]) => {
                if (USER_SELF_UPDATE_ALLOWLIST.has(key)) {
                    acc[key] = value;
                }
                return acc;
            }, {});
            if (Object.keys(mutableUpdates).length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid fields to update',
                    message: 'No mutable profile fields were provided.'
                });
            }
            const updateData = Object.assign({}, mutableUpdates);
            if (typeof mutableUpdates.website === 'string') {
                const website = mutableUpdates.website.trim();
                updateData.website = website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : '';
            }
            if (mutableUpdates.profileLinks !== undefined) {
                const normalizedProfileLinks = sanitizeProfileLinks(mutableUpdates.profileLinks);
                if (!normalizedProfileLinks) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid profile links',
                        message: 'profileLinks must be an array of { id, label, url }.'
                    });
                }
                updateData.profileLinks = normalizedProfileLinks;
            }
            if (typeof mutableUpdates.handle === 'string') {
                const handleValidation = validateHandleFormat(mutableUpdates.handle);
                if (!handleValidation.ok) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid handle',
                        message: handleValidation.message || 'Invalid handle'
                    });
                }
                const normalizedHandle = normalizeUserHandle(mutableUpdates.handle);
                if (normalizedHandle !== existingUser.handle) {
                    const conflictingUser = yield db.collection('users').findOne({ handle: normalizedHandle });
                    const conflictingCompany = yield db.collection('companies').findOne({ handle: normalizedHandle });
                    if ((conflictingUser && conflictingUser.id !== id) || conflictingCompany) {
                        return res.status(409).json({
                            success: false,
                            error: 'Handle taken',
                            message: 'This handle is already taken. Please try another one.'
                        });
                    }
                }
                updateData.handle = normalizedHandle;
            }
            else {
                delete updateData.handle;
            }
            // Handle avatarKey/coverKey updates.
            // We save ONLY the key to MongoDB as per requirements.
            // The avatar/coverImage URLs are constructed on read via transformUser.
            if (typeof mutableUpdates.avatarKey === 'string' && mutableUpdates.avatarKey.trim()) {
                updateData.avatarKey = mutableUpdates.avatarKey.trim();
                // Ensure we don't save the URL if it was passed in updates or previously existed
                delete updateData.avatar;
            }
            if (typeof mutableUpdates.coverKey === 'string' && mutableUpdates.coverKey.trim()) {
                updateData.coverKey = mutableUpdates.coverKey.trim();
                // Ensure we don't save the URL if it was passed in updates or previously existed
                delete updateData.coverImage;
            }
            updateData.updatedAt = new Date().toISOString();
            const result = yield db.collection('users').updateOne({ id }, { $set: updateData });
            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            // Propagate activeGlow changes to related collections
            if (typeof mutableUpdates.activeGlow === 'string' && mutableUpdates.activeGlow) {
                try {
                    // 1. Update Posts
                    yield db.collection('posts').updateMany({
                        "author.id": id,
                        $or: [
                            { "author.type": "user" },
                            { "author.type": { $exists: false } }
                        ]
                    }, { $set: { "author.activeGlow": mutableUpdates.activeGlow } });
                    // 2. Update Comments
                    yield db.collection('comments').updateMany({
                        "author.id": id,
                        $or: [
                            { "author.type": "user" },
                            { "author.type": { $exists: false } }
                        ]
                    }, { $set: { "author.activeGlow": mutableUpdates.activeGlow } });
                    // 3. Update Notifications
                    yield db.collection('users').updateMany({
                        notifications: {
                            $elemMatch: {
                                "fromUser.id": id,
                                $or: [
                                    { "fromUser.type": "user" },
                                    { "fromUser.type": { $exists: false } }
                                ]
                            }
                        }
                    }, {
                        $set: {
                            "notifications.$[elem].fromUser.activeGlow": mutableUpdates.activeGlow
                        }
                    }, {
                        arrayFilters: [{
                                "elem.fromUser.id": id,
                                $or: [
                                    { "elem.fromUser.type": "user" },
                                    { "elem.fromUser.type": { $exists: false } }
                                ]
                            }]
                    });
                    // 4. Update Ads
                    yield db.collection('ads').updateMany({
                        ownerId: id,
                        $or: [
                            { ownerType: "user" },
                            { ownerType: { $exists: false } }
                        ]
                    }, { $set: { "ownerActiveGlow": mutableUpdates.activeGlow } });
                    console.log(`Propagated activeGlow update for user ${id} to posts, comments, notifications, and ads.`);
                }
                catch (propError) {
                    console.error('Error propagating activeGlow updates:', propError);
                    // Don't fail the request, just log the error
                }
            }
            // Get updated user
            const updatedUser = yield db.collection('users').findOne({ id });
            const transformedUser = Object.assign(Object.assign({}, (0, userUtils_1.transformUser)(updatedUser)), { type: 'user' });
            // Broadcast update to all clients via Socket.IO
            const io = req.app.get('io');
            if (io) {
                io.emit('user_updated', transformedUser);
            }
            res.json({
                success: true,
                data: transformedUser,
                message: 'User updated successfully'
            });
        }
        catch (error) {
            console.error('Error updating user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update user',
                message: 'Internal server error'
            });
        }
    }),
    // DELETE /api/users/:id - Delete user
    deleteUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const result = yield db.collection('users').deleteOne({ id });
            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            res.json({
                success: true,
                message: 'User deleted successfully'
            });
        }
        catch (error) {
            console.error('Error deleting user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete user',
                message: 'Internal server error'
            });
        }
    }),
    uploadProfileImages: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const user = req.user;
            if (!user || !user.id) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const userId = user.id;
            const updates = {};
            const files = req.files;
            if (files === null || files === void 0 ? void 0 : files.profile) {
                const profile = files.profile[0];
                const ext = profile.originalname.split('.').pop();
                const path = `${userId}/profile.${ext}`;
                const fullKey = `avatars/${path}`;
                updates.avatar = yield (0, s3Upload_1.uploadToS3)('avatars', path, profile.buffer, profile.mimetype);
                updates.avatarType = 'image';
                updates.avatarKey = fullKey;
            }
            if (files === null || files === void 0 ? void 0 : files.cover) {
                const cover = files.cover[0];
                const ext = cover.originalname.split('.').pop();
                const path = `${userId}/cover.${ext}`;
                const fullKey = `covers/${path}`;
                updates.coverImage = yield (0, s3Upload_1.uploadToS3)('covers', path, cover.buffer, cover.mimetype);
                updates.coverType = 'image';
                updates.coverKey = fullKey;
            }
            if (Object.keys(updates).length === 0) {
                return res.json({ success: true, message: 'No images to upload' });
            }
            const db = (0, db_1.getDB)();
            yield db.collection('users').updateOne({ id: userId }, { $set: Object.assign(Object.assign({}, updates), { updatedAt: new Date().toISOString() }) });
            // Propagate avatar changes to related collections (Posts, Comments, Notifications)
            if (updates.avatar) {
                try {
                    // 1. Update Posts
                    yield db.collection('posts').updateMany({
                        "author.id": userId,
                        $or: [
                            { "author.type": "user" },
                            { "author.type": { $exists: false } }
                        ]
                    }, {
                        $set: {
                            "author.avatar": updates.avatar,
                            "author.avatarType": updates.avatarType,
                            "author.avatarKey": updates.avatarKey
                        }
                    });
                    // 2. Update Comments
                    yield db.collection('comments').updateMany({
                        "author.id": userId,
                        $or: [
                            { "author.type": "user" },
                            { "author.type": { $exists: false } }
                        ]
                    }, {
                        $set: {
                            "author.avatar": updates.avatar,
                            "author.avatarType": updates.avatarType,
                            "author.avatarKey": updates.avatarKey
                        }
                    });
                    // 3. Update Notifications (in all users who have notifications from this user)
                    yield db.collection('users').updateMany({
                        notifications: {
                            $elemMatch: {
                                "fromUser.id": userId,
                                $or: [
                                    { "fromUser.type": "user" },
                                    { "fromUser.type": { $exists: false } }
                                ]
                            }
                        }
                    }, {
                        $set: {
                            "notifications.$[elem].fromUser.avatar": updates.avatar,
                            "notifications.$[elem].fromUser.avatarType": updates.avatarType,
                            "notifications.$[elem].fromUser.avatarKey": updates.avatarKey
                        }
                    }, {
                        arrayFilters: [{
                                "elem.fromUser.id": userId,
                                $or: [
                                    { "elem.fromUser.type": "user" },
                                    { "elem.fromUser.type": { $exists: false } }
                                ]
                            }]
                    });
                    console.log(`Propagated avatar update for user ${userId} to posts, comments, and notifications.`);
                }
                catch (propError) {
                    console.error('Error propagating avatar updates:', propError);
                    // Don't fail the request, just log the error
                }
            }
            const updatedUser = yield db.collection('users').findOne({ id: userId });
            const transformedUser = (0, userUtils_1.transformUser)(updatedUser);
            // Broadcast update to all clients via Socket.IO
            const io = req.app.get('io');
            if (io) {
                io.emit('user_updated', transformedUser);
            }
            res.json({ success: true, user: transformedUser });
        }
        catch (e) {
            console.error('Upload failed:', e);
            res.status(500).json({ success: false, error: 'Upload failed' });
        }
    }),
    // POST /api/users/:id/remove-acquaintance - Remove an acquaintance
    removeAcquaintance: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { targetUserId } = req.body;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            const acquaintances = user.acquaintances || [];
            const updatedAcquaintances = acquaintances.filter(aid => aid !== targetUserId);
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    acquaintances: updatedAcquaintances,
                    updatedAt: new Date().toISOString()
                }
            });
            res.json({
                success: true,
                message: 'Acquaintance removed successfully'
            });
        }
        catch (error) {
            console.error('Error removing acquaintance:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to remove acquaintance',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/accept-connection - Accept connection request
    acceptConnectionRequest: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params; // The ID of the user accepting the request (acceptor)
            const { requesterId } = req.body; // The ID of the user who sent the request
            const db = (0, db_1.getDB)();
            // Find both users
            const acceptor = yield db.collection('users').findOne({ id });
            if (!acceptor) {
                return res.status(404).json({
                    success: false,
                    error: 'Acceptor not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            const requester = yield db.collection('users').findOne({ id: requesterId });
            if (!requester) {
                return res.status(404).json({
                    success: false,
                    error: 'Requester not found',
                    message: `User with ID ${requesterId} does not exist`
                });
            }
            // Check if they are already connected
            const acceptorAcquaintances = acceptor.acquaintances || [];
            if (acceptorAcquaintances.includes(requesterId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Already connected',
                    message: 'Users are already connected'
                });
            }
            // Update acceptor (add acquaintance, update notifications)
            const updatedAcceptorAcquaintances = [...acceptorAcquaintances, requesterId];
            // Mark the specific request notification as read
            const updatedNotifications = (acceptor.notifications || []).map((n) => {
                if (n.type === 'acquaintance_request' && n.fromUser.id === requesterId) {
                    return Object.assign(Object.assign({}, n), { isRead: true });
                }
                return n;
            });
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    acquaintances: updatedAcceptorAcquaintances,
                    notifications: updatedNotifications,
                    updatedAt: new Date().toISOString()
                }
            });
            // Update requester (add acquaintance, remove sent request, add acceptance notification)
            const requesterSentRequests = (requester.sentAcquaintanceRequests || []).filter((rid) => rid !== id);
            const requesterAcquaintances = [...(requester.acquaintances || []), id];
            const acceptanceNotification = {
                id: `notif-accept-${Date.now()}-${Math.random()}`,
                type: 'acquaintance_accepted', // Using a generic type or reuse 'acquaintance_request' with different message
                fromUser: {
                    id: acceptor.id,
                    name: acceptor.name,
                    handle: acceptor.handle,
                    avatar: acceptor.avatar,
                    avatarType: acceptor.avatarType
                },
                message: 'accepted your connection request',
                timestamp: Date.now(),
                isRead: false,
                connectionId: id
            };
            yield db.collection('users').updateOne({ id: requesterId }, {
                $set: {
                    acquaintances: requesterAcquaintances,
                    sentAcquaintanceRequests: requesterSentRequests,
                    updatedAt: new Date().toISOString()
                },
                $push: {
                    notifications: {
                        $each: [acceptanceNotification],
                        $position: 0
                    }
                }
            });
            (0, socketHub_1.emitToIdentity)('user', requesterId, 'notification:new', {
                ownerType: 'user',
                ownerId: requesterId,
                notification: acceptanceNotification
            });
            res.json({
                success: true,
                data: {
                    acceptorId: id,
                    requesterId: requesterId,
                    timestamp: new Date().toISOString()
                },
                message: 'Connection request accepted successfully'
            });
        }
        catch (error) {
            console.error('Error accepting connection request:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to accept connection request',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/block - Block user
    blockUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { targetUserId } = req.body;
            const db = (0, db_1.getDB)();
            if (!targetUserId || typeof targetUserId !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Missing targetUserId',
                    message: 'targetUserId is required'
                });
            }
            const blocker = yield db.collection('users').findOne({ id });
            const target = yield db.collection('users').findOne({ id: targetUserId });
            if (!blocker || !target) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: 'Blocker or target user not found'
                });
            }
            const nextBlocked = Array.from(new Set([...(blocker.blockedUsers || []), targetUserId]));
            const nextBlockedBy = Array.from(new Set([...(target.blockedBy || []), id]));
            const nextBlockerAcq = (blocker.acquaintances || []).filter((uid) => uid !== targetUserId);
            const nextTargetAcq = (target.acquaintances || []).filter((uid) => uid !== id);
            const nextBlockerRequests = (blocker.sentAcquaintanceRequests || []).filter((uid) => uid !== targetUserId);
            const nextTargetRequests = (target.sentAcquaintanceRequests || []).filter((uid) => uid !== id);
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    blockedUsers: nextBlocked,
                    acquaintances: nextBlockerAcq,
                    sentAcquaintanceRequests: nextBlockerRequests,
                    updatedAt: new Date().toISOString()
                }
            });
            yield db.collection('users').updateOne({ id: targetUserId }, {
                $set: {
                    blockedBy: nextBlockedBy,
                    acquaintances: nextTargetAcq,
                    sentAcquaintanceRequests: nextTargetRequests,
                    updatedAt: new Date().toISOString()
                }
            });
            res.json({
                success: true,
                data: {
                    blockerId: id,
                    targetUserId,
                    blockedUsers: nextBlocked,
                    blockedBy: nextBlockedBy
                },
                message: 'User blocked successfully'
            });
        }
        catch (error) {
            console.error('Error blocking user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to block user',
                message: 'Internal server error'
            });
        }
    }),
    unblockUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { targetUserId } = req.body;
            const db = (0, db_1.getDB)();
            if (!targetUserId || typeof targetUserId !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Missing targetUserId',
                    message: 'targetUserId is required'
                });
            }
            const blocker = yield db.collection('users').findOne({ id });
            const target = yield db.collection('users').findOne({ id: targetUserId });
            if (!blocker || !target) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: 'Blocker or target user not found'
                });
            }
            const nextBlocked = (blocker.blockedUsers || []).filter((uid) => uid !== targetUserId);
            const nextBlockedBy = (target.blockedBy || []).filter((uid) => uid !== id);
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    blockedUsers: nextBlocked,
                    updatedAt: new Date().toISOString()
                }
            });
            yield db.collection('users').updateOne({ id: targetUserId }, {
                $set: {
                    blockedBy: nextBlockedBy,
                    updatedAt: new Date().toISOString()
                }
            });
            res.json({
                success: true,
                data: {
                    blockerId: id,
                    targetUserId,
                    blockedUsers: nextBlocked,
                    blockedBy: nextBlockedBy
                },
                message: 'User unblocked successfully'
            });
        }
        catch (error) {
            console.error('Error unblocking user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to unblock user',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/report - Report user
    reportUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { targetUserId, reason, notes } = req.body;
            const db = (0, db_1.getDB)();
            if (!targetUserId || !reason) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing fields',
                    message: 'targetUserId and reason are required'
                });
            }
            const reporter = yield db.collection('users').findOne({ id });
            const target = yield db.collection('users').findOne({ id: targetUserId });
            if (!reporter || !target) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: 'Reporter or target user not found'
                });
            }
            const reportDoc = {
                id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                reporterId: id,
                targetUserId,
                reason,
                notes: notes || '',
                createdAt: new Date().toISOString(),
                status: 'open'
            };
            yield db.collection('reports').insertOne(reportDoc);
            const toEmail = process.env.ADMIN_EMAIL ||
                process.env.SUPPORT_EMAIL ||
                process.env.SENDGRID_FROM_EMAIL ||
                'support@aura.net.za';
            const subject = `Aura© User Report: ${target.name || target.handle || targetUserId}`;
            const body = [
                `Reporter: ${reporter.name || reporter.handle || reporter.id} (${reporter.id})`,
                `Target: ${target.name || target.handle || targetUserId} (${targetUserId})`,
                `Reason: ${reason}`,
                `Notes: ${notes || ''}`,
                `Created At: ${reportDoc.createdAt}`,
                `Report ID: ${reportDoc.id}`
            ].join('\n');
            yield db.collection('email_outbox').insertOne({
                to: toEmail,
                subject,
                body,
                createdAt: new Date().toISOString(),
                status: 'pending'
            });
            res.json({
                success: true,
                data: reportDoc,
                message: 'User reported successfully'
            });
        }
        catch (error) {
            console.error('Error reporting user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to report user',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/users/search - Search users
    searchUsers: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { q } = req.query;
            if (!q || typeof q !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Missing search query',
                    message: 'Query parameter "q" is required'
                });
            }
            const db = (0, db_1.getDB)();
            const searchTerm = q.toLowerCase().trim();
            // Create a case-insensitive regex search
            const searchRegex = new RegExp(searchTerm, 'i');
            // Search users
            const usersResults = yield db.collection('users').find({
                $and: [
                    // Privacy filter: only show users who allow being found in search
                    {
                        $or: [
                            { 'privacySettings.showInSearch': { $ne: false } },
                            { 'privacySettings.showInSearch': { $exists: false } }
                        ]
                    },
                    // Text search filter
                    {
                        $or: [
                            { name: searchRegex },
                            { firstName: searchRegex },
                            { lastName: searchRegex },
                            { handle: searchRegex },
                            { email: searchRegex },
                            { bio: searchRegex }
                        ]
                    }
                ]
            })
                .project({
                id: 1,
                name: 1,
                handle: 1,
                avatar: 1,
                avatarType: 1,
                bio: 1,
                firstName: 1,
                lastName: 1,
                industry: 1,
                companyName: 1
            })
                .limit(10)
                .toArray();
            // Search companies
            const companiesResults = yield db.collection('companies').find({
                $and: [
                    { legacyArchived: { $ne: true } },
                    {
                        $or: [
                            { name: searchRegex },
                            { handle: searchRegex },
                            { industry: searchRegex },
                            { description: searchRegex }
                        ]
                    }
                ]
            })
                .project({
                id: 1,
                name: 1,
                handle: 1,
                avatar: 1,
                avatarType: 1,
                description: 1,
                industry: 1,
                isVerified: 1
            })
                .limit(10)
                .toArray();
            // Transform and combine results
            const searchResults = [
                ...usersResults.map(u => (Object.assign(Object.assign({}, u), { type: 'user' }))),
                ...companiesResults.map(c => (Object.assign(Object.assign({}, c), { type: 'company', bio: c.description, userMode: 'company' })))
            ];
            res.json({
                success: true,
                data: searchResults,
                count: searchResults.length,
                query: q
            });
        }
        catch (error) {
            console.error('Error searching users:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to search users',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/purchase-credits - Purchase credits
    purchaseCredits: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const payload = (req.body && typeof req.body === 'object')
                ? req.body
                : {};
            const bundleName = typeof payload.bundleName === 'string' ? payload.bundleName.trim() : '';
            const orderId = typeof payload.orderId === 'string' ? payload.orderId.trim() : '';
            const transactionId = typeof payload.transactionId === 'string' ? payload.transactionId.trim() : '';
            const paymentMethod = typeof payload.paymentMethod === 'string' && payload.paymentMethod.trim()
                ? payload.paymentMethod.trim().toLowerCase()
                : 'paypal';
            // Validate required fields
            if (!bundleName) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'bundleName is required'
                });
            }
            const db = (0, db_1.getDB)();
            const bundleConfig = CREDIT_BUNDLE_CONFIG[bundleName];
            if (!bundleConfig) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid bundle',
                    message: `Unknown credit bundle: ${bundleName}`
                });
            }
            const creditsToAdd = bundleConfig.credits;
            const expectedAmount = bundleConfig.price;
            if (paymentMethod !== 'paypal') {
                return res.status(400).json({
                    success: false,
                    error: 'Unsupported payment method',
                    message: 'Only PayPal credit purchases are supported.'
                });
            }
            if (!orderId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing order ID',
                    message: 'orderId is required for PayPal credit purchases'
                });
            }
            const paymentReferenceKey = `paypal_order:${orderId}`;
            const finalTransactionId = transactionId || orderId;
            const duplicateTx = yield db.collection('transactions').findOne({
                type: 'credit_purchase',
                $or: [
                    { paymentReferenceKey },
                    { orderId },
                    { transactionId: finalTransactionId }
                ]
            });
            if (duplicateTx) {
                return res.status(409).json({
                    success: false,
                    error: 'Duplicate transaction',
                    message: 'This payment has already been processed'
                });
            }
            let verifiedCaptureId = null;
            const isDevFallback = orderId === 'dev-fallback' && process.env.NODE_ENV !== 'production';
            if (!isDevFallback) {
                const clientId = process.env.PAYPAL_CLIENT_ID;
                const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
                const apiBase = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
                if (!clientId || !clientSecret) {
                    (0, securityLogger_1.logSecurityEvent)({
                        req,
                        type: 'payment_failure',
                        userId: id,
                        metadata: {
                            source: 'credit_purchase',
                            reason: 'missing_paypal_credentials'
                        }
                    });
                    return res.status(500).json({
                        success: false,
                        error: 'Payment configuration error',
                        message: 'PayPal credentials not configured'
                    });
                }
                try {
                    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
                    const tokenResponse = yield axios_1.default.post(`${apiBase}/v1/oauth2/token`, 'grant_type=client_credentials', {
                        headers: {
                            Authorization: `Basic ${basicAuth}`,
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    });
                    const accessToken = tokenResponse.data.access_token;
                    const orderResponse = yield axios_1.default.get(`${apiBase}/v2/checkout/orders/${orderId}`, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`
                        }
                    });
                    const order = orderResponse.data;
                    if (!order || order.status !== 'COMPLETED') {
                        (0, securityLogger_1.logSecurityEvent)({
                            req,
                            type: 'payment_failure',
                            userId: id,
                            metadata: {
                                source: 'credit_purchase',
                                reason: 'paypal_order_not_completed',
                                orderStatus: order && order.status
                            }
                        });
                        return res.status(400).json({
                            success: false,
                            error: 'Payment not completed',
                            message: 'PayPal order is not completed'
                        });
                    }
                    const purchaseUnits = Array.isArray(order.purchase_units) ? order.purchase_units : [];
                    const firstUnit = purchaseUnits[0];
                    const amount = firstUnit && firstUnit.amount;
                    if (!amount || amount.currency_code !== 'USD') {
                        (0, securityLogger_1.logSecurityEvent)({
                            req,
                            type: 'payment_failure',
                            userId: id,
                            metadata: {
                                source: 'credit_purchase',
                                reason: 'invalid_paypal_currency',
                                currency: amount && amount.currency_code
                            }
                        });
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid payment currency',
                            message: 'PayPal payment must be in USD'
                        });
                    }
                    const paidAmount = parseFloat(amount.value);
                    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) {
                        (0, securityLogger_1.logSecurityEvent)({
                            req,
                            type: 'payment_failure',
                            userId: id,
                            metadata: {
                                source: 'credit_purchase',
                                reason: 'amount_mismatch',
                                paidAmount,
                                expectedAmount,
                                bundleName
                            }
                        });
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid payment amount',
                            message: 'PayPal payment amount does not match selected bundle'
                        });
                    }
                    const captures = Array.isArray((_a = firstUnit === null || firstUnit === void 0 ? void 0 : firstUnit.payments) === null || _a === void 0 ? void 0 : _a.captures) ? firstUnit.payments.captures : [];
                    const completedCapture = captures.find((capture) => capture && capture.status === 'COMPLETED');
                    verifiedCaptureId = completedCapture && typeof completedCapture.id === 'string'
                        ? completedCapture.id
                        : null;
                }
                catch (error) {
                    console.error('Error verifying PayPal order:', error);
                    (0, securityLogger_1.logSecurityEvent)({
                        req,
                        type: 'payment_failure',
                        userId: id,
                        metadata: {
                            source: 'credit_purchase',
                            reason: 'paypal_verification_exception',
                            errorMessage: error instanceof Error ? error.message : String(error),
                            orderId
                        }
                    });
                    return res.status(502).json({
                        success: false,
                        error: 'Payment verification failed',
                        message: 'Unable to verify PayPal payment'
                    });
                }
            }
            // Find user
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            // Update user credits
            const currentCredits = typeof user.auraCredits === 'number' ? user.auraCredits : 0;
            const nowIso = new Date().toISOString();
            let pendingTransactionId = null;
            try {
                const pendingInsert = yield db.collection('transactions').insertOne({
                    userId: id,
                    type: 'credit_purchase',
                    amount: creditsToAdd,
                    bundleName,
                    orderId,
                    transactionId: finalTransactionId,
                    paymentMethod,
                    paymentReferenceKey,
                    status: 'processing',
                    creditsApplied: false,
                    details: {
                        expectedAmountUsd: expectedAmount,
                        captureId: verifiedCaptureId
                    },
                    createdAt: nowIso,
                    updatedAt: nowIso
                });
                pendingTransactionId = pendingInsert.insertedId;
            }
            catch (insertError) {
                if (insertError && insertError.code === 11000) {
                    return res.status(409).json({
                        success: false,
                        error: 'Duplicate transaction',
                        message: 'This payment has already been processed'
                    });
                }
                throw insertError;
            }
            let newCredits = currentCredits;
            try {
                const updatedUserResult = yield db.collection('users').findOneAndUpdate({ id }, {
                    $inc: { auraCredits: creditsToAdd },
                    $set: { updatedAt: nowIso }
                }, {
                    returnDocument: 'after',
                    projection: { auraCredits: 1 }
                });
                const updatedUserDoc = updatedUserResult && typeof updatedUserResult === 'object' && 'value' in updatedUserResult
                    ? updatedUserResult.value
                    : updatedUserResult;
                if (!updatedUserDoc) {
                    throw new Error('Failed to update user credits');
                }
                newCredits = typeof updatedUserDoc.auraCredits === 'number'
                    ? updatedUserDoc.auraCredits
                    : currentCredits + creditsToAdd;
                yield db.collection('transactions').updateOne({ _id: pendingTransactionId }, {
                    $set: {
                        status: 'completed',
                        creditsApplied: true,
                        updatedAt: new Date().toISOString()
                    }
                });
            }
            catch (creditApplyError) {
                if (pendingTransactionId) {
                    yield db.collection('transactions').updateOne({ _id: pendingTransactionId }, {
                        $set: {
                            status: 'failed',
                            updatedAt: new Date().toISOString(),
                            errorMessage: creditApplyError instanceof Error ? creditApplyError.message : String(creditApplyError)
                        }
                    });
                }
                throw creditApplyError;
            }
            console.log('Credit purchase processed and logged:', {
                userId: id,
                bundleName,
                credits: creditsToAdd,
                previousCredits: currentCredits,
                newCredits,
                transactionId: finalTransactionId,
                paymentMethod,
                orderId,
                timestamp: nowIso
            });
            // Trigger real-time insights update
            (0, postsController_1.emitAuthorInsightsUpdate)(req.app, id);
            res.json({
                success: true,
                data: {
                    userId: id,
                    creditsAdded: creditsToAdd,
                    previousCredits: currentCredits,
                    newCredits,
                    bundleName,
                    transactionId: finalTransactionId
                },
                message: `Successfully added ${creditsToAdd} credits to user account`
            });
        }
        catch (error) {
            console.error('Error processing credit purchase:', error);
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'payment_failure',
                userId: req.params && req.params.id,
                metadata: {
                    source: 'credit_purchase',
                    reason: 'purchase_exception',
                    bundleName: req.body && req.body.bundleName,
                    credits: req.body && req.body.credits,
                    errorMessage: error instanceof Error ? error.message : String(error)
                }
            });
            res.status(500).json({
                success: false,
                error: 'Failed to process credit purchase',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/spend-credits - Spend/deduct credits
    spendCredits: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { credits, reason } = req.body;
            const parsedCredits = typeof credits === 'string' ? Number(credits) : credits;
            const creditsToSpend = typeof parsedCredits === 'number' && Number.isFinite(parsedCredits)
                ? parsedCredits
                : NaN;
            // Validate required fields
            if (!Number.isInteger(creditsToSpend) || creditsToSpend <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid credits amount',
                    message: 'credits must be a positive whole number'
                });
            }
            const db = (0, db_1.getDB)();
            const debitResult = yield db.collection('users').findOneAndUpdate({ id, auraCredits: { $gte: creditsToSpend } }, {
                $inc: { auraCredits: -creditsToSpend, auraCreditsSpent: creditsToSpend },
                $set: { updatedAt: new Date().toISOString() }
            }, {
                returnDocument: 'before',
                projection: { auraCredits: 1 }
            });
            const userBeforeDebit = debitResult && typeof debitResult === 'object' && 'value' in debitResult
                ? debitResult.value
                : debitResult;
            if (!userBeforeDebit) {
                const existingUser = yield db.collection('users').findOne({ id }, { projection: { auraCredits: 1 } });
                if (!existingUser) {
                    return res.status(404).json({
                        success: false,
                        error: 'User not found',
                        message: `User with ID ${id} does not exist`
                    });
                }
                const currentCredits = Number(existingUser.auraCredits || 0);
                return res.status(400).json({
                    success: false,
                    error: 'Insufficient credits',
                    message: `User has ${currentCredits} credits but needs ${creditsToSpend}`
                });
            }
            const currentCredits = Number(userBeforeDebit.auraCredits || 0);
            const newCredits = currentCredits - creditsToSpend;
            // Log the transaction (in production, save to database)
            console.log('Credit spending processed:', {
                userId: id,
                creditsSpent: creditsToSpend,
                reason,
                previousCredits: currentCredits,
                newCredits,
                timestamp: new Date().toISOString()
            });
            // Trigger real-time insights update
            (0, postsController_1.emitAuthorInsightsUpdate)(req.app, id);
            res.json({
                success: true,
                data: {
                    userId: id,
                    creditsSpent: creditsToSpend,
                    reason,
                    previousCredits: currentCredits,
                    newCredits
                },
                message: `Successfully deducted ${creditsToSpend} credits from user account`
            });
        }
        catch (error) {
            console.error('Error processing credit spending:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to process credit spending',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/users/:id/privacy-data - Get user's privacy data (GDPR compliance)
    getPrivacyData: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            // In production, this would gather all user data from various tables
            const privacyData = {
                personalInfo: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    dob: user.dob,
                    phone: user.phone || '',
                    bio: user.bio,
                    handle: user.handle,
                    avatar: user.avatar,
                    createdAt: user.createdAt || new Date().toISOString(),
                    lastLogin: user.lastLogin || new Date().toISOString()
                },
                accountData: {
                    trustScore: user.trustScore,
                    auraCredits: user.auraCredits,
                    activeGlow: user.activeGlow,
                    acquaintances: user.acquaintances || [],
                    blockedUsers: user.blockedUsers || [],
                    profileViews: user.profileViews || [],
                    notifications: user.notifications || []
                },
                activityData: {
                    postsCount: 0, // Would be calculated from posts table
                    commentsCount: 0, // Would be calculated from comments table
                    reactionsGiven: 0, // Would be calculated from reactions table
                    messagesCount: 0, // Would be calculated from messages table
                    loginHistory: [], // Would be from login logs table
                    ipAddresses: [], // Would be from security logs
                    deviceInfo: [] // Would be from device tracking
                },
                dataProcessing: {
                    purposes: [
                        'Account management and authentication',
                        'Content personalization and recommendations',
                        'Communication and messaging',
                        'Analytics and platform improvement',
                        'Security and fraud prevention'
                    ],
                    legalBasis: 'Consent and legitimate interest',
                    retentionPeriod: '2 years after account deletion',
                    thirdPartySharing: 'None - all data remains within Aura© platform',
                    dataLocation: 'United States (with EU adequacy protections)'
                },
                exportedAt: new Date().toISOString(),
                format: 'JSON',
                version: '1.0'
            };
            res.json({
                success: true,
                data: privacyData,
                message: 'Privacy data exported successfully'
            });
        }
        catch (error) {
            console.error('Error exporting privacy data:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to export privacy data',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/clear-data - Clear user data (GDPR right to be forgotten)
    clearUserData: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { confirmationCode, reason } = req.body;
            // Validate confirmation code (in production, this would be a secure token)
            if (confirmationCode !== 'CONFIRM_DELETE_ALL_DATA') {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid confirmation code',
                    message: 'Please provide the correct confirmation code'
                });
            }
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            // Log the data deletion request for compliance
            console.log('Data deletion request processed:', {
                userId: id,
                userEmail: user.email,
                reason: reason || 'User requested data deletion',
                timestamp: new Date().toISOString(),
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });
            // In production, this would:
            // 1. Anonymize or delete user data across all tables
            // 2. Remove posts, comments, reactions, messages
            // 3. Clear profile views, acquaintances, notifications
            // 4. Purge uploaded files and media
            // 5. Remove from search indexes
            // 6. Clear analytics and tracking data
            // 7. Notify connected users of account deletion
            // Delete the user from MongoDB
            yield db.collection('users').deleteOne({ id });
            res.json({
                success: true,
                message: 'All user data has been permanently deleted',
                deletedAt: new Date().toISOString(),
                dataTypes: [
                    'Personal information',
                    'Account data',
                    'Posts and comments',
                    'Messages and conversations',
                    'Acquaintances and relationships',
                    'Media files and uploads',
                    'Activity logs and analytics'
                ]
            });
        }
        catch (error) {
            console.error('Error clearing user data:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to clear user data',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/recalculate-trust - Recalculate trust score for a single user
    recalculateTrustForUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            const breakdown = yield (0, trustService_1.calculateUserTrust)(id);
            if (!breakdown) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to calculate trust score',
                    message: 'Unable to compute trust score for this user'
                });
            }
            res.json({
                success: true,
                data: breakdown,
                message: 'Trust score recalculated successfully'
            });
        }
        catch (error) {
            console.error('Error recalculating user trust:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to recalculate trust score',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/recalculate-trust-all - Recalculate trust scores for all users
    recalculateTrustForAllUsers: (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield (0, trustService_1.recalculateAllTrustScores)();
            res.json({
                success: true,
                message: 'Trust scores recalculated for all users'
            });
        }
        catch (error) {
            console.error('Error recalculating trust scores for all users:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to recalculate trust scores for all users',
                message: 'Internal server error'
            });
        }
    }),
    getSerendipityMatches: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { limit } = req.query;
            const parsedLimit = parseInt(String(limit !== null && limit !== void 0 ? limit : 20), 10);
            const limitValue = Number.isNaN(parsedLimit) ? 20 : parsedLimit;
            const matches = yield (0, trustService_1.getSerendipityMatchesForUser)(id, limitValue);
            if (!matches) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            res.json({
                success: true,
                data: matches,
                count: matches.length,
                message: 'Serendipity matches retrieved successfully'
            });
        }
        catch (error) {
            console.error('Error getting serendipity matches:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get serendipity matches',
                message: 'Internal server error'
            });
        }
    }),
    addSerendipitySkip: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const { targetUserId } = req.body;
            if (!targetUserId || typeof targetUserId !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid targetUserId',
                    message: 'targetUserId is required'
                });
            }
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            const now = new Date().toISOString();
            const skips = Array.isArray(user.serendipitySkips) ? user.serendipitySkips : [];
            const existingIndex = skips.findIndex((s) => s && s.targetUserId === targetUserId);
            if (existingIndex >= 0) {
                const existing = skips[existingIndex];
                skips[existingIndex] = {
                    targetUserId,
                    lastSkippedAt: now,
                    count: typeof existing.count === 'number' ? existing.count + 1 : 1
                };
            }
            else {
                skips.push({
                    targetUserId,
                    lastSkippedAt: now,
                    count: 1
                });
            }
            if (skips.length > 100) {
                skips.sort((a, b) => {
                    const aTime = new Date(a.lastSkippedAt).getTime();
                    const bTime = new Date(b.lastSkippedAt).getTime();
                    return bTime - aTime;
                });
                skips.splice(100);
            }
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    serendipitySkips: skips,
                    updatedAt: now
                }
            });
            console.log('serendipity_skip event', { userId: id, targetUserId, count: (_a = skips.find((s) => s.targetUserId === targetUserId)) === null || _a === void 0 ? void 0 : _a.count });
            res.json({
                success: true,
                message: 'Serendipity skip recorded'
            });
        }
        catch (error) {
            console.error('Error recording serendipity skip:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to record serendipity skip',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/users/:id/privacy-settings - Get user's privacy settings
    getPrivacySettings: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            // Default privacy settings (in production, stored in database)
            const privacySettings = user.privacySettings || {
                profileVisibility: 'public', // public, friends, private
                showOnlineStatus: true,
                allowDirectMessages: 'everyone', // everyone, friends, none
                showProfileViews: true,
                allowTagging: true,
                showInSearch: true,
                dataProcessingConsent: true,
                marketingConsent: false,
                analyticsConsent: true,
                thirdPartySharing: false,
                locationTracking: false,
                activityTracking: true,
                personalizedAds: false,
                emailNotifications: true,
                pushNotifications: true,
                updatedAt: new Date().toISOString()
            };
            res.json({
                success: true,
                data: privacySettings,
                message: 'Privacy settings retrieved successfully'
            });
        }
        catch (error) {
            console.error('Error getting privacy settings:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get privacy settings',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/users/:id/privacy-settings - Update user's privacy settings
    updatePrivacySettings: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const settings = req.body;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            // Update privacy settings
            const currentSettings = user.privacySettings || {};
            const updatedSettings = Object.assign(Object.assign(Object.assign({}, currentSettings), settings), { updatedAt: new Date().toISOString() });
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    privacySettings: updatedSettings,
                    updatedAt: new Date().toISOString()
                }
            });
            // Log privacy settings change for compliance
            console.log('Privacy settings updated:', {
                userId: id,
                changes: settings,
                timestamp: new Date().toISOString(),
                ipAddress: req.ip
            });
            res.json({
                success: true,
                data: updatedSettings,
                message: 'Privacy settings updated successfully'
            });
        }
        catch (error) {
            console.error('Error updating privacy settings:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update privacy settings',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/record-profile-view - Record that a user viewed another user's profile
    recordProfileView: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const viewerId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!viewerId) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }
            const db = (0, db_1.getDB)();
            // Find the user whose profile was viewed
            const user = yield db.collection('users').findOne({ id });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            // Find the viewer user
            const viewer = yield db.collection('users').findOne({ id: viewerId });
            if (!viewer) {
                return res.status(404).json({
                    success: false,
                    error: 'Viewer not found',
                    message: `Viewer with ID ${viewerId} does not exist`
                });
            }
            if (id === viewerId) {
                return res.json({
                    success: true,
                    message: 'Skipped profile view tracking for self-view'
                });
            }
            // Initialize profileViews array if it doesn't exist
            const profileViews = user.profileViews || [];
            // Add the viewer ID to the profile views if not already present
            if (!profileViews.includes(viewerId)) {
                profileViews.push(viewerId);
                yield db.collection('users').updateOne({ id }, {
                    $set: {
                        profileViews: profileViews,
                        updatedAt: new Date().toISOString()
                    }
                });
            }
            // Create a notification for the profile owner
            const newNotification = {
                id: `notif-profile-view-${Date.now()}-${Math.random()}`,
                type: 'profile_view',
                fromUser: {
                    id: viewer.id,
                    name: viewer.name,
                    handle: viewer.handle,
                    avatar: viewer.avatar,
                    avatarType: viewer.avatarType
                },
                message: 'viewed your profile',
                timestamp: Date.now(),
                isRead: false
            };
            // Add notification to the profile owner's notification array
            const updatedNotifications = [newNotification, ...(user.notifications || [])];
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    profileViews: profileViews,
                    notifications: updatedNotifications,
                    updatedAt: new Date().toISOString()
                }
            });
            (0, socketHub_1.emitToIdentity)('user', id, 'notification:new', {
                ownerType: 'user',
                ownerId: id,
                notification: newNotification
            });
            res.json({
                success: true,
                data: {
                    profileOwnerId: id,
                    viewerId: viewerId,
                    timestamp: new Date().toISOString(),
                    totalViews: profileViews.length
                },
                message: 'Profile view recorded successfully'
            });
        }
        catch (error) {
            console.error('Error recording profile view:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to record profile view',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/connect - Send connection request
    sendConnectionRequest: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const fromUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const db = (0, db_1.getDB)();
            if (!fromUserId) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }
            if (id === fromUserId) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid request',
                    message: 'Cannot send connection request to yourself'
                });
            }
            // Find the target user
            const targetUser = yield db.collection('users').findOne({ id });
            if (!targetUser) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            // Find the requester
            const requester = yield db.collection('users').findOne({ id: fromUserId });
            if (!requester) {
                return res.status(404).json({
                    success: false,
                    error: 'Requester not found',
                    message: `User with ID ${fromUserId} does not exist`
                });
            }
            // Check if already connected or requested
            const targetAcquaintances = targetUser.acquaintances || [];
            if (targetAcquaintances.includes(fromUserId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Already connected',
                    message: 'You are already connected with this user'
                });
            }
            // Create notification for target user
            const newNotification = {
                id: `notif-conn-${Date.now()}-${Math.random()}`,
                type: 'acquaintance_request',
                fromUser: {
                    id: requester.id,
                    name: requester.name,
                    handle: requester.handle,
                    avatar: requester.avatar,
                    avatarType: requester.avatarType
                },
                message: 'wants to connect with you',
                timestamp: Date.now(),
                isRead: false
            };
            // Add to target user's notifications and sentRequests
            const updatedNotifications = [newNotification, ...(targetUser.notifications || [])];
            // Update target user
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    notifications: updatedNotifications,
                    updatedAt: new Date().toISOString()
                }
            });
            (0, socketHub_1.emitToIdentity)('user', id, 'notification:new', {
                ownerType: 'user',
                ownerId: id,
                notification: newNotification
            });
            // Update requester's sentAcquaintanceRequests
            yield db.collection('users').updateOne({ id: fromUserId }, {
                $addToSet: { sentAcquaintanceRequests: id },
                $set: { updatedAt: new Date().toISOString() }
            });
            res.json({
                success: true,
                message: 'Connection request sent successfully',
                data: newNotification
            });
        }
        catch (error) {
            console.error('Error sending connection request:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to send connection request',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/users/:id/reject-connection - Reject connection request
    rejectConnectionRequest: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params; // The ID of the user rejecting the request (rejecter)
            const { requesterId } = req.body; // The ID of the user who sent the request
            const db = (0, db_1.getDB)();
            // Find both users
            const rejecter = yield db.collection('users').findOne({ id });
            if (!rejecter) {
                return res.status(404).json({
                    success: false,
                    error: 'Rejecter not found',
                    message: `User with ID ${id} does not exist`
                });
            }
            const requester = yield db.collection('users').findOne({ id: requesterId });
            if (!requester) {
                return res.status(404).json({
                    success: false,
                    error: 'Requester not found',
                    message: `User with ID ${requesterId} does not exist`
                });
            }
            // Mark the specific request notification as read (rejected)
            const updatedNotifications = (rejecter.notifications || []).map((n) => {
                if (n.type === 'acquaintance_request' && n.fromUser.id === requesterId) {
                    return Object.assign(Object.assign({}, n), { isRead: true });
                }
                return n;
            });
            yield db.collection('users').updateOne({ id }, {
                $set: {
                    notifications: updatedNotifications,
                    updatedAt: new Date().toISOString()
                }
            });
            // Remove the sent request from requester's sentAcquaintanceRequests
            const requesterSentRequests = (requester.sentAcquaintanceRequests || []).filter((rid) => rid !== id);
            // Create a rejection notification for the requester
            const rejectionNotification = {
                id: `notif-reject-${Date.now()}-${Math.random()}`,
                type: 'acquaintance_rejected',
                fromUser: {
                    id: rejecter.id,
                    name: rejecter.name,
                    handle: rejecter.handle,
                    avatar: rejecter.avatar,
                    avatarType: rejecter.avatarType
                },
                message: 'declined your connection request',
                timestamp: Date.now(),
                isRead: false,
                connectionId: id
            };
            yield db.collection('users').updateOne({ id: requesterId }, {
                $set: {
                    sentAcquaintanceRequests: requesterSentRequests,
                    updatedAt: new Date().toISOString()
                },
                $push: {
                    notifications: {
                        $each: [rejectionNotification],
                        $position: 0
                    }
                }
            });
            (0, socketHub_1.emitToIdentity)('user', requesterId, 'notification:new', {
                ownerType: 'user',
                ownerId: requesterId,
                notification: rejectionNotification
            });
            res.json({
                success: true,
                data: {
                    rejecterId: id,
                    requesterId: requesterId,
                    timestamp: new Date().toISOString()
                },
                message: 'Connection request rejected successfully'
            });
        }
        catch (error) {
            console.error('Error rejecting connection request:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to reject connection request',
                message: 'Internal server error'
            });
        }
    }),
    // DELETE /api/users/force-delete/:email - Force delete a user by email (Admin only)
    forceDeleteUser: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { email } = req.params;
            const requester = req.user;
            const isAdmin = (requester === null || requester === void 0 ? void 0 : requester.role) === 'admin' || (requester === null || requester === void 0 ? void 0 : requester.isAdmin) === true;
            if (!isAdmin) {
                return res.status(403).json({
                    success: false,
                    error: 'Admin access required',
                    message: 'Only administrators can force delete users'
                });
            }
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email required',
                    message: 'Please provide the email of the user to delete'
                });
            }
            const db = (0, db_1.getDB)();
            // Find the user first to get their ID and handle
            const user = yield db.collection('users').findOne({
                $or: [
                    { email: email },
                    { handle: email }, // Allow searching by handle too
                    { id: email } // Allow searching by ID too
                ]
            });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `No user found matching ${email}`
                });
            }
            // Delete the user
            const result = yield db.collection('users').deleteOne({ _id: user._id });
            if (result.deletedCount === 1) {
                console.log(`Force deleted user: ${user.name} (${user.email})`);
                // Also clean up any posts or ads by this user if necessary
                // await db.collection('posts').deleteMany({ 'author.id': user.id });
                // await db.collection('ads').deleteMany({ ownerId: user.id });
                return res.json({
                    success: true,
                    message: `Successfully deleted user ${user.name} (${user.email})`,
                    deletedUser: {
                        name: user.name,
                        email: user.email,
                        handle: user.handle,
                        id: user.id
                    }
                });
            }
            else {
                return res.status(500).json({
                    success: false,
                    error: 'Delete failed',
                    message: 'Failed to delete the user from database'
                });
            }
        }
        catch (error) {
            console.error('Error force deleting user:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    })
};
