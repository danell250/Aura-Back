import { Router, Request, Response } from 'express';
import { usersController } from '../controllers/usersController';
import { requireAuth } from '../middleware/authMiddleware';
import { upload } from '../middleware/uploadMiddleware';

const router = Router();

console.log('Users routes loaded successfully');

// GET /api/users - Get all users (public)
router.get('/', usersController.getAllUsers);

// GET /api/users/search - Search users (public)
router.get('/search', usersController.searchUsers);

// POST /api/users/me/images - Upload profile/cover images
router.post(
  '/me/images',
  requireAuth,
  upload.fields([
    { name: 'profile', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  usersController.uploadProfileImages
);

// POST /api/users - Create new user (public for registration)
router.post('/', usersController.createUser);

// Test route to verify routing works
router.post('/test-route', (req: Request, res: Response) => {
  console.log('Test route hit!');
  res.json({ success: true, message: 'Test route working!' });
});

// POST /api/users/:id/purchase-credits - Purchase credits
console.log('Registering purchase-credits route for pattern /:id/purchase-credits');
router.post('/:id/purchase-credits', (req: Request, res: Response) => {
  console.log('Purchase credits route hit!', req.params, req.body);
  usersController.purchaseCredits(req, res);
});

// POST /api/users/:id/spend-credits - Spend credits
router.post('/:id/spend-credits', usersController.spendCredits);

// Privacy and Data Management Routes
// GET /api/users/:id/privacy-data - Export user's privacy data (GDPR compliance)
router.get('/:id/privacy-data', usersController.getPrivacyData);

// POST /api/users/:id/clear-data - Clear all user data (GDPR right to be forgotten)
router.post('/:id/clear-data', usersController.clearUserData);

// GET /api/users/:id/privacy-settings - Get user's privacy settings
router.get('/:id/privacy-settings', usersController.getPrivacySettings);

// PUT /api/users/:id/privacy-settings - Update user's privacy settings
router.put('/:id/privacy-settings', usersController.updatePrivacySettings);

// Social interaction routes
// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', usersController.sendConnectionRequest);

// POST /api/users/:id/cancel-connection - Cancel connection request
router.post('/:id/cancel-connection', usersController.cancelConnectionRequest);

// POST /api/users/:id/accept-connection - Accept connection request
router.post('/:id/accept-connection', usersController.acceptConnectionRequest);

// POST /api/users/:id/reject-connection - Reject connection request
router.post('/:id/reject-connection', usersController.rejectConnectionRequest);

// POST /api/users/:id/block - Block user
router.post('/:id/block', usersController.blockUser);

router.post('/:id/unblock', usersController.unblockUser);

// POST /api/users/:id/report - Report user
router.post('/:id/report', usersController.reportUser);

// POST /api/users/:id/remove-acquaintance - Remove acquaintance
router.post('/:id/remove-acquaintance', usersController.removeAcquaintance);

// POST /api/users/:id/record-profile-view - Record profile view
router.post('/:id/record-profile-view', usersController.recordProfileView);

// GET /api/users/:id - Get user by ID (public)
router.get('/:id', usersController.getUserById);

router.get('/:id/serendipity-matches', usersController.getSerendipityMatches);
router.post('/:id/serendipity-skip', usersController.addSerendipitySkip);

// PUT /api/users/:id - Update user
router.put('/:id', usersController.updateUser);

// DELETE /api/users/:id - Delete user
router.delete('/:id', usersController.deleteUser);

// DELETE /api/users/force-delete/:email - Force delete a user (Admin)
router.delete('/force-delete/:email', usersController.forceDeleteUser);

// Trust calibration routes
// POST /api/users/:id/recalculate-trust - Recalculate trust score for a single user
router.post('/:id/recalculate-trust', usersController.recalculateTrustForUser);

// POST /api/users/recalculate-trust-all - Recalculate trust scores for all users
router.post('/recalculate-trust-all', usersController.recalculateTrustForAllUsers);

export default router;
