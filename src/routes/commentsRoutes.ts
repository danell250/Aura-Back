import { Router } from 'express';
import { commentsController } from '../controllers/commentsController';

const router = Router();

// GET /api/posts/:postId/comments - Get comments for a post
router.get('/posts/:postId/comments', commentsController.getCommentsByPost);

// GET /api/comments/:id - Get comment by ID
router.get('/comments/:id', commentsController.getCommentById);

// POST /api/posts/:postId/comments - Create new comment
router.post('/posts/:postId/comments', commentsController.createComment);

// PUT /api/comments/:id - Update comment
router.put('/comments/:id', commentsController.updateComment);

// DELETE /api/comments/:id - Delete comment
router.delete('/comments/:id', commentsController.deleteComment);

// POST /api/comments/:id/react - Add reaction to comment
router.post('/comments/:id/react', commentsController.reactToComment);

export default router;