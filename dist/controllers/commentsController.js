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
exports.commentsController = void 0;
const db_1 = require("../db");
const notificationsController_1 = require("./notificationsController");
const userUtils_1 = require("../utils/userUtils");
const COMMENTS_COLLECTION = 'comments';
const USERS_COLLECTION = 'users';
exports.commentsController = {
    // GET /api/posts/:postId/comments - Get comments for a post
    getCommentsByPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { postId } = req.params;
            const { page = 1, limit = 50 } = req.query;
            const db = (0, db_1.getDB)();
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
            const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
            const query = { postId };
            const total = yield db.collection(COMMENTS_COLLECTION).countDocuments(query);
            const data = yield db.collection(COMMENTS_COLLECTION)
                .find(query)
                .sort({ timestamp: 1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .toArray();
            // Post-process to add userReactions for the current user
            data.forEach((comment) => {
                if (comment.author) {
                    comment.author = (0, userUtils_1.transformUser)(comment.author);
                }
            });
            if (currentUserId) {
                data.forEach((comment) => {
                    if (comment.reactionUsers) {
                        comment.userReactions = Object.keys(comment.reactionUsers).filter(emoji => Array.isArray(comment.reactionUsers[emoji]) && comment.reactionUsers[emoji].includes(currentUserId));
                    }
                    else {
                        comment.userReactions = [];
                    }
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
            console.error('Error fetching comments:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch comments', message: 'Internal server error' });
        }
    }),
    // GET /api/comments/:id - Get comment by ID
    getCommentById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const comment = yield db.collection(COMMENTS_COLLECTION).findOne({ id });
            if (!comment) {
                return res.status(404).json({ success: false, error: 'Comment not found', message: `Comment with ID ${id} does not exist` });
            }
            res.json({ success: true, data: comment });
        }
        catch (error) {
            console.error('Error fetching comment:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch comment', message: 'Internal server error' });
        }
    }),
    createComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        try {
            const { postId } = req.params;
            const { text, authorId, parentId, taggedUserIds } = req.body;
            if (!text || !authorId) {
                return res.status(400).json({ success: false, error: 'Missing required fields', message: 'text and authorId are required' });
            }
            const db = (0, db_1.getDB)();
            const author = yield db.collection(USERS_COLLECTION).findOne({ id: authorId });
            const authorEmbed = author ? {
                id: author.id,
                firstName: author.firstName,
                lastName: author.lastName,
                name: author.name,
                handle: author.handle,
                avatar: author.avatar,
                avatarKey: author.avatarKey,
                avatarType: author.avatarType || 'image'
            } : {
                id: authorId,
                firstName: 'User',
                lastName: '',
                name: 'User',
                handle: '@user',
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authorId}`,
                avatarType: 'image'
            };
            const tagList = Array.isArray(taggedUserIds) ? taggedUserIds : [];
            const newComment = {
                id: `comment-${Date.now()}`,
                postId,
                author: authorEmbed,
                text,
                timestamp: Date.now(),
                parentId: parentId || null,
                reactions: {},
                reactionUsers: {},
                userReactions: [],
                taggedUserIds: tagList
            };
            yield db.collection(COMMENTS_COLLECTION).insertOne(newComment);
            try {
                const post = yield db.collection('posts').findOne({ id: postId });
                if (post && post.author && post.author.id && post.author.id !== authorId) {
                    yield (0, notificationsController_1.createNotificationInDB)(post.author.id, 'comment', authorId, 'commented on your post', postId);
                }
                if (tagList.length > 0) {
                    const uniqueTagIds = Array.from(new Set(tagList)).filter(id => id && id !== authorEmbed.id);
                    yield Promise.all(uniqueTagIds.map(id => (0, notificationsController_1.createNotificationInDB)(id, 'link', authorEmbed.id, 'mentioned you in a comment', postId).catch(err => {
                        console.error('Error creating comment mention notification:', err);
                    })));
                }
                if (post && post.author && post.author.id) {
                    try {
                        const authorIdForAnalytics = post.author.id;
                        const [agg] = yield db.collection('posts').aggregate([
                            { $match: { 'author.id': authorIdForAnalytics } },
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
                            .find({ 'author.id': authorIdForAnalytics })
                            .project({ id: 1, content: 1, viewCount: 1, timestamp: 1, isBoosted: 1, radiance: 1 })
                            .sort({ viewCount: -1 })
                            .limit(5)
                            .toArray();
                        const user = yield db.collection(USERS_COLLECTION).findOne({ id: authorIdForAnalytics }, { projection: { auraCredits: 1, auraCreditsSpent: 1 } });
                        const appInstance = req.app;
                        const io = (appInstance === null || appInstance === void 0 ? void 0 : appInstance.get) && appInstance.get('io');
                        if (io && typeof io.to === 'function') {
                            io.to(`user:${authorIdForAnalytics}`).emit('analytics_update', {
                                userId: authorIdForAnalytics,
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
                    }
                    catch (err) {
                        console.error('Error emitting analytics update for comment:', err);
                    }
                }
            }
            catch (e) {
                console.error('Error creating comment notification:', e);
            }
            if (newComment.author) {
                newComment.author = (0, userUtils_1.transformUser)(newComment.author);
            }
            res.status(201).json({ success: true, data: newComment, message: 'Comment created successfully' });
        }
        catch (error) {
            console.error('Error creating comment:', error);
            res.status(500).json({ success: false, error: 'Failed to create comment', message: 'Internal server error' });
        }
    }),
    // PUT /api/comments/:id - Update comment (author-only)
    updateComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { text } = req.body;
            const db = (0, db_1.getDB)();
            const existing = yield db.collection(COMMENTS_COLLECTION).findOne({ id });
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Comment not found', message: `Comment with ID ${id} does not exist` });
            }
            const user = req.user;
            if (!user || user.id !== existing.author.id) {
                return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can update this comment' });
            }
            const updates = {};
            if (typeof text === 'string')
                updates.text = text;
            updates.updatedAt = new Date().toISOString();
            yield db.collection(COMMENTS_COLLECTION).updateOne({ id }, { $set: updates });
            const updated = yield db.collection(COMMENTS_COLLECTION).findOne({ id });
            res.json({ success: true, data: updated, message: 'Comment updated successfully' });
        }
        catch (error) {
            console.error('Error updating comment:', error);
            res.status(500).json({ success: false, error: 'Failed to update comment', message: 'Internal server error' });
        }
    }),
    // DELETE /api/comments/:id - Delete comment (author-only)
    deleteComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const existing = yield db.collection(COMMENTS_COLLECTION).findOne({ id });
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Comment not found', message: `Comment with ID ${id} does not exist` });
            }
            const user = req.user;
            if (!user || user.id !== existing.author.id) {
                return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can delete this comment' });
            }
            yield db.collection(COMMENTS_COLLECTION).deleteOne({ id });
            res.json({ success: true, message: 'Comment deleted successfully' });
        }
        catch (error) {
            console.error('Error deleting comment:', error);
            res.status(500).json({ success: false, error: 'Failed to delete comment', message: 'Internal server error' });
        }
    }),
    // POST /api/comments/:id/react - Add reaction to comment
    reactToComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            const comment = yield db.collection(COMMENTS_COLLECTION).findOne({ id });
            if (!comment) {
                return res.status(404).json({ success: false, error: 'Comment not found' });
            }
            // Check if user already reacted with this emoji
            const currentReactionUsers = comment.reactionUsers || {};
            const usersForEmoji = currentReactionUsers[reaction] || [];
            const hasReacted = usersForEmoji.includes(userId);
            let action = 'added';
            if (hasReacted) {
                // Remove reaction
                action = 'removed';
                yield db.collection(COMMENTS_COLLECTION).updateOne({ id }, {
                    $pull: { [`reactionUsers.${reaction}`]: userId },
                    $inc: { [`reactions.${reaction}`]: -1 }
                });
            }
            else {
                // Add reaction
                yield db.collection(COMMENTS_COLLECTION).updateOne({ id }, {
                    $addToSet: { [`reactionUsers.${reaction}`]: userId },
                    $inc: { [`reactions.${reaction}`]: 1 }
                });
            }
            // Fetch updated comment to return consistent state
            const updatedCommentDoc = yield db.collection(COMMENTS_COLLECTION).findOne({ id });
            if (!updatedCommentDoc) {
                return res.status(500).json({ success: false, error: 'Failed to update reaction' });
            }
            const updatedComment = updatedCommentDoc;
            if (updatedComment.author) {
                updatedComment.author = (0, userUtils_1.transformUser)(updatedComment.author);
            }
            if (updatedComment.reactionUsers) {
                updatedComment.userReactions = Object.keys(updatedComment.reactionUsers).filter(emoji => Array.isArray(updatedComment.reactionUsers[emoji]) && updatedComment.reactionUsers[emoji].includes(userId));
            }
            else {
                updatedComment.userReactions = [];
            }
            res.json({ success: true, data: updatedComment, message: `Reaction ${action} successfully` });
        }
        catch (error) {
            console.error('Error adding reaction:', error);
            res.status(500).json({ success: false, error: 'Failed to add reaction', message: 'Internal server error' });
        }
    })
};
