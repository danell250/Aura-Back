import { Router } from 'express';
import { adsController } from '../controllers/adsController';
import { AD_PLANS } from '../constants/adPlans';

const router = Router();

console.log('Ads routes loaded successfully');

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

// GET /api/ads - Get all ads
router.get('/', adsController.getAllAds);

// GET /api/ads/:id - Get ad by ID
router.get('/:id', adsController.getAdById);

// POST /api/ads - Create new ad
router.post('/', adsController.createAd);

// PUT /api/ads/:id - Update ad
router.put('/:id', adsController.updateAd);

// DELETE /api/ads/:id - Delete ad
router.delete('/:id', adsController.deleteAd);

// POST /api/ads/:id/react - Add reaction to ad
router.post('/:id/react', adsController.reactToAd);

// PUT /api/ads/:id/status - Update ad status
router.put('/:id/status', adsController.updateAdStatus);

export default router;