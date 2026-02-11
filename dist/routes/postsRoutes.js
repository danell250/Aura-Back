"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const postsController_1 = require("../controllers/postsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const uploadMiddleware_1 = require("../middleware/uploadMiddleware");
const securityLogger_1 = require("../utils/securityLogger");
const router = (0, express_1.Router)();
const postsWriteRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
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
router.get('/health', postsController_1.postsController.health);
// GET /api/posts/search - Search posts
router.get('/search', authMiddleware_1.optionalAuth, postsController_1.postsController.searchPosts);
// GET /api/posts - Get all posts
router.get('/', authMiddleware_1.optionalAuth, postsController_1.postsController.getAllPosts);
// GET /api/posts/stream - Server-Sent Events stream for post updates
router.get('/stream', authMiddleware_1.optionalAuth, postsController_1.postsController.streamEvents);
// GET /api/posts/hashtags/trending - Get trending hashtags
router.get('/hashtags/trending', postsController_1.postsController.getTrendingHashtags);
// GET /api/posts/insights/me - Get personal post insights
router.get('/insights/me', authMiddleware_1.requireAuth, postsController_1.postsController.getMyInsights);
// GET /api/posts/:id/analytics - Get post analytics
router.get('/:id/analytics', authMiddleware_1.requireAuth, postsController_1.postsController.getPostAnalytics);
// GET /api/posts/:id - Get post by ID
router.get('/:id', authMiddleware_1.optionalAuth, postsController_1.postsController.getPostById);
router.post('/', postsWriteRateLimiter, authMiddleware_1.requireAuth, uploadMiddleware_1.upload.array('media', 10), postsController_1.postsController.createPost);
router.put('/:id', postsWriteRateLimiter, authMiddleware_1.requireAuth, postsController_1.postsController.updatePost);
router.delete('/:id', postsWriteRateLimiter, authMiddleware_1.requireAuth, postsController_1.postsController.deletePost);
router.post('/:id/react', postsWriteRateLimiter, authMiddleware_1.requireAuth, postsController_1.postsController.reactToPost);
router.post('/:id/boost', postsWriteRateLimiter, authMiddleware_1.requireAuth, postsController_1.postsController.boostPost);
router.post('/:id/share', postsWriteRateLimiter, authMiddleware_1.requireAuth, postsController_1.postsController.sharePost);
router.post('/:id/report', postsWriteRateLimiter, authMiddleware_1.requireAuth, postsController_1.postsController.reportPost);
router.post('/:id/view', authMiddleware_1.optionalAuth, postsController_1.postsController.incrementPostViews);
router.post('/:id/media/:mediaId/metrics', authMiddleware_1.optionalAuth, postsController_1.postsController.updateMediaMetrics);
exports.default = router;
