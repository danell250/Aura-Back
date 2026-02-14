import { Router } from 'express';
import { privacyController } from '../controllers/privacyController';
import { requireAuth, requireOwnership } from '../middleware/authMiddleware';

const router = Router();

// GET /api/privacy/settings/:userId - Get user's privacy settings
router.get('/settings/:userId', requireAuth, requireOwnership('userId'), privacyController.getPrivacySettings);

// PUT /api/privacy/settings/:userId - Update user's privacy settings
router.put('/settings/:userId', requireAuth, requireOwnership('userId'), privacyController.updatePrivacySettings);

// POST /api/privacy/analytics-event - Track analytics event
router.post('/analytics-event', requireAuth, privacyController.trackAnalyticsEvent);

// GET /api/privacy/searchable-users - Get users that allow being found in search (public)
router.get('/searchable-users', privacyController.getSearchableUsers);

// POST /api/privacy/profile-view - Record profile view
router.post('/profile-view', requireAuth, privacyController.recordProfileView);

// GET /api/privacy/online-status/:userId - Get user's online status (public)
router.get('/online-status/:userId', privacyController.getOnlineStatus);

export default router;
