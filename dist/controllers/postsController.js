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
exports.postsController = void 0;
const db_1 = require("../db");
const hashtagUtils_1 = require("../utils/hashtagUtils");
const notificationsController_1 = require("./notificationsController");
const s3Upload_1 = require("../utils/s3Upload");
const userUtils_1 = require("../utils/userUtils");
const POSTS_COLLECTION = 'posts';
const USERS_COLLECTION = 'users';
const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';
const postSseClients = [];
const broadcastPostViewUpdate = (payload) => {
    if (!postSseClients.length)
        return;
    const msg = `event: post_view\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of postSseClients) {
        client.res.write(msg);
    }
};
const emitAuthorInsightsUpdate = (app, authorId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        if (!authorId)
            return;
        const io = (app === null || app === void 0 ? void 0 : app.get) && app.get('io');
        if (!io || typeof io.to !== 'function')
            return;
        const db = (0, db_1.getDB)();
        const [agg] = yield db.collection(POSTS_COLLECTION).aggregate([
            { $match: { 'author.id': authorId } },
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
        const topPosts = yield db.collection(POSTS_COLLECTION)
            .find({ 'author.id': authorId })
            .project({ id: 1, content: 1, viewCount: 1, timestamp: 1, isBoosted: 1, radiance: 1 })
            .sort({ viewCount: -1 })
            .limit(5)
            .toArray();
        const user = yield db.collection(USERS_COLLECTION).findOne({ id: authorId }, { projection: { auraCredits: 1, auraCreditsSpent: 1 } });
        io.to(`user:${authorId}`).emit('analytics_update', {
            userId: authorId,
            stats: {
                totals: {
                    totalPosts: (_a = agg === null || agg === void 0 ? void 0 : agg.totalPosts) !== null && _a !== void 0 ? _a : 0,
                    totalViews: (_b = agg === null || agg === void 0 ? void 0 : agg.totalViews) !== null && _b !== void 0 ? _b : 0,
                    boostedPosts: (_c = agg === null || agg === void 0 ? void 0 : agg.boostedPosts) !== null && _c !== void 0 ? _c : 0,
                    totalRadiance: (_d = agg === null || agg === void 0 ? void 0 : agg.totalRadiance) !== null && _d !== void 0 ? _d : 0
                },
                credits: {
                    balance: (_e = user === null || user === void 0 ? void 0 : user.auraCredits) !== null && _e !== void 0 ? _e : 0,
                    spent: (_f = user === null || user === void 0 ? void 0 : user.auraCreditsSpent) !== null && _f !== void 0 ? _f : 0
                },
                topPosts: topPosts.map((p) => {
                    var _a, _b;
                    return ({
                        id: p.id,
                        preview: (p.content || '').slice(0, 120),
                        views: (_a = p.viewCount) !== null && _a !== void 0 ? _a : 0,
                        timestamp: p.timestamp,
                        isBoosted: !!p.isBoosted,
                        radiance: (_b = p.radiance) !== null && _b !== void 0 ? _b : 0
                    });
                })
            }
        });
    }
    catch (err) {
        console.error('emitAuthorInsightsUpdate error', err);
    }
});
exports.postsController = {
    health: (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
        res.json({
            success: true,
            message: 'Posts routes health check ok',
            timestamp: new Date().toISOString(),
            endpoints: [
                'GET /api/posts',
                'GET /api/posts/:id',
                'POST /api/posts/:id/boost',
                'GET /api/posts/stream'
            ]
        });
    }),
    streamEvents: (req, res) => {
        var _a, _b;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        (_b = (_a = res).flushHeaders) === null || _b === void 0 ? void 0 : _b.call(_a);
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        postSseClients.push({ id, res });
        res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        req.on('close', () => {
            const index = postSseClients.findIndex(client => client.id === id);
            if (index !== -1) {
                postSseClients.splice(index, 1);
            }
        });
    },
    // GET /api/posts/search - Search posts
    searchPosts: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { q } = req.query;
            if (!q || typeof q !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Missing search query',
                    message: 'Query parameter q is required'
                });
            }
            const db = (0, db_1.getDB)();
            const query = q.toLowerCase().trim();
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            // Get current user's acquaintances for privacy filtering
            let currentUserAcquaintances = [];
            if (currentUserId) {
                const currentUser = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId });
                currentUserAcquaintances = (currentUser === null || currentUser === void 0 ? void 0 : currentUser.acquaintances) || [];
            }
            const visibilityConditions = [
                { visibility: { $exists: false } },
                { visibility: 'public' }
            ];
            if (currentUserId) {
                visibilityConditions.push({ visibility: 'private', 'author.id': currentUserId }, { visibility: 'acquaintances', 'author.id': currentUserId });
                if (currentUserAcquaintances.length > 0) {
                    visibilityConditions.push({
                        visibility: 'acquaintances',
                        'author.id': { $in: currentUserAcquaintances }
                    });
                }
            }
            // Basic search across content, author fields, and hashtags with privacy filtering
            const pipeline = [
                {
                    $match: {
                        $or: [
                            { content: { $regex: query, $options: 'i' } },
                            { 'author.name': { $regex: query, $options: 'i' } },
                            { 'author.handle': { $regex: query, $options: 'i' } },
                            { hashtags: { $elemMatch: { $regex: query, $options: 'i' } } }
                        ]
                    }
                },
                {
                    $lookup: {
                        from: USERS_COLLECTION,
                        localField: 'author.id',
                        foreignField: 'id',
                        as: 'authorDetails'
                    }
                },
                {
                    $match: {
                        $or: [
                            { 'authorDetails.isPrivate': { $ne: true } },
                            {
                                'authorDetails.isPrivate': true,
                                'author.id': { $in: currentUserAcquaintances }
                            },
                            { 'author.id': currentUserId }
                        ]
                    }
                },
                {
                    $match: {
                        $or: visibilityConditions
                    }
                },
                { $sort: { timestamp: -1 } },
                { $limit: 100 },
                {
                    $project: {
                        authorDetails: 0 // Remove author details from response
                    }
                }
            ];
            const posts = yield db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();
            const transformedPosts = posts.map((post) => {
                if (post.author) {
                    post.author = (0, userUtils_1.transformUser)(post.author);
                }
                return post;
            });
            res.json({ success: true, data: transformedPosts });
        }
        catch (error) {
            console.error('Error searching posts:', error);
            res.status(500).json({ success: false, error: 'Failed to search posts', message: 'Internal server error' });
        }
    }),
    // GET /api/posts - Get all posts (with filters & pagination)
    getAllPosts: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const { page = 1, limit = 20, userId, energy, hashtags } = req.query;
            const db = (0, db_1.getDB)();
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const query = {};
            if (userId)
                query['author.id'] = userId;
            if (energy)
                query.energy = energy;
            if (hashtags) {
                const tags = Array.isArray(hashtags) ? hashtags : [hashtags];
                query.hashtags = { $in: tags };
            }
            // Filter out locked Time Capsules (unless viewing own profile)
            const now = Date.now();
            if (!userId || userId !== currentUserId) {
                // For public feed or other users' profiles, hide locked time capsules
                const orConditions = [
                    { isTimeCapsule: { $ne: true } }, // Regular posts
                    { isTimeCapsule: true, unlockDate: { $lte: now } } // Unlocked time capsules
                ];
                if (currentUserId) {
                    orConditions.push({ isTimeCapsule: true, 'author.id': currentUserId }, // Own time capsules (always visible to author)
                    { isTimeCapsule: true, invitedUsers: currentUserId } // Invited users can see group time capsules
                    );
                }
                query.$or = orConditions;
            }
            else {
                // When viewing own profile, show all posts including locked time capsules
                // No additional filtering needed
            }
            const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
            const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
            // Get current user's acquaintances for privacy filtering
            let currentUserAcquaintances = [];
            if (currentUserId) {
                const currentUser = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId });
                currentUserAcquaintances = (currentUser === null || currentUser === void 0 ? void 0 : currentUser.acquaintances) || [];
            }
            const visibilityConditions = [
                { visibility: { $exists: false } },
                { visibility: 'public' }
            ];
            if (currentUserId) {
                visibilityConditions.push({ visibility: 'private', 'author.id': currentUserId }, { visibility: 'acquaintances', 'author.id': currentUserId });
                if (currentUserAcquaintances.length > 0) {
                    visibilityConditions.push({
                        visibility: 'acquaintances',
                        'author.id': { $in: currentUserAcquaintances }
                    });
                }
            }
            const visibilityMatchStage = {
                $match: {
                    $or: visibilityConditions
                }
            };
            const pipeline = [
                { $match: query },
                {
                    $lookup: {
                        from: USERS_COLLECTION,
                        localField: 'author.id',
                        foreignField: 'id',
                        as: 'authorDetails'
                    }
                },
                {
                    $match: {
                        $or: [
                            { 'authorDetails.isPrivate': { $ne: true } },
                            {
                                'authorDetails.isPrivate': true,
                                'author.id': { $in: currentUserAcquaintances }
                            },
                            { 'author.id': currentUserId }
                        ]
                    }
                },
                ...(!userId || userId !== currentUserId ? [visibilityMatchStage] : []),
                { $sort: { timestamp: -1 } },
                { $skip: (pageNum - 1) * limitNum },
                { $limit: limitNum },
                {
                    $lookup: {
                        from: 'comments',
                        localField: 'id',
                        foreignField: 'postId',
                        as: 'fetchedComments'
                    }
                },
                {
                    $addFields: {
                        commentCount: { $size: '$fetchedComments' },
                        comments: '$fetchedComments',
                        isUnlocked: {
                            $cond: {
                                if: { $eq: ['$isTimeCapsule', true] },
                                then: { $lte: ['$unlockDate', now] },
                                else: true
                            }
                        }
                    }
                },
                {
                    $project: {
                        fetchedComments: 0,
                        authorDetails: 0
                    }
                }
            ];
            const data = yield db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();
            // Get total count with privacy filtering
            const countPipeline = [
                { $match: query },
                {
                    $lookup: {
                        from: USERS_COLLECTION,
                        localField: 'author.id',
                        foreignField: 'id',
                        as: 'authorDetails'
                    }
                },
                {
                    $match: {
                        $or: [
                            { 'authorDetails.isPrivate': { $ne: true } },
                            {
                                'authorDetails.isPrivate': true,
                                'author.id': { $in: currentUserAcquaintances }
                            },
                            { 'author.id': currentUserId }
                        ]
                    }
                },
                ...(!userId || userId !== currentUserId ? [visibilityMatchStage] : []),
                { $count: 'total' }
            ];
            const countResult = yield db.collection(POSTS_COLLECTION).aggregate(countPipeline).toArray();
            const total = ((_b = countResult[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
            // Post-process to add userReactions for the current user
            const transformedData = data.map((post) => {
                if (post.author) {
                    post.author = (0, userUtils_1.transformUser)(post.author);
                }
                if (currentUserId) {
                    if (post.reactionUsers) {
                        post.userReactions = Object.keys(post.reactionUsers).filter(emoji => Array.isArray(post.reactionUsers[emoji]) && post.reactionUsers[emoji].includes(currentUserId));
                    }
                    else {
                        post.userReactions = [];
                    }
                    // Optional: Remove reactionUsers from response to save bandwidth/privacy
                    // delete post.reactionUsers; 
                }
                return post;
            });
            res.json({
                success: true,
                data: transformedData,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                }
            });
        }
        catch (error) {
            console.error('Error fetching posts:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch posts', message: 'Internal server error' });
        }
    }),
    // GET /api/posts/:id - Get post by ID
    getPostById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const pipeline = [
                { $match: { id } },
                // Lookup author details to check privacy settings
                {
                    $lookup: {
                        from: USERS_COLLECTION,
                        localField: 'author.id',
                        foreignField: 'id',
                        as: 'authorDetails'
                    }
                },
                {
                    $lookup: {
                        from: 'comments',
                        localField: 'id',
                        foreignField: 'postId',
                        as: 'fetchedComments'
                    }
                },
                {
                    $addFields: {
                        commentCount: { $size: '$fetchedComments' },
                        comments: '$fetchedComments',
                        // Calculate if time capsule is unlocked
                        isUnlocked: {
                            $cond: {
                                if: { $eq: ['$isTimeCapsule', true] },
                                then: { $lte: ['$unlockDate', Date.now()] },
                                else: true
                            }
                        }
                    }
                },
                { $project: { fetchedComments: 0 } }
            ];
            const posts = yield db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();
            const post = posts[0];
            if (!post) {
                return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
            }
            // Check privacy settings
            const authorDetails = (_b = post.authorDetails) === null || _b === void 0 ? void 0 : _b[0];
            if ((authorDetails === null || authorDetails === void 0 ? void 0 : authorDetails.isPrivate) && currentUserId !== post.author.id) {
                // Check if current user is an acquaintance of the author
                const currentUser = currentUserId ? yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId }) : null;
                const currentUserAcquaintances = (currentUser === null || currentUser === void 0 ? void 0 : currentUser.acquaintances) || [];
                if (!currentUserAcquaintances.includes(post.author.id)) {
                    return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is private' });
                }
            }
            if (post.visibility === 'private' && currentUserId !== post.author.id) {
                return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is private' });
            }
            if (post.visibility === 'acquaintances') {
                if (!currentUserId) {
                    return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is limited to acquaintances' });
                }
                if (currentUserId !== post.author.id) {
                    const currentUser = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId });
                    const currentUserAcquaintances = (currentUser === null || currentUser === void 0 ? void 0 : currentUser.acquaintances) || [];
                    if (!currentUserAcquaintances.includes(post.author.id)) {
                        return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is limited to acquaintances' });
                    }
                }
            }
            // Check if this is a locked Time Capsule that the user shouldn't see
            if (post.isTimeCapsule && post.unlockDate && Date.now() < post.unlockDate) {
                // Only allow the author or invited users to see locked time capsules
                const isAuthor = currentUserId && currentUserId === post.author.id;
                const isInvited = currentUserId && Array.isArray(post.invitedUsers) && post.invitedUsers.includes(currentUserId);
                if (!isAuthor && !isInvited) {
                    return res.status(404).json({ success: false, error: 'Post not found', message: 'Time Capsule is not yet unlocked' });
                }
            }
            delete post.authorDetails;
            // Post-process to add userReactions for the current user
            if (post.author) {
                post.author = (0, userUtils_1.transformUser)(post.author);
            }
            if (currentUserId) {
                if (post.reactionUsers) {
                    post.userReactions = Object.keys(post.reactionUsers).filter(emoji => Array.isArray(post.reactionUsers[emoji]) && post.reactionUsers[emoji].includes(currentUserId));
                }
                else {
                    post.userReactions = [];
                }
            }
            res.json({ success: true, data: post });
        }
        catch (error) {
            console.error('Error fetching post:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch post', message: 'Internal server error' });
        }
    }),
    incrementPostViews: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const { id } = req.params;
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: { id, viewCount: 0 }
                });
            }
            const db = (0, db_1.getDB)();
            const viewerId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const query = { id };
            if (viewerId) {
                query['author.id'] = { $ne: viewerId };
            }
            const result = yield db.collection(POSTS_COLLECTION).findOneAndUpdate(query, {
                $inc: { viewCount: 1 },
                $setOnInsert: { viewCount: 1 }
            }, { returnDocument: 'after' });
            if (!result || !result.value) {
                return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
            }
            const viewCount = result.value.viewCount || 0;
            const authorId = (_b = result.value.author) === null || _b === void 0 ? void 0 : _b.id;
            broadcastPostViewUpdate({ postId: id, viewCount });
            try {
                const io = req.app.get('io');
                if (io && typeof io.emit === 'function') {
                    io.emit('post_view', { postId: id, viewCount });
                }
            }
            catch (e) {
            }
            if (authorId) {
                emitAuthorInsightsUpdate(req.app, authorId);
            }
            res.json({ success: true, data: { id, viewCount } });
        }
        catch (error) {
            res.json({ success: true, data: { id: req.params.id, viewCount: 0 } });
        }
    }),
    // POST /api/posts - Create new post
    createPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { content, mediaUrl, mediaType, mediaKey, mediaMimeType, mediaSize, mediaItems, energy, authorId, taggedUserIds, isTimeCapsule, unlockDate, timeCapsuleType, invitedUsers, timeCapsuleTitle, timezone, visibility, isSystemPost, systemType, ownerId, createdByUserId, id // Allow frontend to provide ID (e.g. for S3 key consistency)
             } = req.body;
            if (!authorId) {
                return res.status(400).json({ success: false, error: 'Missing required fields', message: 'authorId is required' });
            }
            // Handle media uploads
            const files = req.files;
            const uploadedMediaItems = [];
            if (files && files.length > 0) {
                for (const file of files) {
                    const sanitize = (name) => name.replace(/[^a-zA-Z0-9.-]/g, '_');
                    const path = `${authorId}/${Date.now()}-${sanitize(file.originalname)}`;
                    const url = yield (0, s3Upload_1.uploadToS3)('media', path, file.buffer, file.mimetype);
                    const type = file.mimetype.startsWith('video/') ? 'video' : 'image';
                    uploadedMediaItems.push({
                        url,
                        type,
                        key: path,
                        mimeType: file.mimetype,
                        size: file.size,
                        caption: '', // Default caption
                        id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // Generate ID immediately
                    });
                }
            }
            // Merge uploaded items with existing items
            let parsedMediaItems = [];
            if (typeof mediaItems === 'string') {
                try {
                    parsedMediaItems = JSON.parse(mediaItems);
                }
                catch (e) {
                    parsedMediaItems = [];
                }
            }
            else if (Array.isArray(mediaItems)) {
                parsedMediaItems = mediaItems;
            }
            const mergedItems = [...(parsedMediaItems || []), ...uploadedMediaItems];
            // Enhance media items with metrics and order
            const finalMediaItems = mergedItems.map((item, index) => ({
                // Strong rule: use mediaKey as id if available, otherwise create one
                id: item.key || item.id || `mi-${index}-${Date.now()}`,
                url: item.url,
                type: item.type,
                key: item.key,
                mimeType: item.mimeType,
                size: item.size,
                caption: item.caption || '',
                order: index,
                metrics: item.metrics || {
                    views: 0,
                    clicks: 0,
                    saves: 0,
                    dwellMs: 0
                }
            }));
            // Determine primary mediaUrl/Type if not set
            let finalMediaUrl = mediaUrl;
            let finalMediaType = mediaType;
            if (finalMediaItems.length > 0 && !finalMediaUrl) {
                finalMediaUrl = finalMediaItems[0].url;
                finalMediaType = finalMediaItems[0].type;
            }
            const hasText = typeof content === 'string' && content.trim().length > 0;
            const hasMedia = !!finalMediaUrl || (Array.isArray(finalMediaItems) && finalMediaItems.length > 0);
            if (!hasText && !hasMedia) {
                return res.status(400).json({ success: false, error: 'Missing content or media', message: 'A post must include text or at least one media item' });
            }
            const db = (0, db_1.getDB)();
            // Try to fetch full author from DB
            const author = yield db.collection(USERS_COLLECTION).findOne({ id: authorId });
            const authorEmbed = author ? {
                id: author.id,
                firstName: author.firstName,
                lastName: author.lastName,
                name: author.name,
                handle: author.handle,
                avatar: author.avatar,
                avatarKey: author.avatarKey,
                avatarType: author.avatarType || 'image',
                activeGlow: author.activeGlow
            } : {
                id: authorId,
                firstName: 'User',
                lastName: '',
                name: 'User',
                handle: '@user',
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authorId}`,
                avatarType: 'image',
                activeGlow: 'none'
            };
            const safeContent = typeof content === 'string' ? content : '';
            const normalizedVisibility = visibility === 'private' || visibility === 'acquaintances' ? visibility : 'public';
            const hashtags = (0, hashtagUtils_1.getHashtagsFromText)(safeContent);
            const tagList = Array.isArray(taggedUserIds) ? taggedUserIds : [];
            // Use provided ID if available, otherwise generate one
            const postId = id || (isTimeCapsule ? `tc-${Date.now()}` : `post-${Date.now()}`);
            const currentYear = new Date().getFullYear();
            const newPost = Object.assign(Object.assign({ id: postId, author: authorEmbed, authorId: authorEmbed.id, ownerId: ownerId || authorEmbed.id, content: safeContent, mediaUrl: finalMediaUrl || undefined, mediaType: finalMediaType || undefined, mediaKey: mediaKey || undefined, mediaMimeType: mediaMimeType || undefined, mediaSize: mediaSize || undefined, mediaItems: finalMediaItems || undefined, sharedFrom: req.body.sharedFrom || undefined, energy: energy || '🪐 Neutral', radiance: 0, timestamp: Date.now(), visibility: normalizedVisibility, reactions: {}, reactionUsers: {}, userReactions: [], comments: [], isBoosted: false, viewCount: 0, hashtags, taggedUserIds: tagList }, (isTimeCapsule && {
                isTimeCapsule: true,
                unlockDate: unlockDate || null,
                isUnlocked: unlockDate ? Date.now() >= unlockDate : true,
                timeCapsuleType: timeCapsuleType || null,
                invitedUsers: invitedUsers || [],
                timeCapsuleTitle: timeCapsuleTitle || null,
                timezone: timezone || null
            })), (isSystemPost && {
                isSystemPost: true,
                systemType: systemType || null,
                createdByUserId: createdByUserId || authorEmbed.id
            }));
            yield db.collection(POSTS_COLLECTION).insertOne(newPost);
            if (tagList.length > 0) {
                yield Promise.all(tagList
                    .filter(id => id && id !== authorEmbed.id)
                    .map(id => (0, notificationsController_1.createNotificationInDB)(id, 'link', authorEmbed.id, 'mentioned you in a post', postId).catch(err => {
                    console.error('Error creating mention notification:', err);
                })));
            }
            if (isTimeCapsule && timeCapsuleType === 'group' && Array.isArray(invitedUsers) && invitedUsers.length > 0) {
                yield Promise.all(invitedUsers
                    .filter((userId) => userId && userId !== authorEmbed.id)
                    .map((userId) => (0, notificationsController_1.createNotificationInDB)(userId, 'time_capsule_invite', authorEmbed.id, `invited you to a Time Capsule${timeCapsuleTitle ? `: "${timeCapsuleTitle}"` : ''}`, postId).catch(err => {
                    console.error('Error creating time capsule invite notification:', err);
                })));
            }
            res.status(201).json({ success: true, data: newPost, message: 'Post created successfully' });
        }
        catch (error) {
            console.error('Error creating post:', error);
            res.status(500).json({ success: false, error: 'Failed to create post', message: 'Internal server error' });
        }
    }),
    // PUT /api/posts/:id - Update post (author only)
    updatePost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const updates = req.body || {};
            const db = (0, db_1.getDB)();
            const post = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!post) {
                return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
            }
            // Auth check: only author can update
            const user = req.user;
            if (!user || user.id !== post.author.id) {
                return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can update this post' });
            }
            // Prevent changing immutable fields
            delete updates.id;
            delete updates.author;
            delete updates.timestamp;
            if (typeof updates.content === 'string') {
                updates.hashtags = (0, hashtagUtils_1.getHashtagsFromText)(updates.content);
            }
            yield db.collection(POSTS_COLLECTION).updateOne({ id }, { $set: Object.assign(Object.assign({}, updates), { updatedAt: new Date().toISOString() }) });
            const updatedDoc = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!updatedDoc) {
                return res.status(500).json({ success: false, error: 'Failed to update post' });
            }
            if (updatedDoc.author) {
                updatedDoc.author = (0, userUtils_1.transformUser)(updatedDoc.author);
            }
            res.json({ success: true, data: updatedDoc, message: 'Post updated successfully' });
        }
        catch (error) {
            console.error('Error updating post:', error);
            res.status(500).json({ success: false, error: 'Failed to update post', message: 'Internal server error' });
        }
    }),
    // DELETE /api/posts/:id - Delete post (author only)
    deletePost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const post = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!post) {
                return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
            }
            const user = req.user;
            if (!user || user.id !== post.author.id) {
                return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can delete this post' });
            }
            yield db.collection(POSTS_COLLECTION).deleteOne({ id });
            res.json({ success: true, message: 'Post deleted successfully' });
        }
        catch (error) {
            console.error('Error deleting post:', error);
            res.status(500).json({ success: false, error: 'Failed to delete post', message: 'Internal server error' });
        }
    }),
    // POST /api/posts/:id/react - Add reaction to post
    reactToPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            const db = (0, db_1.getDB)();
            const post = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!post) {
                return res.status(404).json({ success: false, error: 'Post not found' });
            }
            // Check if user already reacted with this emoji
            const currentReactionUsers = post.reactionUsers || {};
            const usersForEmoji = currentReactionUsers[reaction] || [];
            const hasReacted = usersForEmoji.includes(userId);
            let action = 'added';
            if (hasReacted) {
                // Remove reaction
                action = 'removed';
                yield db.collection(POSTS_COLLECTION).updateOne({ id }, {
                    $pull: { [`reactionUsers.${reaction}`]: userId },
                    $inc: { [`reactions.${reaction}`]: -1 }
                });
            }
            else {
                // Add reaction
                yield db.collection(POSTS_COLLECTION).updateOne({ id }, {
                    $addToSet: { [`reactionUsers.${reaction}`]: userId },
                    $inc: { [`reactions.${reaction}`]: 1 }
                });
            }
            // Notify author only if adding a reaction and it's not self-reaction
            if (action === 'added' && post.author.id !== userId) {
                yield (0, notificationsController_1.createNotificationInDB)(post.author.id, 'like', userId, `reacted ${reaction} to your post`, id).catch((err) => console.error('Error creating reaction notification:', err));
            }
            // Fetch updated post to return consistent state
            const updatedPostDoc = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!updatedPostDoc) {
                return res.status(500).json({ success: false, error: 'Failed to update reaction' });
            }
            const updatedPost = updatedPostDoc;
            if (updatedPost.reactionUsers) {
                updatedPost.userReactions = Object.keys(updatedPost.reactionUsers).filter(emoji => Array.isArray(updatedPost.reactionUsers[emoji]) && updatedPost.reactionUsers[emoji].includes(userId));
            }
            else {
                updatedPost.userReactions = [];
            }
            if (updatedPost.author && updatedPost.author.id) {
                emitAuthorInsightsUpdate(req.app, updatedPost.author.id);
            }
            res.json({ success: true, data: updatedPost, message: `Reaction ${action} successfully` });
        }
        catch (error) {
            console.error('Error adding reaction:', error);
            res.status(500).json({ success: false, error: 'Failed to add reaction', message: 'Internal server error' });
        }
    }),
    getMyInsights: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        try {
            const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const db = (0, db_1.getDB)();
            const [agg] = yield db.collection(POSTS_COLLECTION).aggregate([
                { $match: { 'author.id': userId } },
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
            const topPosts = yield db.collection(POSTS_COLLECTION)
                .find({ 'author.id': userId })
                .project({ id: 1, content: 1, viewCount: 1, timestamp: 1, isBoosted: 1, radiance: 1 })
                .sort({ viewCount: -1 })
                .limit(5)
                .toArray();
            const user = yield db.collection(USERS_COLLECTION).findOne({ id: userId }, { projection: { auraCredits: 1, auraCreditsSpent: 1 } });
            // Fetch active subscription to determine analytics level
            const activeSub = yield db.collection(AD_SUBSCRIPTIONS_COLLECTION).findOne({
                userId,
                status: 'active',
                $or: [
                    { endDate: { $exists: false } },
                    { endDate: { $gt: Date.now() } }
                ]
            });
            let analyticsLevel = 'none';
            if (activeSub) {
                if (activeSub.packageId === 'pkg-enterprise')
                    analyticsLevel = 'deep';
                else if (activeSub.packageId === 'pkg-pro')
                    analyticsLevel = 'creator';
                else if (activeSub.packageId === 'pkg-starter')
                    analyticsLevel = 'basic';
            }
            // Base data structure
            const responseData = {
                totals: {
                    totalPosts: (_b = agg === null || agg === void 0 ? void 0 : agg.totalPosts) !== null && _b !== void 0 ? _b : 0,
                    totalViews: (_c = agg === null || agg === void 0 ? void 0 : agg.totalViews) !== null && _c !== void 0 ? _c : 0,
                    boostedPosts: (_d = agg === null || agg === void 0 ? void 0 : agg.boostedPosts) !== null && _d !== void 0 ? _d : 0,
                    totalRadiance: (_e = agg === null || agg === void 0 ? void 0 : agg.totalRadiance) !== null && _e !== void 0 ? _e : 0
                },
                credits: {
                    balance: (_f = user === null || user === void 0 ? void 0 : user.auraCredits) !== null && _f !== void 0 ? _f : 0,
                    spent: (_g = user === null || user === void 0 ? void 0 : user.auraCreditsSpent) !== null && _g !== void 0 ? _g : 0
                },
                topPosts: topPosts.map((p) => {
                    var _a, _b;
                    return ({
                        id: p.id,
                        preview: (p.content || '').slice(0, 120),
                        views: (_a = p.viewCount) !== null && _a !== void 0 ? _a : 0,
                        timestamp: p.timestamp,
                        isBoosted: !!p.isBoosted,
                        radiance: (_b = p.radiance) !== null && _b !== void 0 ? _b : 0
                    });
                })
            };
            // Apply gating based on plan
            if (analyticsLevel === 'creator' || analyticsLevel === 'deep') {
                // Additional Creator level stats can be added here in the future
            }
            if (analyticsLevel === 'deep') {
                // Add Deep Neural Analytics (Mock data for now as per requirements)
                responseData.neuralInsights = {
                    audienceBehavior: {
                        retention: 'High',
                        engagementRate: '4.5%',
                        topLocations: ['US', 'UK', 'CA']
                    },
                    timingOptimization: {
                        bestTimeToPost: 'Wednesday 6:00 PM',
                        peakActivity: 'Weekends'
                    },
                    conversionInsights: {
                        clickThroughRate: '2.1%',
                        conversionScore: 85
                    }
                };
            }
            // If level is 'none' (free user), we might want to hide even basic stats or show them as a teaser.
            // For now, returning basic stats (posts/views) is fair for free users too, 
            // but strictly following "Personal Pulse -> basic stats" might imply free users get less.
            // However, preventing errors on frontend is priority.
            return res.json({
                success: true,
                data: responseData,
                planLevel: analyticsLevel
            });
        }
        catch (err) {
            console.error('getMyInsights error', err);
            return res.status(500).json({ success: false, error: 'Failed to load insights' });
        }
    }),
    // POST /api/posts/:id/boost - Boost post and deduct credits server-side
    boostPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const { userId, credits } = req.body;
            const db = (0, db_1.getDB)();
            if (!userId) {
                return res.status(400).json({ success: false, error: 'Missing userId' });
            }
            const post = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!post) {
                return res.status(404).json({ success: false, error: 'Post not found' });
            }
            const parsedCredits = typeof credits === 'string' ? Number(credits) : credits;
            const creditsToSpend = typeof parsedCredits === 'number' && parsedCredits > 0 ? parsedCredits : 100;
            // Fetch user and ensure enough credits
            const user = yield db.collection(USERS_COLLECTION).findOne({ id: userId });
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            const currentCredits = Number(user.auraCredits || 0);
            if (currentCredits < creditsToSpend) {
                return res.status(400).json({ success: false, error: 'Insufficient credits' });
            }
            const newCredits = currentCredits - creditsToSpend;
            const creditUpdateResult = yield db.collection(USERS_COLLECTION).updateOne({ id: userId }, {
                $set: { auraCredits: newCredits, updatedAt: new Date().toISOString() },
                $inc: { auraCreditsSpent: creditsToSpend }
            });
            if (!creditUpdateResult.matchedCount || !creditUpdateResult.modifiedCount) {
                console.error('Failed to update user credits during boost', {
                    userId,
                    creditsToSpend,
                    currentCredits,
                    newCredits,
                    matchedCount: creditUpdateResult.matchedCount,
                    modifiedCount: creditUpdateResult.modifiedCount
                });
                return res.status(500).json({ success: false, error: 'Failed to update user credits' });
            }
            // Apply boost to post (radiance proportional to credits)
            const incRadiance = creditsToSpend * 2; // keep same multiplier as UI
            try {
                yield db.collection(POSTS_COLLECTION).updateOne({ id }, { $set: { isBoosted: true, updatedAt: new Date().toISOString() }, $inc: { radiance: incRadiance } });
                const boostedDoc = yield db.collection(POSTS_COLLECTION).findOne({ id });
                if (!boostedDoc) {
                    yield db.collection(USERS_COLLECTION).updateOne({ id: userId }, { $set: { auraCredits: currentCredits, updatedAt: new Date().toISOString() } });
                    return res.status(500).json({ success: false, error: 'Failed to boost post' });
                }
                try {
                    if (post.author.id !== userId) {
                        yield (0, notificationsController_1.createNotificationInDB)(post.author.id, 'boost_received', userId, 'boosted your post', id);
                    }
                }
                catch (e) {
                    console.error('Error creating boost notification:', e);
                }
                try {
                    const appInstance = req.app;
                    const authorId = ((_a = boostedDoc.author) === null || _a === void 0 ? void 0 : _a.id) || post.author.id;
                    if (authorId) {
                        yield emitAuthorInsightsUpdate(appInstance, authorId);
                    }
                }
                catch (e) {
                    console.error('Error emitting analytics update after boost:', e);
                }
                return res.json({ success: true, data: boostedDoc, message: 'Post boosted successfully' });
            }
            catch (e) {
                yield db.collection(USERS_COLLECTION).updateOne({ id: userId }, { $set: { auraCredits: currentCredits, updatedAt: new Date().toISOString() } });
                throw e;
            }
        }
        catch (error) {
            console.error('Error boosting post:', error);
            res.status(500).json({ success: false, error: 'Failed to boost post', message: 'Internal server error' });
        }
    }),
    // POST /api/posts/:id/share - Share a post
    sharePost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { userId } = req.body;
            const db = (0, db_1.getDB)();
            const post = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!post) {
                return res.status(404).json({ success: false, error: 'Post not found' });
            }
            // Optionally increment a share counter on the post
            yield db.collection(POSTS_COLLECTION).updateOne({ id }, { $inc: { shares: 1 } });
            if (post.author.id !== userId) {
                yield (0, notificationsController_1.createNotificationInDB)(post.author.id, 'share', userId, 'shared your post', id).catch((err) => console.error('Error creating share notification:', err));
            }
            const updated = yield db.collection(POSTS_COLLECTION).findOne({ id });
            res.json({ success: true, data: updated, message: 'Post shared successfully' });
        }
        catch (error) {
            console.error('Error sharing post:', error);
            res.status(500).json({ success: false, error: 'Failed to share post', message: 'Internal server error' });
        }
    }),
    // POST /api/posts/:id/report - Report a post
    reportPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        try {
            const { id } = req.params;
            const { reason, notes } = req.body;
            const db = (0, db_1.getDB)();
            const reporter = req.user;
            if (!reporter || !reporter.id) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            if (!reason) {
                return res.status(400).json({ success: false, error: 'Missing reason' });
            }
            const post = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!post) {
                return res.status(404).json({ success: false, error: 'Post not found' });
            }
            const reportDoc = {
                id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'post',
                postId: id,
                reporterId: reporter.id,
                reason,
                notes: notes || '',
                createdAt: new Date().toISOString(),
                status: 'open'
            };
            yield db.collection('reports').insertOne(reportDoc);
            const toEmail = 'danelloosthuizen3@gmail.com';
            const subject = `Aura Post Report: ${((_a = post.author) === null || _a === void 0 ? void 0 : _a.name) || ((_b = post.author) === null || _b === void 0 ? void 0 : _b.handle) || id}`;
            const body = [
                `Reporter: ${reporter.name || reporter.handle || reporter.id} (${reporter.id})`,
                `Post ID: ${id}`,
                `Author: ${((_c = post.author) === null || _c === void 0 ? void 0 : _c.name) || ((_d = post.author) === null || _d === void 0 ? void 0 : _d.handle) || ((_e = post.author) === null || _e === void 0 ? void 0 : _e.id)}`,
                `Reason: ${reason}`,
                `Notes: ${notes || ''}`,
                `Created At: ${reportDoc.createdAt}`,
                `Report ID: ${reportDoc.id}`,
                `Content: ${(post.content || '').slice(0, 300)}`
            ].join('\n');
            yield db.collection('email_outbox').insertOne({
                to: toEmail,
                subject,
                body,
                createdAt: new Date().toISOString(),
                status: 'pending'
            });
            res.json({ success: true, data: reportDoc, message: 'Post reported successfully' });
        }
        catch (error) {
            console.error('Error reporting post:', error);
            res.status(500).json({ success: false, error: 'Failed to report post', message: 'Internal server error' });
        }
    }),
    // GET /api/posts/hashtags/trending - Get trending hashtags
    getTrendingHashtags: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { limit = 10, hours = 24 } = req.query;
            const db = (0, db_1.getDB)();
            const since = Date.now() - (parseInt(String(hours), 10) || 24) * 60 * 60 * 1000;
            const pipeline = [
                { $match: { timestamp: { $gte: since } } },
                { $unwind: '$hashtags' },
                { $group: { _id: { $toLower: '$hashtags' }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: Math.min(parseInt(String(limit), 10) || 10, 100) }
            ];
            const tags = yield db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();
            res.json({ success: true, data: tags, message: 'Trending hashtags retrieved successfully' });
        }
        catch (error) {
            console.error('Error fetching trending hashtags:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch trending hashtags', message: 'Internal server error' });
        }
    }),
    // POST /api/posts/:id/media/:mediaId/metrics - Update media item metrics
    updateMediaMetrics: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id, mediaId } = req.params;
            const { metric, value } = req.body; // metric: 'views' | 'clicks' | 'saves' | 'dwellMs'
            if (!['views', 'clicks', 'saves', 'dwellMs'].includes(metric)) {
                return res.status(400).json({ success: false, error: 'Invalid metric' });
            }
            const db = (0, db_1.getDB)();
            const updateField = `mediaItems.$[elem].metrics.${metric}`;
            // For dwellMs, we increment by the value provided. For others, we increment by 1.
            const incrementValue = metric === 'dwellMs' ? (Number(value) || 0) : 1;
            // Prepare update object
            const updateDoc = {
                $inc: {
                    [updateField]: incrementValue
                }
            };
            // Also track post totals
            if (metric === 'views') {
                updateDoc.$inc['metrics.totalViews'] = incrementValue;
                updateDoc.$inc['viewCount'] = incrementValue; // Keep legacy field in sync
            }
            else if (metric === 'clicks') {
                updateDoc.$inc['metrics.totalClicks'] = incrementValue;
            }
            else if (metric === 'saves') {
                updateDoc.$inc['metrics.totalSaves'] = incrementValue;
            }
            else if (metric === 'dwellMs') {
                updateDoc.$inc['metrics.totalDwellMs'] = incrementValue;
            }
            const result = yield db.collection(POSTS_COLLECTION).updateOne({ id }, updateDoc, { arrayFilters: [{ "elem.id": mediaId }] });
            if (result.matchedCount === 0) {
                return res.status(404).json({ success: false, error: 'Post or media item not found' });
            }
            res.json({ success: true, message: 'Metrics updated' });
        }
        catch (error) {
            console.error('Error updating media metrics:', error);
            res.status(500).json({ success: false, error: 'Failed to update metrics' });
        }
    }),
    // GET /api/posts/:id/analytics - Get detailed analytics for a post
    getPostAnalytics: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const post = yield db.collection(POSTS_COLLECTION).findOne({ id });
            if (!post) {
                return res.status(404).json({ success: false, error: 'Post not found' });
            }
            // Calculate totals from media items if not present on post
            const mediaItems = post.mediaItems || [];
            let totalViews = ((_a = post.metrics) === null || _a === void 0 ? void 0 : _a.totalViews) || post.viewCount || 0;
            let totalClicks = ((_b = post.metrics) === null || _b === void 0 ? void 0 : _b.totalClicks) || 0;
            let totalSaves = ((_c = post.metrics) === null || _c === void 0 ? void 0 : _c.totalSaves) || 0;
            // If metrics are missing on post level (legacy), aggregate from items
            if (!post.metrics && mediaItems.length > 0) {
                totalViews = 0; // Reset to recalculate from items if metrics obj missing
                totalClicks = 0;
                totalSaves = 0;
                mediaItems.forEach((item) => {
                    if (item.metrics) {
                        totalViews += item.metrics.views || 0;
                        totalClicks += item.metrics.clicks || 0;
                        totalSaves += item.metrics.saves || 0;
                    }
                });
                // Fallback to viewCount if items have no data yet
                if (totalViews === 0 && post.viewCount)
                    totalViews = post.viewCount;
            }
            const items = mediaItems.map((item) => {
                var _a, _b, _c, _d;
                const views = ((_a = item.metrics) === null || _a === void 0 ? void 0 : _a.views) || 0;
                const clicks = ((_b = item.metrics) === null || _b === void 0 ? void 0 : _b.clicks) || 0;
                const saves = ((_c = item.metrics) === null || _c === void 0 ? void 0 : _c.saves) || 0;
                const ctr = views > 0 ? (clicks / views) * 100 : 0;
                return {
                    id: item.id,
                    order: item.order,
                    caption: item.caption,
                    type: item.type,
                    url: item.url,
                    views,
                    clicks,
                    saves,
                    dwellMs: ((_d = item.metrics) === null || _d === void 0 ? void 0 : _d.dwellMs) || 0,
                    ctr: parseFloat(ctr.toFixed(1))
                };
            });
            // Find best item based on Engagement Score (Clicks * 10 + Views)
            let bestItemId = null;
            if (items.length > 0) {
                const sorted = [...items].sort((a, b) => {
                    const scoreA = (a.clicks * 10) + a.views;
                    const scoreB = (b.clicks * 10) + b.views;
                    return scoreB - scoreA;
                });
                bestItemId = sorted[0].id;
            }
            res.json({
                success: true,
                data: {
                    postId: id,
                    totals: {
                        views: totalViews,
                        clicks: totalClicks,
                        saves: totalSaves
                    },
                    items,
                    bestItemId
                }
            });
        }
        catch (error) {
            console.error('Error fetching post analytics:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
        }
    })
};
