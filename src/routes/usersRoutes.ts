import { Router, Request, Response } from 'express';
import { usersController } from '../controllers/usersController';
import { requireAuth, requireOwnership, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

console.log('Users routes loaded successfully');

// GET /api/users - Get all users (public)
router.get('/', optionalAuth, usersController.getAllUsers);

// GET /api/users/search - Search users (public)
router.get('/search', optionalAuth, usersController.searchUsers);

// POST /api/users - Create new user (public for registration)
router.post('/', usersController.createUser);

// Test route to verify routing works
router.post('/test-route', (req: Request, res: Response) => {
  console.log('Test route hit!');
  res.json({ success: true, message: 'Test route working!' });
});

// POST /api/users/:id/purchase-credits - Purchase credits (requires auth + ownership)
console.log('Registering purchase-credits route for pattern /:id/purchase-credits');
router.post('/:id/purchase-credits', requireAuth, requireOwnership(), (req: Request, res: Response) => {
  console.log('Purchase credits route hit!', req.params, req.body);
  usersController.purchaseCredits(req, res);
});

// Privacy and Data Management Routes (all require auth + ownership)
// GET /api/users/:id/privacy-data - Export user's privacy data (GDPR compliance)
router.get('/:id/privacy-data', requireAuth, requireOwnership(), usersController.getPrivacyData);

// POST /api/users/:id/clear-data - Clear all user data (GDPR right to be forgotten)
router.post('/:id/clear-data', requireAuth, requireOwnership(), usersController.clearUserData);

// GET /api/users/:id/privacy-settings - Get user's privacy settings
router.get('/:id/privacy-settings', requireAuth, requireOwnership(), usersController.getPrivacySettings);

// PUT /api/users/:id/privacy-settings - Update user's privacy settings
router.put('/:id/privacy-settings', requireAuth, requireOwnership(), usersController.updatePrivacySettings);

// Social interaction routes (optional auth for now)
// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', optionalAuth, usersController.sendConnectionRequest);

// POST /api/users/:id/accept-connection - Accept connection request
router.post('/:id/accept-connection', optionalAuth, usersController.acceptConnectionRequest);

// POST /api/users/:id/block - Block user
router.post('/:id/block', requireAuth, usersController.blockUser);

// POST /api/users/:id/remove-acquaintance - Remove acquaintance
router.post('/:id/remove-acquaintance', requireAuth, usersController.removeAcquaintance);

// POST /api/users/:id/record-profile-view - Record profile view
router.post('/:id/record-profile-view', requireAuth, usersController.recordProfileView);

// GET /api/users/:id - Get user by ID (public)
router.get('/:id', optionalAuth, usersController.getUserById);

// PUT /api/users/:id - Update user (requires auth + ownership)
router.put('/:id', requireAuth, requireOwnership(), usersController.updateUser);

// DELETE /api/users/:id - Delete user (requires auth + ownership)
router.delete('/:id', requireAuth, requireOwnership(), usersController.deleteUser);

// DELETE /api/users/admin/force-delete/:id - Force delete user (admin only)
router.delete('/admin/force-delete/:id', usersController.forceDeleteUser);

export default router;