import { Router } from 'express';
import { privacyController } from '../controllers/privacyController';
import { optionalAuth } from '../middleware/authMiddleware';

const router = Router();

// GET /api/privacy/settings/:userId - Get user's privacy settings (optional auth)
router.get('/settings/:userId', optionalAuth, privacyController.getPrivacySettings);

// PUT /api/privacy/settings/:userId - Update user's privacy settings (optional auth)
router.put('/settings/:userId', optionalAuth, privacyController.updatePrivacySettings);

// POST /api/privacy/analytics-event - Track analytics event (optional auth)
router.post('/analytics-event', optionalAuth, privacyController.trackAnalyticsEvent);

// GET /api/privacy/searchable-users - Get users that allow being found in search (public)
router.get('/searchable-users', optionalAuth, privacyController.getSearchableUsers);

// POST /api/privacy/profile-view - Record profile view (optional auth)
router.post('/profile-view', optionalAuth, privacyController.recordProfileView);

// GET /api/privacy/online-status/:userId - Get user's online status (public)
router.get('/online-status/:userId', optionalAuth, privacyController.getOnlineStatus);

export default router;