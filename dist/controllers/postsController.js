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
// MongoDB collection names
const POSTS_COLLECTION = 'posts';
const USERS_COLLECTION = 'users';
exports.postsController = {
    // GET /api/posts/search - Search posts
    searchPosts: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            // Basic search across content, author fields, and hashtags
            const posts = yield db.collection(POSTS_COLLECTION)
                .find({
                $or: [
                    { content: { $regex: query, $options: 'i' } },
                    { 'author.name': { $regex: query, $options: 'i' } },
                    { 'author.handle': { $regex: query, $options: 'i' } },
                    { hashtags: { $elemMatch: { $regex: query, $options: 'i' } } }
                ]
            })
                .sort({ timestamp: -1 })
                .limit(100)
                .toArray();
            res.json({ success: true, data: posts });
        }
        catch (error) {
            console.error('Error searching posts:', error);
            res.status(500).json({ success: false, error: 'Failed to search posts', message: 'Internal server error' });
        }
    }),
    // GET /api/posts - Get all posts (with filters & pagination)
    getAllPosts: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
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
                query.$or = [
                    { isTimeCapsule: { $ne: true } }, // Regular posts
                    { isTimeCapsule: true, unlockDate: { $lte: now } }, // Unlocked time capsules
                    { isTimeCapsule: true, 'author.id': currentUserId } // Own time capsules (always visible to author)
                ];
            }
            else {
                // When viewing own profile, show all posts including locked time capsules
                // No additional filtering needed
            }
            const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
            const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
            const total = yield db.collection(POSTS_COLLECTION).countDocuments(query);
            const pipeline = [
                { $match: query },
                { $sort: { timestamp: -1 } },
                { $skip: (pageNum - 1) * limitNum },
                { $limit: limitNum },
                // Lookup comments to get count and preview
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
                        // Populate comments with all fetched comments so they load immediately
                        // If there are too many, we might want to slice, but for now this solves "immediate load"
                        comments: '$fetchedComments',
                        // Calculate if time capsule is unlocked
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
                        fetchedComments: 0
                    }
                }
            ];
            const data = yield db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();
            // Post-process to add userReactions for the current user
            if (currentUserId) {
                data.forEach((post) => {
                    if (post.reactionUsers) {
                        post.userReactions = Object.keys(post.reactionUsers).filter(emoji => Array.isArray(post.reactionUsers[emoji]) && post.reactionUsers[emoji].includes(currentUserId));
                    }
                    else {
                        post.userReactions = [];
                    }
                    // Optional: Remove reactionUsers from response to save bandwidth/privacy
                    // delete post.reactionUsers; 
                });
            }
            res.json({
                success: true,
                data,
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
        var _a;
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const pipeline = [
                { $match: { id } },
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
            // Check if this is a locked Time Capsule that the user shouldn't see
            if (post.isTimeCapsule && post.unlockDate && Date.now() < post.unlockDate) {
                // Only allow the author to see their own locked time capsules
                if (!currentUserId || currentUserId !== post.author.id) {
                    return res.status(404).json({ success: false, error: 'Post not found', message: 'Time Capsule is not yet unlocked' });
                }
            }
            // Post-process to add userReactions for the current user
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
    // POST /api/posts - Create new post
    createPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { content, mediaUrl, mediaType, energy, authorId, 
            // Time Capsule specific fields
            isTimeCapsule, unlockDate, timeCapsuleType, invitedUsers, timeCapsuleTitle } = req.body;
            if (!content || !authorId) {
                return res.status(400).json({ success: false, error: 'Missing required fields', message: 'content and authorId are required' });
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
            const hashtags = (0, hashtagUtils_1.getHashtagsFromText)(content);
            const postId = isTimeCapsule ? `tc-${Date.now()}` : `post-${Date.now()}`;
            const newPost = Object.assign({ id: postId, author: authorEmbed, content, mediaUrl: mediaUrl || undefined, mediaType: mediaType || undefined, energy: energy || '🪐 Neutral', radiance: 0, timestamp: Date.now(), reactions: {}, reactionUsers: {}, userReactions: [], comments: [], isBoosted: false, hashtags }, (isTimeCapsule && {
                isTimeCapsule: true,
                unlockDate: unlockDate || null,
                isUnlocked: unlockDate ? Date.now() >= unlockDate : true,
                timeCapsuleType: timeCapsuleType || null,
                invitedUsers: invitedUsers || [],
                timeCapsuleTitle: timeCapsuleTitle || null
            }));
            yield db.collection(POSTS_COLLECTION).insertOne(newPost);
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
            res.json({ success: true, data: updatedPost, message: `Reaction ${action} successfully` });
        }
        catch (error) {
            console.error('Error adding reaction:', error);
            res.status(500).json({ success: false, error: 'Failed to add reaction', message: 'Internal server error' });
        }
    }),
    // POST /api/posts/:id/boost - Boost post and deduct credits server-side
    boostPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            // Determine credits to spend, default to 100 if not provided
            const creditsToSpend = typeof credits === 'number' && credits > 0 ? credits : 100;
            // Fetch user and ensure enough credits
            const user = yield db.collection(USERS_COLLECTION).findOne({ id: userId });
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            const currentCredits = user.auraCredits || 0;
            if (currentCredits < creditsToSpend) {
                return res.status(400).json({ success: false, error: 'Insufficient credits' });
            }
            // Deduct credits
            const decRes = yield db.collection(USERS_COLLECTION).updateOne({ id: userId, auraCredits: { $gte: creditsToSpend } }, { $inc: { auraCredits: -creditsToSpend }, $set: { updatedAt: new Date().toISOString() } });
            if (decRes.matchedCount === 0) {
                return res.status(400).json({ success: false, error: 'Insufficient credits' });
            }
            // Apply boost to post (radiance proportional to credits)
            const incRadiance = creditsToSpend * 2; // keep same multiplier as UI
            try {
                yield db.collection(POSTS_COLLECTION).updateOne({ id }, { $set: { isBoosted: true, updatedAt: new Date().toISOString() }, $inc: { radiance: incRadiance } });
                const boostedDoc = yield db.collection(POSTS_COLLECTION).findOne({ id });
                if (!boostedDoc) {
                    // Rollback credits if somehow no doc
                    yield db.collection(USERS_COLLECTION).updateOne({ id: userId }, { $inc: { auraCredits: creditsToSpend }, $set: { updatedAt: new Date().toISOString() } });
                    return res.status(500).json({ success: false, error: 'Failed to boost post' });
                }
                return res.json({ success: true, data: boostedDoc, message: 'Post boosted successfully' });
            }
            catch (e) {
                // Rollback user credits if boost failed
                yield db.collection(USERS_COLLECTION).updateOne({ id: userId }, { $inc: { auraCredits: creditsToSpend }, $set: { updatedAt: new Date().toISOString() } });
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
    })
};
