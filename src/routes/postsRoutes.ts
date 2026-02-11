import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { postsController } from '../controllers/postsController';
import { requireAuth, optionalAuth } from '../middleware/authMiddleware';
import { upload } from '../middleware/uploadMiddleware';
import { logSecurityEvent } from '../utils/securityLogger';

const router = Router();

const postsWriteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/posts',
      metadata: {
        key: 'posts_write',
        max: 30,
        windowMs: 60 * 1000
      }
    });

    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many post actions, please slow down'
    });
  }
});

router.get('/health', postsController.health);

// GET /api/posts/search - Search posts
router.get('/search', optionalAuth, postsController.searchPosts);

// GET /api/posts - Get all posts
router.get('/', optionalAuth, postsController.getAllPosts);

// GET /api/posts/stream - Server-Sent Events stream for post updates
router.get('/stream', optionalAuth, postsController.streamEvents);

// GET /api/posts/hashtags/trending - Get trending hashtags
router.get('/hashtags/trending', postsController.getTrendingHashtags);

// GET /api/posts/insights/me - Get personal post insights
router.get('/insights/me', requireAuth, postsController.getMyInsights);

// GET /api/posts/:id/analytics - Get post analytics
router.get('/:id/analytics', requireAuth, postsController.getPostAnalytics);

// GET /api/posts/:id - Get post by ID
router.get('/:id', optionalAuth, postsController.getPostById);

router.post('/', postsWriteRateLimiter, requireAuth, upload.array('media', 10), postsController.createPost);
router.put('/:id', postsWriteRateLimiter, requireAuth, postsController.updatePost);
router.delete('/:id', postsWriteRateLimiter, requireAuth, postsController.deletePost);
router.post('/:id/react', postsWriteRateLimiter, requireAuth, postsController.reactToPost);
router.post('/:id/boost', postsWriteRateLimiter, requireAuth, postsController.boostPost);
router.post('/:id/share', postsWriteRateLimiter, requireAuth, postsController.sharePost);
router.post('/:id/report', postsWriteRateLimiter, requireAuth, postsController.reportPost);
router.post('/:id/view', optionalAuth, postsController.incrementPostViews);
router.post('/:id/media/:mediaId/metrics', optionalAuth, postsController.updateMediaMetrics);

export default router;
