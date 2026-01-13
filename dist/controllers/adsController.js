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
const hashtagUtils_1 = require("../utils/hashtagUtils");
// Mock data - in production this would come from database
const mockAds = [
    {
        id: 'ad-leadership-summit',
        ownerId: '1',
        ownerName: 'James Mitchell',
        ownerAvatar: 'https://picsum.photos/id/7/150/150',
        headline: 'Global Leadership Summit 2025',
        description: 'Join 500+ executives for premier leadership conference. Keynotes, workshops, and networking. #leadership #conference #networking #executives',
        mediaUrl: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?q=80&w=800&auto=format&fit=crop',
        ctaText: 'Register Now',
        ctaLink: '#',
        isSponsored: true,
        placement: 'feed',
        status: 'active',
        subscriptionTier: 'Leadership Pulse',
        reactions: { '🎯': 45, '💼': 28 },
        reactionUsers: { '🎯': ['user1', 'user2'], '💼': ['user3'] },
        userReactions: [],
        expiryDate: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days from now
        hashtags: ['leadership', 'conference', 'networking', 'executives'],
        timestamp: Date.now() - 1800000
    },
    {
        id: 'ad-career-coaching',
        ownerId: '2',
        ownerName: 'Sarah Williams',
        ownerAvatar: 'https://picsum.photos/id/25/150/150',
        headline: 'Executive Career Transformation',
        description: '1-on-1 coaching to help you reach your next career milestone. Limited spots available. #coaching #career #transformation #growth',
        mediaUrl: 'https://images.unsplash.com/photo-1515378791036-0648a3e77b4a?q=80&w=800&auto=format&fit=crop',
        ctaText: 'Book Session',
        ctaLink: '#',
        isSponsored: true,
        placement: 'feed',
        status: 'active',
        subscriptionTier: 'Career Growth',
        reactions: { '🚀': 67, '💡': 34 },
        reactionUsers: { '🚀': ['user4', 'user5'], '💡': ['user6'] },
        userReactions: [],
        expiryDate: Date.now() + (15 * 24 * 60 * 60 * 1000), // 15 days from now
        hashtags: ['coaching', 'career', 'transformation', 'growth'],
        timestamp: Date.now() - 3600000
    }
];
exports.adsController = {
    // GET /api/ads - Get all ads
    getAllAds: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { page = 1, limit = 10, placement, status, ownerId, hashtags } = req.query;
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            let filteredAds = [...mockAds];
            // Filter by placement if specified
            if (placement) {
                filteredAds = filteredAds.filter(ad => ad.placement === placement);
            }
            // Filter by status if specified
            if (status) {
                filteredAds = filteredAds.filter(ad => ad.status === status);
            }
            // Filter by owner if specified
            if (ownerId) {
                filteredAds = filteredAds.filter(ad => ad.ownerId === ownerId);
            }
            // Filter by hashtags if specified
            if (hashtags) {
                const searchTags = Array.isArray(hashtags) ? hashtags : [hashtags];
                filteredAds = (0, hashtagUtils_1.filterByHashtags)(filteredAds, searchTags);
            }
            // Filter out expired ads
            const now = Date.now();
            filteredAds = filteredAds.filter(ad => !ad.expiryDate || ad.expiryDate > now);
            // Add userReactions for current user
            if (currentUserId) {
                filteredAds.forEach((ad) => {
                    if (ad.reactionUsers) {
                        ad.userReactions = Object.keys(ad.reactionUsers).filter(emoji => Array.isArray(ad.reactionUsers[emoji]) && ad.reactionUsers[emoji].includes(currentUserId));
                    }
                    else {
                        ad.userReactions = [];
                    }
                });
            }
            // Pagination
            const startIndex = (Number(page) - 1) * Number(limit);
            const endIndex = startIndex + Number(limit);
            const paginatedAds = filteredAds.slice(startIndex, endIndex);
            res.json({
                success: true,
                data: paginatedAds,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total: filteredAds.length,
                    pages: Math.ceil(filteredAds.length / Number(limit))
                }
            });
        }
        catch (error) {
            console.error('Error fetching ads:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch ads',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/ads/:id - Get ad by ID
    getAdById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const ad = mockAds.find(a => a.id === id);
            if (!ad) {
                return res.status(404).json({
                    success: false,
                    error: 'Ad not found',
                    message: `Ad with ID ${id} does not exist`
                });
            }
            // Add userReactions for current user
            const adWithUserReactions = Object.assign({}, ad);
            if (currentUserId) {
                if (adWithUserReactions.reactionUsers) {
                    adWithUserReactions.userReactions = Object.keys(adWithUserReactions.reactionUsers).filter(emoji => Array.isArray(adWithUserReactions.reactionUsers[emoji]) && adWithUserReactions.reactionUsers[emoji].includes(currentUserId));
                }
                else {
                    adWithUserReactions.userReactions = [];
                }
            }
            res.json({
                success: true,
                data: adWithUserReactions
            });
        }
        catch (error) {
            console.error('Error fetching ad:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch ad',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/ads - Create new ad
    createAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { ownerId, ownerName, ownerAvatar, headline, description, mediaUrl, ctaText, ctaLink, placement, subscriptionTier, durationDays } = req.body;
            // Validate required fields
            if (!ownerId || !headline || !description || !ctaText || !ctaLink) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'ownerId, headline, description, ctaText, and ctaLink are required'
                });
            }
            // Extract hashtags from headline and description
            const hashtags = [
                ...(0, hashtagUtils_1.getHashtagsFromText)(headline),
                ...(0, hashtagUtils_1.getHashtagsFromText)(description)
            ].filter((tag, index, arr) => arr.indexOf(tag) === index); // Remove duplicates
            const newAd = {
                id: `ad-${Date.now()}`,
                ownerId,
                ownerName: ownerName || 'Unknown',
                ownerAvatar: ownerAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${ownerId}`,
                headline,
                description,
                mediaUrl: mediaUrl || '',
                ctaText,
                ctaLink,
                isSponsored: true,
                placement: placement || 'feed',
                status: 'active',
                subscriptionTier: subscriptionTier || 'Basic',
                reactions: {},
                reactionUsers: {},
                userReactions: [],
                hashtags,
                timestamp: Date.now(),
                expiryDate: durationDays ? Date.now() + (durationDays * 24 * 60 * 60 * 1000) : undefined
            };
            // In production, save to database
            mockAds.unshift(newAd);
            res.status(201).json({
                success: true,
                data: newAd,
                message: 'Ad created successfully'
            });
        }
        catch (error) {
            console.error('Error creating ad:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create ad',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/ads/:id - Update ad
    updateAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const updates = req.body;
            const adIndex = mockAds.findIndex(a => a.id === id);
            if (adIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Ad not found',
                    message: `Ad with ID ${id} does not exist`
                });
            }
            // Update ad
            mockAds[adIndex] = Object.assign(Object.assign({}, mockAds[adIndex]), updates);
            res.json({
                success: true,
                data: mockAds[adIndex],
                message: 'Ad updated successfully'
            });
        }
        catch (error) {
            console.error('Error updating ad:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update ad',
                message: 'Internal server error'
            });
        }
    }),
    // DELETE /api/ads/:id - Delete ad
    deleteAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const adIndex = mockAds.findIndex(a => a.id === id);
            if (adIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Ad not found',
                    message: `Ad with ID ${id} does not exist`
                });
            }
            // Remove ad
            mockAds.splice(adIndex, 1);
            res.json({
                success: true,
                message: 'Ad deleted successfully'
            });
        }
        catch (error) {
            console.error('Error deleting ad:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete ad',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/ads/:id/react - Add reaction to ad
    reactToAd: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const { reaction } = req.body;
            const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.id) || req.body.userId; // Prefer authenticated user
            if (!reaction) {
                return res.status(400).json({ success: false, error: 'Missing reaction' });
            }
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User ID required' });
            }
            const adIndex = mockAds.findIndex(a => a.id === id);
            if (adIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Ad not found'
                });
            }
            const ad = mockAds[adIndex];
            // Initialize reaction tracking if not exists
            if (!ad.reactions)
                ad.reactions = {};
            if (!ad.reactionUsers)
                ad.reactionUsers = {};
            if (!ad.userReactions)
                ad.userReactions = [];
            // Check if user already reacted with this emoji
            const usersForEmoji = (ad.reactionUsers[reaction] || []);
            const hasReacted = usersForEmoji.includes(userId);
            let action = 'added';
            if (hasReacted) {
                // Remove reaction
                action = 'removed';
                ad.reactionUsers[reaction] = usersForEmoji.filter((uid) => uid !== userId);
                ad.reactions[reaction] = Math.max(0, (ad.reactions[reaction] || 0) - 1);
                // Remove from reactions object if count reaches 0
                if (ad.reactions[reaction] === 0) {
                    delete ad.reactions[reaction];
                }
                // Clean up empty reaction users array
                if (ad.reactionUsers[reaction].length === 0) {
                    delete ad.reactionUsers[reaction];
                }
            }
            else {
                // Add reaction
                if (!ad.reactionUsers[reaction]) {
                    ad.reactionUsers[reaction] = [];
                }
                ad.reactionUsers[reaction].push(userId);
                ad.reactions[reaction] = (ad.reactions[reaction] || 0) + 1;
            }
            // Update userReactions for response
            ad.userReactions = Object.keys(ad.reactionUsers).filter(emoji => Array.isArray(ad.reactionUsers[emoji]) && ad.reactionUsers[emoji].includes(userId));
            res.json({
                success: true,
                data: ad,
                message: `Reaction ${action} successfully`
            });
        }
        catch (error) {
            console.error('Error adding reaction:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to add reaction',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/ads/:id/status - Update ad status
    updateAdStatus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { status } = req.body;
            if (!['active', 'cancelled'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status',
                    message: 'Status must be either "active" or "cancelled"'
                });
            }
            const adIndex = mockAds.findIndex(a => a.id === id);
            if (adIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Ad not found'
                });
            }
            mockAds[adIndex].status = status;
            res.json({
                success: true,
                data: mockAds[adIndex],
                message: 'Ad status updated successfully'
            });
        }
        catch (error) {
            console.error('Error updating ad status:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update ad status',
                message: 'Internal server error'
            });
        }
    })
};
