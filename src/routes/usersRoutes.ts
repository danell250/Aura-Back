import { Router, Request, Response } from 'express';
import { usersController } from '../controllers/usersController';

const router = Router();

console.log('Users routes loaded successfully');

// GET /api/users - Get all users
router.get('/', usersController.getAllUsers);

// GET /api/users/search - Search users (must come before /:id routes)
router.get('/search', usersController.searchUsers);

// POST /api/users - Create new user
router.post('/', usersController.createUser);

// Test route to verify routing works
router.post('/test-route', (req: Request, res: Response) => {
  console.log('Test route hit!');
  res.json({ success: true, message: 'Test route working!' });
});

// POST /api/users/:id/purchase-credits - Purchase credits (must come before /:id routes)
console.log('Registering purchase-credits route for pattern /:id/purchase-credits');
router.post('/:id/purchase-credits', (req: Request, res: Response) => {
  console.log('Purchase credits route hit!', req.params, req.body);
  usersController.purchaseCredits(req, res);
});

// Privacy and Data Management Routes
// GET /api/users/:id/privacy-data - Export user's privacy data (GDPR compliance)
router.get('/:id/privacy-data', usersController.getPrivacyData);

// POST /api/users/:id/clear-data - Clear all user data (GDPR right to be forgotten)
router.post('/:id/clear-data', usersController.clearUserData);

// GET /api/users/:id/privacy-settings - Get user's privacy settings
router.get('/:id/privacy-settings', usersController.getPrivacySettings);

// PUT /api/users/:id/privacy-settings - Update user's privacy settings
router.put('/:id/privacy-settings', usersController.updatePrivacySettings);

// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', usersController.sendConnectionRequest);

// POST /api/users/:id/block - Block user
router.post('/:id/block', usersController.blockUser);

// POST /api/users/:id/record-profile-view - Record profile view
router.post('/:id/record-profile-view', usersController.recordProfileView);

// GET /api/users/:id - Get user by ID
router.get('/:id', usersController.getUserById);

// PUT /api/users/:id - Update user
router.put('/:id', usersController.updateUser);

// DELETE /api/users/:id - Delete user
router.delete('/:id', usersController.deleteUser);

export default router;