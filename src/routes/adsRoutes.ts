import { Router } from 'express';
import { adsController } from '../controllers/adsController';
import { AD_PLANS } from '../constants/adPlans';
import { requireAuth, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

console.log('Ads routes loaded successfully');

// Plans routes first
// GET /api/ads/plans - Get all ad plans
router.get('/plans/all', (req, res) => {
  res.json({
    success: true,
    data: Object.values(AD_PLANS)
  });
});

// GET /api/ads/plans/:planId - Get specific plan details
router.get('/plans/:planId', (req, res) => {
  const { planId } = req.params;
  const plan = AD_PLANS[planId as keyof typeof AD_PLANS];
  
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
router.get('/analytics/campaign/:userId', requireAuth, adsController.getCampaignPerformance);
router.get('/analytics/user/:userId', requireAuth, adsController.getUserAdPerformance);

// Tracking routes
router.post('/:id/impression', adsController.trackImpression);
router.post('/:id/click', adsController.trackClick);
router.post('/:id/engagement', adsController.trackEngagement);
router.post('/:id/conversion', adsController.trackConversion);
router.post('/:id/react', requireAuth, adsController.reactToAd);

// Analytics for specific ad
router.get('/:id/analytics', requireAuth, adsController.getAdAnalytics);

// General CRUD
router.get('/', optionalAuth, adsController.getAllAds);
router.get('/:id', optionalAuth, adsController.getAdById);
router.post('/', requireAuth, adsController.createAd);
router.put('/:id', requireAuth, adsController.updateAd);
router.put('/:id/status', requireAuth, adsController.updateAdStatus);
router.delete('/:id', requireAuth, adsController.deleteAd);

export default router;
