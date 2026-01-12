"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const postsController_1 = require("../controllers/postsController");
const router = (0, express_1.Router)();
// GET /api/posts - Get all posts
router.get('/', postsController_1.postsController.getAllPosts);
// GET /api/posts/hashtags/trending - Get trending hashtags
router.get('/hashtags/trending', postsController_1.postsController.getTrendingHashtags);
// GET /api/posts/:id - Get post by ID
router.get('/:id', postsController_1.postsController.getPostById);
// POST /api/posts - Create new post
router.post('/', postsController_1.postsController.createPost);
// PUT /api/posts/:id - Update post
router.put('/:id', postsController_1.postsController.updatePost);
// DELETE /api/posts/:id - Delete post
router.delete('/:id', postsController_1.postsController.deletePost);
// POST /api/posts/:id/react - Add reaction to post
router.post('/:id/react', postsController_1.postsController.reactToPost);
// POST /api/posts/:id/boost - Boost post
router.post('/:id/boost', postsController_1.postsController.boostPost);
// POST /api/posts/:id/share - Share post
router.post('/:id/share', postsController_1.postsController.sharePost);
exports.default = router;
