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
const postsController_1 = require("./postsController");
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
            // Extract unique author IDs to fetch latest profile data
            const authorIds = [...new Set(data.map((c) => { var _a; return (_a = c.author) === null || _a === void 0 ? void 0 : _a.id; }).filter(Boolean))];
            // Fetch latest user details to ensure avatars/names are up-to-date
            const authors = yield db.collection(USERS_COLLECTION)
                .find({ id: { $in: authorIds } })
                .project({
                id: 1, firstName: 1, lastName: 1, name: 1, handle: 1,
                avatar: 1, avatarKey: 1, avatarType: 1, isVerified: 1
            })
                .toArray();
            const authorMap = new Map(authors.map((u) => [u.id, u]));
            // Post-process to update author info and add userReactions
            data.forEach((comment) => {
                var _a;
                // Update author with latest data if available
                if (((_a = comment.author) === null || _a === void 0 ? void 0 : _a.id) && authorMap.has(comment.author.id)) {
                    const latestAuthor = authorMap.get(comment.author.id);
                    comment.author = (0, userUtils_1.transformUser)(latestAuthor);
                }
                else if (comment.author) {
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
        var _a;
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const comment = yield db.collection(COMMENTS_COLLECTION).findOne({ id });
            if (!comment) {
                return res.status(404).json({ success: false, error: 'Comment not found', message: `Comment with ID ${id} does not exist` });
            }
            // Fetch latest author info
            if ((_a = comment.author) === null || _a === void 0 ? void 0 : _a.id) {
                const latestAuthor = yield db.collection(USERS_COLLECTION).findOne({ id: comment.author.id });
                if (latestAuthor) {
                    comment.author = (0, userUtils_1.transformUser)(latestAuthor);
                }
                else {
                    comment.author = (0, userUtils_1.transformUser)(comment.author);
                }
            }
            res.json({ success: true, data: comment });
        }
        catch (error) {
            console.error('Error fetching comment:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch comment', message: 'Internal server error' });
        }
    }),
    createComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
            }
            const { postId } = req.params;
            const { text, parentId, taggedUserIds, tempId } = req.body;
            if (!text) {
                return res.status(400).json({ success: false, error: 'Missing required fields', message: 'text is required' });
            }
            const db = (0, db_1.getDB)();
            const author = yield db.collection(USERS_COLLECTION).findOne({ id: authenticatedUserId });
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
                id: authenticatedUserId,
                firstName: 'User',
                lastName: '',
                name: 'User',
                handle: '@user',
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authenticatedUserId}`,
                avatarType: 'image',
                activeGlow: undefined
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
                if (post && post.author && post.author.id && post.author.id !== authenticatedUserId) {
                    yield (0, notificationsController_1.createNotificationInDB)(post.author.id, 'comment', authenticatedUserId, 'commented on your post', postId);
                }
                if (tagList.length > 0) {
                    const uniqueTagIds = Array.from(new Set(tagList)).filter(id => id && id !== authorEmbed.id);
                    yield Promise.all(uniqueTagIds.map(id => (0, notificationsController_1.createNotificationInDB)(id, 'link', authorEmbed.id, 'mentioned you in a comment', postId).catch(err => {
                        console.error('Error creating comment mention notification:', err);
                    })));
                }
                if (post && post.author && post.author.id) {
                    (0, postsController_1.emitAuthorInsightsUpdate)(req.app, post.author.id, ((_b = post.author) === null || _b === void 0 ? void 0 : _b.type) === 'company' ? 'company' : 'user');
                }
            }
            catch (e) {
                console.error('Error creating comment notification:', e);
            }
            if (newComment.author) {
                newComment.author = (0, userUtils_1.transformUser)(newComment.author);
            }
            // Emit real-time event for new comment
            const io = req.app.get('io');
            if (io) {
                io.emit('comment_added', {
                    postId,
                    comment: newComment,
                    tempId // Pass back the temporary ID for optimistic update reconciliation
                });
                // Also emit post update to ensure counts are synced
                // We don't send the whole post, just the ID and updated count/metadata if needed
                // But since we have comment_added, frontend can increment count locally.
                // However, let's also emit a lightweight post_updated for safety if we want
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
            const io = req.app.get('io');
            if (io) {
                io.emit('comment_updated', {
                    postId: existing.postId,
                    comment: updated
                });
            }
            res.json({ success: true, data: updated, message: 'Comment updated successfully' });
        }
        catch (error) {
            console.error('Error updating comment:', error);
            res.status(500).json({ success: false, error: 'Failed to update comment', message: 'Internal server error' });
        }
    }),
    // DELETE /api/comments/:id - Delete comment (author-only)
    deleteComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
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
            // Trigger live insights update for the post author
            try {
                const post = yield db.collection('posts').findOne({ id: existing.postId });
                if (post && post.author && post.author.id) {
                    (0, postsController_1.emitAuthorInsightsUpdate)(req.app, post.author.id, ((_a = post.author) === null || _a === void 0 ? void 0 : _a.type) === 'company' ? 'company' : 'user');
                }
            }
            catch (e) {
                console.error('Error triggering insights update on comment delete:', e);
            }
            const io = req.app.get('io');
            if (io) {
                io.emit('comment_deleted', {
                    commentId: id,
                    postId: existing.postId
                });
            }
            res.json({ success: true, message: 'Comment deleted successfully' });
        }
        catch (error) {
            console.error('Error deleting comment:', error);
            res.status(500).json({ success: false, error: 'Failed to delete comment', message: 'Internal server error' });
        }
    }),
    // POST /api/comments/:id/react - Add reaction to comment
    reactToComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const { id } = req.params;
            const { reaction, action: forceAction } = req.body;
            const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!reaction) {
                return res.status(400).json({ success: false, error: 'Missing reaction' });
            }
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User ID required' });
            }
            const actorUserId = userId;
            const db = (0, db_1.getDB)();
            const comment = yield db.collection(COMMENTS_COLLECTION).findOne({ id });
            if (!comment) {
                return res.status(404).json({ success: false, error: 'Comment not found' });
            }
            // Check if user already reacted with this emoji
            const currentReactionUsers = comment.reactionUsers || {};
            const usersForEmoji = currentReactionUsers[reaction] || [];
            const hasReacted = usersForEmoji.includes(actorUserId);
            let action = 'added';
            let shouldUpdate = true;
            if (forceAction) {
                if (forceAction === 'add' && hasReacted)
                    shouldUpdate = false;
                if (forceAction === 'remove' && !hasReacted)
                    shouldUpdate = false;
                action = forceAction === 'add' ? 'added' : 'removed';
            }
            else {
                action = hasReacted ? 'removed' : 'added';
            }
            if (shouldUpdate) {
                if (action === 'removed') {
                    // Remove reaction
                    yield db.collection(COMMENTS_COLLECTION).updateOne({ id }, {
                        $pull: { [`reactionUsers.${reaction}`]: actorUserId },
                        $inc: { [`reactions.${reaction}`]: -1 }
                    });
                }
                else {
                    // Add reaction
                    yield db.collection(COMMENTS_COLLECTION).updateOne({ id }, {
                        $addToSet: { [`reactionUsers.${reaction}`]: actorUserId },
                        $inc: { [`reactions.${reaction}`]: 1 }
                    });
                }
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
                updatedComment.userReactions = Object.keys(updatedComment.reactionUsers).filter(emoji => Array.isArray(updatedComment.reactionUsers[emoji]) && updatedComment.reactionUsers[emoji].includes(actorUserId));
            }
            else {
                updatedComment.userReactions = [];
            }
            const io = req.app.get('io');
            if (io) {
                io.emit('comment_reaction_updated', {
                    commentId: id,
                    postId: updatedComment.postId,
                    reactions: updatedComment.reactions,
                    reactionUsers: updatedComment.reactionUsers
                });
                // Trigger live insights update for the post author
                try {
                    const post = yield db.collection('posts').findOne({ id: updatedComment.postId });
                    if (post && post.author && post.author.id) {
                        (0, postsController_1.emitAuthorInsightsUpdate)(req.app, post.author.id, ((_b = post.author) === null || _b === void 0 ? void 0 : _b.type) === 'company' ? 'company' : 'user');
                    }
                }
                catch (e) {
                    console.error('Error triggering insights update on comment reaction:', e);
                }
            }
            res.json({ success: true, data: updatedComment, message: `Reaction ${action} successfully` });
        }
        catch (error) {
            console.error('Error adding reaction:', error);
            res.status(500).json({ success: false, error: 'Failed to add reaction', message: 'Internal server error' });
        }
    })
};
