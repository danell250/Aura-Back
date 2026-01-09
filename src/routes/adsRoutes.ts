import { Router } from 'express';
import { adsController } from '../controllers/adsController';

const router = Router();

console.log('Ads routes loaded successfully');

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