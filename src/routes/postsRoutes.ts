import { Router } from 'express';
import { postsController } from '../controllers/postsController';

const router = Router();

// GET /api/posts - Get all posts
router.get('/', postsController.getAllPosts);

// GET /api/posts/hashtags/trending - Get trending hashtags
router.get('/hashtags/trending', postsController.getTrendingHashtags);

// GET /api/posts/:id - Get post by ID
router.get('/:id', postsController.getPostById);

// POST /api/posts - Create new post
router.post('/', postsController.createPost);

// PUT /api/posts/:id - Update post
router.put('/:id', postsController.updatePost);

// DELETE /api/posts/:id - Delete post
router.delete('/:id', postsController.deletePost);

// POST /api/posts/:id/react - Add reaction to post
router.post('/:id/react', postsController.reactToPost);

// POST /api/posts/:id/boost - Boost post
router.post('/:id/boost', postsController.boostPost);

export default router;