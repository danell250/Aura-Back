"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adsController_1 = require("../controllers/adsController");
const adPlans_1 = require("../constants/adPlans");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
console.log('Ads routes loaded successfully');
// Plans routes first
// GET /api/ads/plans - Get all ad plans
router.get('/plans/all', (req, res) => {
    res.json({
        success: true,
        data: Object.values(adPlans_1.AD_PLANS)
    });
});
// GET /api/ads/plans/:planId - Get specific plan details
router.get('/plans/:planId', (req, res) => {
    const { planId } = req.params;
    const plan = adPlans_1.AD_PLANS[planId];
    if (!plan) {
        return res.status(404).json({
            success: false,
            error: 'Plan not found'
        });
    }
    res.json({
        success: true,
        data: plan
    });
});
// Analytics routes (specific paths before :id)
router.get('/mine', authMiddleware_1.requireAuth, adsController_1.adsController.getMyAds);
router.get('/analytics/campaign/:userId', authMiddleware_1.requireAuth, adsController_1.adsController.getCampaignPerformance);
router.get('/analytics/user/:userId', authMiddleware_1.requireAuth, adsController_1.adsController.getUserAdPerformance);
// Tracking routes
router.post('/:id/impression', authMiddleware_1.optionalAuth, adsController_1.adsController.trackImpression);
router.post('/:id/click', authMiddleware_1.optionalAuth, adsController_1.adsController.trackClick);
router.post('/:id/engagement', authMiddleware_1.optionalAuth, adsController_1.adsController.trackEngagement);
router.post('/:id/conversion', authMiddleware_1.optionalAuth, adsController_1.adsController.trackConversion);
router.post('/:id/react', authMiddleware_1.requireAuth, adsController_1.adsController.reactToAd);
// Analytics for specific ad
router.get('/:id/analytics', authMiddleware_1.requireAuth, adsController_1.adsController.getAdAnalytics);
// General CRUD
router.get('/', authMiddleware_1.optionalAuth, adsController_1.adsController.getAllAds);
router.get('/:id', authMiddleware_1.optionalAuth, adsController_1.adsController.getAdById);
router.post('/', authMiddleware_1.requireAuth, adsController_1.adsController.createAd);
router.put('/:id', authMiddleware_1.requireAuth, adsController_1.adsController.updateAd);
router.put('/:id/status', authMiddleware_1.requireAuth, adsController_1.adsController.updateAdStatus);
router.delete('/:id', authMiddleware_1.requireAuth, adsController_1.adsController.deleteAd);
exports.default = router;
