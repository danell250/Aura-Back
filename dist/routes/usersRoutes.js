"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const usersController_1 = require("../controllers/usersController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
console.log('Users routes loaded successfully');
// GET /api/users - Get all users (public)
router.get('/', authMiddleware_1.optionalAuth, usersController_1.usersController.getAllUsers);
// GET /api/users/search - Search users (public)
router.get('/search', authMiddleware_1.optionalAuth, usersController_1.usersController.searchUsers);
// POST /api/users - Create new user (public for registration)
router.post('/', usersController_1.usersController.createUser);
// Test route to verify routing works
router.post('/test-route', (req, res) => {
    console.log('Test route hit!');
    res.json({ success: true, message: 'Test route working!' });
});
// POST /api/users/:id/purchase-credits - Purchase credits (requires auth + ownership)
console.log('Registering purchase-credits route for pattern /:id/purchase-credits');
router.post('/:id/purchase-credits', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)(), (req, res) => {
    console.log('Purchase credits route hit!', req.params, req.body);
    usersController_1.usersController.purchaseCredits(req, res);
});
// Privacy and Data Management Routes (all require auth + ownership)
// GET /api/users/:id/privacy-data - Export user's privacy data (GDPR compliance)
router.get('/:id/privacy-data', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)(), usersController_1.usersController.getPrivacyData);
// POST /api/users/:id/clear-data - Clear all user data (GDPR right to be forgotten)
router.post('/:id/clear-data', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)(), usersController_1.usersController.clearUserData);
// GET /api/users/:id/privacy-settings - Get user's privacy settings
router.get('/:id/privacy-settings', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)(), usersController_1.usersController.getPrivacySettings);
// PUT /api/users/:id/privacy-settings - Update user's privacy settings
router.put('/:id/privacy-settings', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)(), usersController_1.usersController.updatePrivacySettings);
// Social interaction routes (optional auth for now)
// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', authMiddleware_1.optionalAuth, usersController_1.usersController.sendConnectionRequest);
// POST /api/users/:id/accept-connection - Accept connection request
router.post('/:id/accept-connection', authMiddleware_1.optionalAuth, usersController_1.usersController.acceptConnectionRequest);
// POST /api/users/:id/block - Block user
router.post('/:id/block', authMiddleware_1.requireAuth, usersController_1.usersController.blockUser);
// POST /api/users/:id/remove-acquaintance - Remove acquaintance
router.post('/:id/remove-acquaintance', authMiddleware_1.requireAuth, usersController_1.usersController.removeAcquaintance);
// POST /api/users/:id/record-profile-view - Record profile view
router.post('/:id/record-profile-view', authMiddleware_1.requireAuth, usersController_1.usersController.recordProfileView);
// GET /api/users/:id - Get user by ID (public)
router.get('/:id', authMiddleware_1.optionalAuth, usersController_1.usersController.getUserById);
// PUT /api/users/:id - Update user (requires auth + ownership)
router.put('/:id', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)(), usersController_1.usersController.updateUser);
// DELETE /api/users/:id - Delete user (requires auth + ownership)
router.delete('/:id', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)(), usersController_1.usersController.deleteUser);
exports.default = router;
