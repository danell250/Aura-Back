"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adsController_1 = require("../controllers/adsController");
const adPlans_1 = require("../constants/adPlans");
const router = (0, express_1.Router)();
console.log('Ads routes loaded successfully');
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
router.get('/analytics/campaign/:userId', adsController_1.adsController.getCampaignPerformance);
router.get('/analytics/user/:userId', adsController_1.adsController.getUserAdPerformance);
router.get('/:id/analytics', adsController_1.adsController.getAdAnalytics);
router.post('/:id/impression', adsController_1.adsController.trackImpression);
router.post('/:id/click', adsController_1.adsController.trackClick);
router.post('/:id/engagement', adsController_1.adsController.trackEngagement);
router.get('/', adsController_1.adsController.getAllAds);
router.get('/:id', adsController_1.adsController.getAdById);
router.post('/', adsController_1.adsController.createAd);
router.put('/:id', adsController_1.adsController.updateAd);
router.delete('/:id', adsController_1.adsController.deleteAd);
router.post('/:id/react', adsController_1.adsController.reactToAd);
router.put('/:id/status', adsController_1.adsController.updateAdStatus);
exports.default = router;
