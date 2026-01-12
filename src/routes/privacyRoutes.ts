import { Router } from 'express';
import { privacyController } from '../controllers/privacyController';
import { requireAuth, requireOwnership, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

// GET /api/privacy/settings/:userId - Get user's privacy settings (requires ownership)
router.get('/settings/:userId', requireAuth, requireOwnership('userId'), privacyController.getPrivacySettings);

// PUT /api/privacy/settings/:userId - Update user's privacy settings (requires ownership)
router.put('/settings/:userId', requireAuth, requireOwnership('userId'), privacyController.updatePrivacySettings);

// POST /api/privacy/analytics-event - Track analytics event (requires auth)
router.post('/analytics-event', requireAuth, privacyController.trackAnalyticsEvent);

// GET /api/privacy/searchable-users - Get users that allow being found in search (public)
router.get('/searchable-users', optionalAuth, privacyController.getSearchableUsers);

// POST /api/privacy/profile-view - Record profile view (requires auth)
router.post('/profile-view', requireAuth, privacyController.recordProfileView);

// GET /api/privacy/online-status/:userId - Get user's online status (public)
router.get('/online-status/:userId', optionalAuth, privacyController.getOnlineStatus);

export default router;