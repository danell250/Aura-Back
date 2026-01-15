"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const postsController_1 = require("../controllers/postsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.get('/health', postsController_1.postsController.health);
// GET /api/posts/search - Search posts
router.get('/search', authMiddleware_1.optionalAuth, postsController_1.postsController.searchPosts);
// GET /api/posts - Get all posts
router.get('/', authMiddleware_1.optionalAuth, postsController_1.postsController.getAllPosts);
// GET /api/posts/hashtags/trending - Get trending hashtags
router.get('/hashtags/trending', postsController_1.postsController.getTrendingHashtags);
// GET /api/posts/:id - Get post by ID
router.get('/:id', authMiddleware_1.optionalAuth, postsController_1.postsController.getPostById);
// POST /api/posts - Create new post
router.post('/', authMiddleware_1.requireAuth, postsController_1.postsController.createPost);
// PUT /api/posts/:id - Update post
router.put('/:id', authMiddleware_1.requireAuth, postsController_1.postsController.updatePost);
// DELETE /api/posts/:id - Delete post
router.delete('/:id', authMiddleware_1.requireAuth, postsController_1.postsController.deletePost);
// POST /api/posts/:id/react - Add reaction to post
router.post('/:id/react', authMiddleware_1.requireAuth, postsController_1.postsController.reactToPost);
// POST /api/posts/:id/boost - Boost post
router.post('/:id/boost', authMiddleware_1.requireAuth, postsController_1.postsController.boostPost);
// POST /api/posts/:id/share - Share post
router.post('/:id/share', authMiddleware_1.requireAuth, postsController_1.postsController.sharePost);
// POST /api/posts/:id/report - Report a post
router.post('/:id/report', authMiddleware_1.requireAuth, postsController_1.postsController.reportPost);
exports.default = router;
