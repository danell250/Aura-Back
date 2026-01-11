"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const usersController_1 = require("../controllers/usersController");
const router = (0, express_1.Router)();
console.log('Users routes loaded successfully');
// GET /api/users - Get all users
router.get('/', usersController_1.usersController.getAllUsers);
// GET /api/users/search - Search users (must come before /:id routes)
router.get('/search', usersController_1.usersController.searchUsers);
// POST /api/users - Create new user
router.post('/', usersController_1.usersController.createUser);
// Test route to verify routing works
router.post('/test-route', (req, res) => {
    console.log('Test route hit!');
    res.json({ success: true, message: 'Test route working!' });
});
// POST /api/users/:id/purchase-credits - Purchase credits (must come before /:id routes)
console.log('Registering purchase-credits route for pattern /:id/purchase-credits');
router.post('/:id/purchase-credits', (req, res) => {
    console.log('Purchase credits route hit!', req.params, req.body);
    usersController_1.usersController.purchaseCredits(req, res);
});
// Privacy and Data Management Routes
// GET /api/users/:id/privacy-data - Export user's privacy data (GDPR compliance)
router.get('/:id/privacy-data', usersController_1.usersController.getPrivacyData);
// POST /api/users/:id/clear-data - Clear all user data (GDPR right to be forgotten)
router.post('/:id/clear-data', usersController_1.usersController.clearUserData);
// GET /api/users/:id/privacy-settings - Get user's privacy settings
router.get('/:id/privacy-settings', usersController_1.usersController.getPrivacySettings);
// PUT /api/users/:id/privacy-settings - Update user's privacy settings
router.put('/:id/privacy-settings', usersController_1.usersController.updatePrivacySettings);
// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', usersController_1.usersController.sendConnectionRequest);
// POST /api/users/:id/block - Block user
router.post('/:id/block', usersController_1.usersController.blockUser);
// POST /api/users/:id/record-profile-view - Record profile view
router.post('/:id/record-profile-view', usersController_1.usersController.recordProfileView);
// GET /api/users/:id - Get user by ID
router.get('/:id', usersController_1.usersController.getUserById);
// PUT /api/users/:id - Update user
router.put('/:id', usersController_1.usersController.updateUser);
// DELETE /api/users/:id - Delete user
router.delete('/:id', usersController_1.usersController.deleteUser);
exports.default = router;
