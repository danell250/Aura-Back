import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { commentsController } from '../controllers/commentsController';
import { logSecurityEvent } from '../utils/securityLogger';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

const commentsWriteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/comments',
      metadata: {
        key: 'comments_write',
        max: 30,
        windowMs: 60 * 1000
      }
    });

    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many comment actions, please slow down'
    });
  }
});

// GET /api/posts/:postId/comments - Get comments for a post
router.get('/posts/:postId/comments', commentsController.getCommentsByPost);

// GET /api/comments/:id - Get comment by ID
router.get('/comments/:id', commentsController.getCommentById);

router.post('/posts/:postId/comments', requireAuth, commentsWriteRateLimiter, commentsController.createComment);
router.put('/comments/:id', requireAuth, commentsWriteRateLimiter, commentsController.updateComment);
router.delete('/comments/:id', requireAuth, commentsWriteRateLimiter, commentsController.deleteComment);
router.post('/comments/:id/react', requireAuth, commentsWriteRateLimiter, commentsController.reactToComment);

export default router;
