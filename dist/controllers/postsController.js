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
// Mock data - in production this would come from database
const mockPosts = [
    {
        id: 'post-1',
        author: {
            id: '1',
            firstName: 'James',
            lastName: 'Mitchell',
            name: 'James Mitchell',
            handle: '@jamesmitchell',
            avatar: 'https://picsum.photos/id/64/150/150'
        },
        content: 'Strategic leadership requires a balance of vision and execution. The most successful leaders don\'t just set direction—they create systems that sustain momentum through uncertainty.',
        energy: '💡 Deep Dive',
        radiance: 156,
        timestamp: Date.now() - 3600000,
        reactions: { '👍': 45, '💡': 23, '🚀': 12 },
        userReactions: [],
        comments: [],
        isBoosted: false
    }
];
exports.postsController = {
    // GET /api/posts - Get all posts
    getAllPosts: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { page = 1, limit = 20, userId, energy } = req.query;
            let filteredPosts = [...mockPosts];
            // Filter by user if specified
            if (userId) {
                filteredPosts = filteredPosts.filter(post => post.author.id === userId);
            }
            // Filter by energy type if specified
            if (energy) {
                filteredPosts = filteredPosts.filter(post => post.energy === energy);
            }
            // Sort by timestamp (newest first)
            filteredPosts.sort((a, b) => b.timestamp - a.timestamp);
            // Pagination
            const startIndex = (Number(page) - 1) * Number(limit);
            const endIndex = startIndex + Number(limit);
            const paginatedPosts = filteredPosts.slice(startIndex, endIndex);
            res.json({
                success: true,
                data: paginatedPosts,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total: filteredPosts.length,
                    pages: Math.ceil(filteredPosts.length / Number(limit))
                }
            });
        }
        catch (error) {
            console.error('Error fetching posts:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch posts',
                message: 'Internal server error'
            });
        }
    }),
    // GET /api/posts/:id - Get post by ID
    getPostById: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const post = mockPosts.find(p => p.id === id);
            if (!post) {
                return res.status(404).json({
                    success: false,
                    error: 'Post not found',
                    message: `Post with ID ${id} does not exist`
                });
            }
            res.json({
                success: true,
                data: post
            });
        }
        catch (error) {
            console.error('Error fetching post:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch post',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/posts - Create new post
    createPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { content, mediaUrl, mediaType, energy, authorId } = req.body;
            // Validate required fields
            if (!content || !authorId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'content and authorId are required'
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
            const newPost = {
                id: `post-${Date.now()}`,
                author,
                content,
                mediaUrl: mediaUrl || undefined,
                mediaType: mediaType || undefined,
                energy: energy || '🪐 Neutral',
                radiance: 0,
                timestamp: Date.now(),
                reactions: {},
                userReactions: [],
                comments: [],
                isBoosted: false
            };
            // In production, save to database
            mockPosts.unshift(newPost);
            res.status(201).json({
                success: true,
                data: newPost,
                message: 'Post created successfully'
            });
        }
        catch (error) {
            console.error('Error creating post:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create post',
                message: 'Internal server error'
            });
        }
    }),
    // PUT /api/posts/:id - Update post
    updatePost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const updates = req.body;
            const postIndex = mockPosts.findIndex(p => p.id === id);
            if (postIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Post not found',
                    message: `Post with ID ${id} does not exist`
                });
            }
            // Update post
            mockPosts[postIndex] = Object.assign(Object.assign({}, mockPosts[postIndex]), updates);
            res.json({
                success: true,
                data: mockPosts[postIndex],
                message: 'Post updated successfully'
            });
        }
        catch (error) {
            console.error('Error updating post:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update post',
                message: 'Internal server error'
            });
        }
    }),
    // DELETE /api/posts/:id - Delete post
    deletePost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const postIndex = mockPosts.findIndex(p => p.id === id);
            if (postIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Post not found',
                    message: `Post with ID ${id} does not exist`
                });
            }
            // Remove post
            mockPosts.splice(postIndex, 1);
            res.json({
                success: true,
                message: 'Post deleted successfully'
            });
        }
        catch (error) {
            console.error('Error deleting post:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete post',
                message: 'Internal server error'
            });
        }
    }),
    // POST /api/posts/:id/react - Add reaction to post
    reactToPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { reaction, userId } = req.body;
            const postIndex = mockPosts.findIndex(p => p.id === id);
            if (postIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Post not found'
                });
            }
            // In production, handle reaction logic with database
            const post = mockPosts[postIndex];
            if (!post.reactions[reaction]) {
                post.reactions[reaction] = 0;
            }
            post.reactions[reaction]++;
            res.json({
                success: true,
                data: post,
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
    }),
    // POST /api/posts/:id/boost - Boost post
    boostPost: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            const { userId } = req.body;
            const postIndex = mockPosts.findIndex(p => p.id === id);
            if (postIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Post not found'
                });
            }
            // In production, deduct credits and boost post
            mockPosts[postIndex].radiance += 100;
            mockPosts[postIndex].isBoosted = true;
            res.json({
                success: true,
                data: mockPosts[postIndex],
                message: 'Post boosted successfully'
            });
        }
        catch (error) {
            console.error('Error boosting post:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to boost post',
                message: 'Internal server error'
            });
        }
    })
};
