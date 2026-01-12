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
// Mock data - in production this would come from database
const mockComments = [
    {
        id: 'comment-1',
        postId: 'post-1',
        author: {
            id: '2',
            firstName: 'Sarah',
            lastName: 'Williams',
            name: 'Sarah Williams',
            handle: '@sarahwilliams',
            avatar: 'https://picsum.photos/id/25/150/150'
        },
        text: 'Great insights! This really resonates with my experience in executive coaching.',
        timestamp: Date.now() - 1800000,
        parentId: null,
        reactions: { '👍': 5, '💡': 2 },
        userReactions: []
    }
];
exports.commentsController = {
    // GET /api/posts/:postId/comments - Get comments for a post
    getCommentsByPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { postId } = req.params;
            const { page = 1, limit = 20 } = req.query;
            let filteredComments = mockComments.filter(comment => comment.postId === postId);
            // Sort by timestamp (oldest first for comments)
            filteredComments.sort((a, b) => a.timestamp - b.timestamp);
            // Pagination
            const startIndex = (Number(page) - 1) * Number(limit);
            const endIndex = startIndex + Number(limit);
            const paginatedComments = filteredComments.slice(startIndex, endIndex);
            res.json({
                success: true,
                data: paginatedComments,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total: filteredComments.length,
                    pages: Math.ceil(filteredComments.length / Number(limit))
                }
            });
        }
        catch (error) {
            console.error('Error fetching comments:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch comments',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/comments/:id - Get comment by ID
    getCommentById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const comment = mockComments.find(c => c.id === id);
            if (!comment) {
                return res.status(404).json({
                    success: false,
                    error: 'Comment not found',
                    message: `Comment with ID ${id} does not exist`
                });
            }
            res.json({
                success: true,
                data: comment
            });
        }
        catch (error) {
            console.error('Error fetching comment:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch comment',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/posts/:postId/comments - Create new comment
    createComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { postId } = req.params;
            const { text, authorId, parentId } = req.body;
            // Validate required fields
            if (!text || !authorId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'text and authorId are required'
                });
            }
            // In production, fetch author from database
            const author = {
                id: authorId,
                firstName: 'User',
                lastName: '',
                name: 'User',
                handle: '@user',
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authorId}`
            };
            const newComment = {
                id: `comment-${Date.now()}`,
                postId,
                author,
                text,
                timestamp: Date.now(),
                parentId: parentId || null,
                reactions: {},
                userReactions: []
            };
            // In production, save to database
            mockComments.push(newComment);
            res.status(201).json({
                success: true,
                data: newComment,
                message: 'Comment created successfully'
            });
        }
        catch (error) {
            console.error('Error creating comment:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create comment',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/comments/:id - Update comment
    updateComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { text } = req.body;
            const commentIndex = mockComments.findIndex(c => c.id === id);
            if (commentIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Comment not found',
                    message: `Comment with ID ${id} does not exist`
                });
            }
            // Update comment
            if (text) {
                mockComments[commentIndex].text = text;
            }
            res.json({
                success: true,
                data: mockComments[commentIndex],
                message: 'Comment updated successfully'
            });
        }
        catch (error) {
            console.error('Error updating comment:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update comment',
                message: 'Internal server error'
            });
        }
    }),
    // DELETE /api/comments/:id - Delete comment
    deleteComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const commentIndex = mockComments.findIndex(c => c.id === id);
            if (commentIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Comment not found',
                    message: `Comment with ID ${id} does not exist`
                });
            }
            // Remove comment
            mockComments.splice(commentIndex, 1);
            res.json({
                success: true,
                message: 'Comment deleted successfully'
            });
        }
        catch (error) {
            console.error('Error deleting comment:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete comment',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/comments/:id/react - Add reaction to comment
    reactToComment: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { reaction, userId } = req.body;
            const commentIndex = mockComments.findIndex(c => c.id === id);
            if (commentIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Comment not found'
                });
            }
            // In production, handle reaction logic with database
            const comment = mockComments[commentIndex];
            if (!comment.reactions[reaction]) {
                comment.reactions[reaction] = 0;
            }
            comment.reactions[reaction]++;
            res.json({
                success: true,
                data: comment,
                message: 'Reaction added successfully'
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
    })
};
