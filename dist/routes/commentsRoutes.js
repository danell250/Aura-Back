"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const commentsController_1 = require("../controllers/commentsController");
const router = (0, express_1.Router)();
// GET /api/posts/:postId/comments - Get comments for a post
router.get('/posts/:postId/comments', commentsController_1.commentsController.getCommentsByPost);
// GET /api/comments/:id - Get comment by ID
router.get('/:id', commentsController_1.commentsController.getCommentById);
// POST /api/posts/:postId/comments - Create new comment
router.post('/posts/:postId/comments', commentsController_1.commentsController.createComment);
// PUT /api/comments/:id - Update comment
router.put('/:id', commentsController_1.commentsController.updateComment);
// DELETE /api/comments/:id - Delete comment
router.delete('/:id', commentsController_1.commentsController.deleteComment);
// POST /api/comments/:id/react - Add reaction to comment
router.post('/:id/react', commentsController_1.commentsController.reactToComment);
exports.default = router;
