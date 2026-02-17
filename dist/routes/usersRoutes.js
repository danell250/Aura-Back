"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const usersController_1 = require("../controllers/usersController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const uploadMiddleware_1 = require("../middleware/uploadMiddleware");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const router = (0, express_1.Router)();
const billingWriteLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many billing requests',
        message: 'Please wait a few minutes before trying another billing action.'
    }
});
const readIdentityHeader = (value) => {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value) && typeof value[0] === 'string')
        return value[0];
    return undefined;
};
const requirePersonalIdentity = (req, res, next) => {
    var _a;
    const authUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!authUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
    }
    const identityType = readIdentityHeader(req.headers['x-identity-type']);
    const identityId = readIdentityHeader(req.headers['x-identity-id']);
    if (identityType && identityType !== 'user') {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'This endpoint is available only in Personal identity context'
        });
    }
    if (identityId && identityId !== authUserId) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'Identity context does not match your authenticated personal account'
        });
    }
    next();
};
const requireSelfParam = (req, res, next) => {
    var _a;
    const authUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    const targetId = req.params.id;
    if (!authUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
    }
    if (!targetId || authUserId !== targetId) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'You can only access your own personal account data' });
    }
    next();
};
console.log('Users routes loaded successfully');
// GET /api/users - Get all users (public)
router.get('/', usersController_1.usersController.getAllUsers);
// GET /api/users/me/dashboard - Get creator dashboard data
router.get('/me/dashboard', authMiddleware_1.requireAuth, requirePersonalIdentity, usersController_1.usersController.getMyDashboard);
// GET /api/users/search - Search users (public)
router.get('/search', usersController_1.usersController.searchUsers);
// GET /api/users/handle/:handle - Get user by handle (public)
router.get('/handle/:handle', usersController_1.usersController.getUserByHandle);
// POST /api/users/me/images - Upload profile/cover images
router.post('/me/images', authMiddleware_1.requireAuth, uploadMiddleware_1.upload.fields([
    { name: 'profile', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
]), usersController_1.usersController.uploadProfileImages);
// POST /api/users - Create new user (public for registration)
router.post('/', usersController_1.usersController.createUser);
// Test route to verify routing works
router.post('/test-route', (req, res) => {
    console.log('Test route hit!');
    res.json({ success: true, message: 'Test route working!' });
});
// POST /api/users/:id/purchase-credits - Purchase credits
console.log('Registering purchase-credits route for pattern /:id/purchase-credits');
router.post('/:id/purchase-credits', billingWriteLimiter, authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, (req, res) => {
    console.log('Purchase credits route hit!', req.params, req.body);
    usersController_1.usersController.purchaseCredits(req, res);
});
// POST /api/users/:id/spend-credits - Spend credits
router.post('/:id/spend-credits', billingWriteLimiter, authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.spendCredits);
// Privacy and Data Management Routes
// GET /api/users/:id/privacy-data - Export user's privacy data (GDPR compliance)
router.get('/:id/privacy-data', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.getPrivacyData);
// POST /api/users/:id/clear-data - Clear all user data (GDPR right to be forgotten)
router.post('/:id/clear-data', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.clearUserData);
// GET /api/users/:id/privacy-settings - Get user's privacy settings
router.get('/:id/privacy-settings', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.getPrivacySettings);
// PUT /api/users/:id/privacy-settings - Update user's privacy settings
router.put('/:id/privacy-settings', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.updatePrivacySettings);
// Social interaction routes
// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', authMiddleware_1.requireAuth, requirePersonalIdentity, usersController_1.usersController.sendConnectionRequest);
// POST /api/users/:id/cancel-connection - Cancel connection request
router.post('/:id/cancel-connection', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.cancelConnectionRequest);
// POST /api/users/:id/accept-connection - Accept connection request
router.post('/:id/accept-connection', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.acceptConnectionRequest);
// POST /api/users/:id/reject-connection - Reject connection request
router.post('/:id/reject-connection', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.rejectConnectionRequest);
// POST /api/users/:id/block - Block user
router.post('/:id/block', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.blockUser);
router.post('/:id/unblock', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.unblockUser);
// POST /api/users/:id/report - Report user
router.post('/:id/report', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.reportUser);
// POST /api/users/:id/remove-acquaintance - Remove acquaintance
router.post('/:id/remove-acquaintance', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.removeAcquaintance);
// POST /api/users/:id/record-profile-view - Record profile view
router.post('/:id/record-profile-view', authMiddleware_1.requireAuth, requirePersonalIdentity, usersController_1.usersController.recordProfileView);
// GET /api/users/:id/featured-posts - Get ordered featured posts for a profile
router.get('/:id/featured-posts', usersController_1.usersController.getFeaturedPosts);
// PUT /api/users/:id/featured-posts - Update ordered featured posts for the authenticated personal profile
router.put('/:id/featured-posts', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.updateFeaturedPosts);
// GET /api/users/:id - Get user by ID (public)
router.get('/:id', usersController_1.usersController.getUserById);
router.get('/:id/serendipity-matches', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.getSerendipityMatches);
router.post('/:id/serendipity-skip', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.addSerendipitySkip);
// PUT /api/users/:id - Update user
router.put('/:id', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.updateUser);
// DELETE /api/users/:id - Delete user
router.delete('/:id', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.deleteUser);
// DELETE /api/users/force-delete/:email - Force delete a user (Admin)
router.delete('/force-delete/:email', authMiddleware_1.requireAuth, authMiddleware_1.requireAdmin, usersController_1.usersController.forceDeleteUser);
// Trust calibration routes
// POST /api/users/:id/recalculate-trust - Recalculate trust score for a single user
router.post('/:id/recalculate-trust', authMiddleware_1.requireAuth, requirePersonalIdentity, requireSelfParam, usersController_1.usersController.recalculateTrustForUser);
// POST /api/users/recalculate-trust-all - Recalculate trust scores for all users
router.post('/recalculate-trust-all', authMiddleware_1.requireAuth, authMiddleware_1.requireAdmin, usersController_1.usersController.recalculateTrustForAllUsers);
exports.default = router;
