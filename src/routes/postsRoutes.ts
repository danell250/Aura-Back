import { Router } from 'express';
import { postsController } from '../controllers/postsController';
import { requireAuth, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

router.get('/health', postsController.health);

// GET /api/posts/search - Search posts
router.get('/search', optionalAuth, postsController.searchPosts);

// GET /api/posts - Get all posts
router.get('/', optionalAuth, postsController.getAllPosts);

// GET /api/posts/hashtags/trending - Get trending hashtags
router.get('/hashtags/trending', postsController.getTrendingHashtags);

// GET /api/posts/:id - Get post by ID
router.get('/:id', optionalAuth, postsController.getPostById);

// POST /api/posts - Create new post
router.post('/', requireAuth, postsController.createPost);

// PUT /api/posts/:id - Update post
router.put('/:id', requireAuth, postsController.updatePost);

// DELETE /api/posts/:id - Delete post
router.delete('/:id', requireAuth, postsController.deletePost);

// POST /api/posts/:id/react - Add reaction to post
router.post('/:id/react', requireAuth, postsController.reactToPost);

// POST /api/posts/:id/boost - Boost post
router.post('/:id/boost', requireAuth, postsController.boostPost);

// POST /api/posts/:id/share - Share post
router.post('/:id/share', requireAuth, postsController.sharePost);

export default router;
