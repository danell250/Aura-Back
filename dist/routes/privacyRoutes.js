"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const privacyController_1 = require("../controllers/privacyController");
const router = (0, express_1.Router)();
// GET /api/privacy/settings/:userId - Get user's privacy settings
router.get('/settings/:userId', privacyController_1.privacyController.getPrivacySettings);
// PUT /api/privacy/settings/:userId - Update user's privacy settings
router.put('/settings/:userId', privacyController_1.privacyController.updatePrivacySettings);
// POST /api/privacy/analytics-event - Track analytics event
router.post('/analytics-event', privacyController_1.privacyController.trackAnalyticsEvent);
// GET /api/privacy/searchable-users - Get users that allow being found in search (public)
router.get('/searchable-users', privacyController_1.privacyController.getSearchableUsers);
// POST /api/privacy/profile-view - Record profile view
router.post('/profile-view', privacyController_1.privacyController.recordProfileView);
// GET /api/privacy/online-status/:userId - Get user's online status (public)
router.get('/online-status/:userId', privacyController_1.privacyController.getOnlineStatus);
exports.default = router;
