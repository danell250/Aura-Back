"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const usersController_1 = require("../controllers/usersController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const uploadMiddleware_1 = require("../middleware/uploadMiddleware");
const router = (0, express_1.Router)();
console.log('Users routes loaded successfully');
// GET /api/users - Get all users (public)
router.get('/', usersController_1.usersController.getAllUsers);
// GET /api/users/me/dashboard - Get creator dashboard data
router.get('/me/dashboard', authMiddleware_1.requireAuth, usersController_1.usersController.getMyDashboard);
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
router.post('/:id/purchase-credits', authMiddleware_1.requireAuth, (req, res) => {
    console.log('Purchase credits route hit!', req.params, req.body);
    usersController_1.usersController.purchaseCredits(req, res);
});
// POST /api/users/:id/spend-credits - Spend credits
router.post('/:id/spend-credits', authMiddleware_1.requireAuth, usersController_1.usersController.spendCredits);
// Privacy and Data Management Routes
// GET /api/users/:id/privacy-data - Export user's privacy data (GDPR compliance)
router.get('/:id/privacy-data', authMiddleware_1.requireAuth, usersController_1.usersController.getPrivacyData);
// POST /api/users/:id/clear-data - Clear all user data (GDPR right to be forgotten)
router.post('/:id/clear-data', authMiddleware_1.requireAuth, usersController_1.usersController.clearUserData);
// GET /api/users/:id/privacy-settings - Get user's privacy settings
router.get('/:id/privacy-settings', authMiddleware_1.requireAuth, usersController_1.usersController.getPrivacySettings);
// PUT /api/users/:id/privacy-settings - Update user's privacy settings
router.put('/:id/privacy-settings', authMiddleware_1.requireAuth, usersController_1.usersController.updatePrivacySettings);
// Social interaction routes
// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', authMiddleware_1.requireAuth, usersController_1.usersController.sendConnectionRequest);
// POST /api/users/:id/cancel-connection - Cancel connection request
router.post('/:id/cancel-connection', authMiddleware_1.requireAuth, usersController_1.usersController.cancelConnectionRequest);
// POST /api/users/:id/accept-connection - Accept connection request
router.post('/:id/accept-connection', authMiddleware_1.requireAuth, usersController_1.usersController.acceptConnectionRequest);
// POST /api/users/:id/reject-connection - Reject connection request
router.post('/:id/reject-connection', authMiddleware_1.requireAuth, usersController_1.usersController.rejectConnectionRequest);
// POST /api/users/:id/block - Block user
router.post('/:id/block', authMiddleware_1.requireAuth, usersController_1.usersController.blockUser);
router.post('/:id/unblock', authMiddleware_1.requireAuth, usersController_1.usersController.unblockUser);
// POST /api/users/:id/report - Report user
router.post('/:id/report', authMiddleware_1.requireAuth, usersController_1.usersController.reportUser);
// POST /api/users/:id/remove-acquaintance - Remove acquaintance
router.post('/:id/remove-acquaintance', authMiddleware_1.requireAuth, usersController_1.usersController.removeAcquaintance);
// POST /api/users/:id/record-profile-view - Record profile view
router.post('/:id/record-profile-view', authMiddleware_1.requireAuth, usersController_1.usersController.recordProfileView);
// GET /api/users/:id - Get user by ID (public)
router.get('/:id', usersController_1.usersController.getUserById);
router.get('/:id/serendipity-matches', authMiddleware_1.requireAuth, usersController_1.usersController.getSerendipityMatches);
router.post('/:id/serendipity-skip', authMiddleware_1.requireAuth, usersController_1.usersController.addSerendipitySkip);
// PUT /api/users/:id - Update user
router.put('/:id', authMiddleware_1.requireAuth, usersController_1.usersController.updateUser);
// DELETE /api/users/:id - Delete user
router.delete('/:id', authMiddleware_1.requireAuth, usersController_1.usersController.deleteUser);
// DELETE /api/users/force-delete/:email - Force delete a user (Admin)
router.delete('/force-delete/:email', authMiddleware_1.requireAuth, usersController_1.usersController.forceDeleteUser);
// Trust calibration routes
// POST /api/users/:id/recalculate-trust - Recalculate trust score for a single user
router.post('/:id/recalculate-trust', authMiddleware_1.requireAuth, usersController_1.usersController.recalculateTrustForUser);
// POST /api/users/recalculate-trust-all - Recalculate trust scores for all users
router.post('/recalculate-trust-all', authMiddleware_1.requireAuth, usersController_1.usersController.recalculateTrustForAllUsers);
exports.default = router;
