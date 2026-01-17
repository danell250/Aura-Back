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
exports.privacyController = void 0;
const db_1 = require("../db");
exports.privacyController = {
    // GET /api/privacy/settings/:userId - Get user's privacy settings
    getPrivacySettings: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: userId });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${userId} does not exist`
                });
            }
            // Default privacy settings if none exist
            const defaultSettings = {
                showInSearch: true,
                showOnlineStatus: true,
                showProfileViews: true,
                allowTagging: true,
                emailNotifications: true,
                analyticsConsent: true,
                profileVisibility: 'public',
                allowDirectMessages: 'everyone',
                dataProcessingConsent: true,
                marketingConsent: false,
                thirdPartySharing: false,
                locationTracking: false,
                activityTracking: true,
                personalizedAds: false,
                pushNotifications: true,
                updatedAt: new Date().toISOString()
            };
            const privacySettings = user.privacySettings || defaultSettings;
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
    // PUT /api/privacy/settings/:userId - Update user's privacy settings
    updatePrivacySettings: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const settings = req.body;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: userId });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${userId} does not exist`
                });
            }
            // Validate settings
            const validSettings = {
                showInSearch: typeof settings.showInSearch === 'boolean' ? settings.showInSearch : true,
                showOnlineStatus: typeof settings.showOnlineStatus === 'boolean' ? settings.showOnlineStatus : true,
                showProfileViews: typeof settings.showProfileViews === 'boolean' ? settings.showProfileViews : true,
                allowTagging: typeof settings.allowTagging === 'boolean' ? settings.allowTagging : true,
                emailNotifications: typeof settings.emailNotifications === 'boolean' ? settings.emailNotifications : true,
                analyticsConsent: typeof settings.analyticsConsent === 'boolean' ? settings.analyticsConsent : true,
                profileVisibility: ['public', 'friends', 'private'].includes(settings.profileVisibility) ? settings.profileVisibility : 'public',
                allowDirectMessages: ['everyone', 'friends', 'none'].includes(settings.allowDirectMessages) ? settings.allowDirectMessages : 'everyone',
                dataProcessingConsent: typeof settings.dataProcessingConsent === 'boolean' ? settings.dataProcessingConsent : true,
                marketingConsent: typeof settings.marketingConsent === 'boolean' ? settings.marketingConsent : false,
                thirdPartySharing: typeof settings.thirdPartySharing === 'boolean' ? settings.thirdPartySharing : false,
                locationTracking: typeof settings.locationTracking === 'boolean' ? settings.locationTracking : false,
                activityTracking: typeof settings.activityTracking === 'boolean' ? settings.activityTracking : true,
                personalizedAds: typeof settings.personalizedAds === 'boolean' ? settings.personalizedAds : false,
                pushNotifications: typeof settings.pushNotifications === 'boolean' ? settings.pushNotifications : true,
                updatedAt: new Date().toISOString()
            };
            // Update privacy settings
            yield db.collection('users').updateOne({ id: userId }, {
                $set: {
                    privacySettings: validSettings,
                    updatedAt: new Date().toISOString()
                }
            });
            // Log privacy settings change for compliance
            console.log('Privacy settings updated:', {
                userId: userId,
                changes: validSettings,
                timestamp: new Date().toISOString(),
                ipAddress: req.ip
            });
            res.json({
                success: true,
                data: validSettings,
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
    // POST /api/privacy/analytics-event - Track analytics event (if user consented)
    trackAnalyticsEvent: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId, eventType, eventData } = req.body;
            if (!userId || !eventType) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'userId and eventType are required'
                });
            }
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: userId });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            // Check if user has consented to analytics
            const privacySettings = user.privacySettings || {};
            if (!privacySettings.analyticsConsent) {
                return res.json({
                    success: true,
                    message: 'Analytics tracking skipped - user has not consented'
                });
            }
            // Store analytics event (anonymized)
            const analyticsEvent = {
                id: `analytics-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                userId: userId, // In production, this might be hashed for privacy
                eventType: eventType,
                eventData: eventData || {},
                timestamp: new Date().toISOString(),
                userAgent: req.get('User-Agent'),
                ipAddress: req.ip // In production, this might be anonymized
            };
            // In production, you'd store this in a separate analytics collection
            // For now, we'll just log it
            console.log('Analytics event tracked:', analyticsEvent);
            res.json({
                success: true,
                message: 'Analytics event tracked successfully'
            });
        }
        catch (error) {
            console.error('Error tracking analytics event:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to track analytics event',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/privacy/searchable-users - Get users that allow being found in search
    getSearchableUsers: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { q } = req.query;
            const db = (0, db_1.getDB)();
            // Build query to only include users who allow being found in search
            const searchQuery = {
                $or: [
                    { 'privacySettings.showInSearch': true },
                    { 'privacySettings.showInSearch': { $exists: false } } // Default to true if not set
                ]
            };
            // Add text search if query provided
            if (q && typeof q === 'string') {
                const searchTerm = q.toLowerCase().trim();
                const searchRegex = new RegExp(searchTerm, 'i');
                searchQuery.$and = [
                    { $or: searchQuery.$or }, // Keep the privacy filter
                    {
                        $or: [
                            { name: searchRegex },
                            { firstName: searchRegex },
                            { lastName: searchRegex },
                            { handle: searchRegex },
                            { email: searchRegex },
                            { bio: searchRegex },
                            { companyName: searchRegex },
                            { industry: searchRegex }
                        ]
                    }
                ];
                delete searchQuery.$or; // Remove the original $or since we're using $and now
            }
            const searchableUsers = yield db.collection('users').find(searchQuery).toArray();
            res.json({
                success: true,
                data: searchableUsers,
                count: searchableUsers.length,
                query: q
            });
        }
        catch (error) {
            console.error('Error getting searchable users:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get searchable users',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/privacy/profile-view - Record profile view (if user allows it)
    recordProfileView: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { profileOwnerId, viewerId } = req.body;
            if (!profileOwnerId || !viewerId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'profileOwnerId and viewerId are required'
                });
            }
            const db = (0, db_1.getDB)();
            // Get profile owner
            const profileOwner = yield db.collection('users').findOne({ id: profileOwnerId });
            if (!profileOwner) {
                return res.status(404).json({
                    success: false,
                    error: 'Profile owner not found'
                });
            }
            // Check if profile owner allows profile view tracking
            const privacySettings = profileOwner.privacySettings || {};
            if (!privacySettings.showProfileViews && privacySettings.showProfileViews !== undefined) {
                return res.json({
                    success: true,
                    message: 'Profile view not recorded - user has disabled profile view tracking'
                });
            }
            // Get viewer
            const viewer = yield db.collection('users').findOne({ id: viewerId });
            if (!viewer) {
                return res.status(404).json({
                    success: false,
                    error: 'Viewer not found'
                });
            }
            // Record the profile view (ensure viewer is present at least once)
            const profileViews = profileOwner.profileViews || [];
            if (!profileViews.includes(viewerId)) {
                profileViews.push(viewerId);
                yield db.collection('users').updateOne({ id: profileOwnerId }, {
                    $set: {
                        profileViews: profileViews,
                        updatedAt: new Date().toISOString()
                    }
                });
            }
            const newNotification = {
                id: `notif-view-${Date.now()}-${Math.random()}`,
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
            yield db.collection('users').updateOne({ id: profileOwnerId }, {
                $push: {
                    notifications: {
                        $each: [newNotification],
                        $position: 0
                    }
                }
            });
            console.log('Profile view notification created:', {
                profileOwnerId,
                viewerId,
                viewerName: viewer.name,
                timestamp: new Date().toISOString()
            });
            res.json({
                success: true,
                data: {
                    profileOwnerId,
                    viewerId,
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
    // GET /api/privacy/online-status/:userId - Get user's online status (if they allow it)
    getOnlineStatus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: userId });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            // Check if user allows showing online status
            const privacySettings = user.privacySettings || {};
            if (!privacySettings.showOnlineStatus && privacySettings.showOnlineStatus !== undefined) {
                return res.json({
                    success: true,
                    data: {
                        userId,
                        isOnline: false,
                        showStatus: false
                    },
                    message: 'User has disabled online status visibility'
                });
            }
            // In production, you'd check actual online status from session/socket data
            // For now, we'll simulate based on last login
            const lastLogin = user.lastLogin ? new Date(user.lastLogin).getTime() : 0;
            const now = Date.now();
            const isOnline = (now - lastLogin) < (15 * 60 * 1000); // Online if active in last 15 minutes
            res.json({
                success: true,
                data: {
                    userId,
                    isOnline,
                    showStatus: true,
                    lastSeen: user.lastLogin
                },
                message: 'Online status retrieved successfully'
            });
        }
        catch (error) {
            console.error('Error getting online status:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get online status',
                message: 'Internal server error'
            });
        }
    })
};
