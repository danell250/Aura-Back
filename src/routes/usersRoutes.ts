import { Router, Request, Response, NextFunction } from 'express';
import { usersController } from '../controllers/usersController';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { upload } from '../middleware/uploadMiddleware';
import rateLimit from 'express-rate-limit';

const router = Router();

const billingWriteLimiter = rateLimit({
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

const readIdentityHeader = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
};

const requirePersonalIdentity = (req: Request, res: Response, next: NextFunction) => {
  const authUserId = (req as any).user?.id;
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

const requireSelfParam = (req: Request, res: Response, next: NextFunction) => {
  const authUserId = (req as any).user?.id;
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
router.get('/', usersController.getAllUsers);

// GET /api/users/me/dashboard - Get creator dashboard data
router.get('/me/dashboard', requireAuth, requirePersonalIdentity, usersController.getMyDashboard);

// GET /api/users/search - Search users (public)
router.get('/search', usersController.searchUsers);

// GET /api/users/handle/:handle - Get user by handle (public)
router.get('/handle/:handle', usersController.getUserByHandle);

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
router.post('/:id/purchase-credits', billingWriteLimiter, requireAuth, requirePersonalIdentity, requireSelfParam, (req: Request, res: Response) => {
  console.log('Purchase credits route hit!', req.params, req.body);
  usersController.purchaseCredits(req, res);
});

// POST /api/users/:id/spend-credits - Spend credits
router.post('/:id/spend-credits', billingWriteLimiter, requireAuth, requirePersonalIdentity, requireSelfParam, usersController.spendCredits);

// Privacy and Data Management Routes
// GET /api/users/:id/privacy-data - Export user's privacy data (GDPR compliance)
router.get('/:id/privacy-data', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.getPrivacyData);

// POST /api/users/:id/clear-data - Clear all user data (GDPR right to be forgotten)
router.post('/:id/clear-data', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.clearUserData);

// GET /api/users/:id/privacy-settings - Get user's privacy settings
router.get('/:id/privacy-settings', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.getPrivacySettings);

// PUT /api/users/:id/privacy-settings - Update user's privacy settings
router.put('/:id/privacy-settings', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.updatePrivacySettings);

// Social interaction routes
// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', requireAuth, requirePersonalIdentity, usersController.sendConnectionRequest);

// POST /api/users/:id/cancel-connection - Cancel connection request
router.post('/:id/cancel-connection', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.cancelConnectionRequest);

// POST /api/users/:id/accept-connection - Accept connection request
router.post('/:id/accept-connection', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.acceptConnectionRequest);

// POST /api/users/:id/reject-connection - Reject connection request
router.post('/:id/reject-connection', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.rejectConnectionRequest);

// POST /api/users/:id/block - Block user
router.post('/:id/block', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.blockUser);

router.post('/:id/unblock', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.unblockUser);

// POST /api/users/:id/report - Report user
router.post('/:id/report', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.reportUser);

// POST /api/users/:id/remove-acquaintance - Remove acquaintance
router.post('/:id/remove-acquaintance', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.removeAcquaintance);

// POST /api/users/:id/record-profile-view - Record profile view
router.post('/:id/record-profile-view', requireAuth, requirePersonalIdentity, usersController.recordProfileView);

// GET /api/users/:id/featured-posts - Get ordered featured posts for a profile
router.get('/:id/featured-posts', usersController.getFeaturedPosts);

// PUT /api/users/:id/featured-posts - Update ordered featured posts for the authenticated personal profile
router.put('/:id/featured-posts', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.updateFeaturedPosts);

// GET /api/users/:id - Get user by ID (public)
router.get('/:id', usersController.getUserById);

router.get('/:id/serendipity-matches', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.getSerendipityMatches);
router.post('/:id/serendipity-skip', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.addSerendipitySkip);

// PUT /api/users/:id - Update user
router.put('/:id', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.updateUser);

// DELETE /api/users/:id - Delete user
router.delete('/:id', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.deleteUser);

// DELETE /api/users/force-delete/:email - Force delete a user (Admin)
router.delete('/force-delete/:email', requireAuth, requireAdmin, usersController.forceDeleteUser);

// Trust calibration routes
// POST /api/users/:id/recalculate-trust - Recalculate trust score for a single user
router.post('/:id/recalculate-trust', requireAuth, requirePersonalIdentity, requireSelfParam, usersController.recalculateTrustForUser);

// POST /api/users/recalculate-trust-all - Recalculate trust scores for all users
router.post('/recalculate-trust-all', requireAuth, requireAdmin, usersController.recalculateTrustForAllUsers);

export default router;
