"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const commentsController_1 = require("../controllers/commentsController");
const securityLogger_1 = require("../utils/securityLogger");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
const commentsWriteRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
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
router.get('/posts/:postId/comments', commentsController_1.commentsController.getCommentsByPost);
// GET /api/comments/:id - Get comment by ID
router.get('/comments/:id', commentsController_1.commentsController.getCommentById);
router.post('/posts/:postId/comments', authMiddleware_1.requireAuth, commentsWriteRateLimiter, commentsController_1.commentsController.createComment);
router.put('/comments/:id', authMiddleware_1.requireAuth, commentsWriteRateLimiter, commentsController_1.commentsController.updateComment);
router.delete('/comments/:id', authMiddleware_1.requireAuth, commentsWriteRateLimiter, commentsController_1.commentsController.deleteComment);
router.post('/comments/:id/react', authMiddleware_1.requireAuth, commentsWriteRateLimiter, commentsController_1.commentsController.reactToComment);
exports.default = router;
