"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adsController_1 = require("../controllers/adsController");
const router = (0, express_1.Router)();
console.log('Ads routes loaded successfully');
// GET /api/ads - Get all ads
router.get('/', adsController_1.adsController.getAllAds);
// GET /api/ads/:id - Get ad by ID
router.get('/:id', adsController_1.adsController.getAdById);
// POST /api/ads - Create new ad
router.post('/', adsController_1.adsController.createAd);
// PUT /api/ads/:id - Update ad
router.put('/:id', adsController_1.adsController.updateAd);
// DELETE /api/ads/:id - Delete ad
router.delete('/:id', adsController_1.adsController.deleteAd);
// POST /api/ads/:id/react - Add reaction to ad
router.post('/:id/react', adsController_1.adsController.reactToAd);
// PUT /api/ads/:id/status - Update ad status
router.put('/:id/status', adsController_1.adsController.updateAdStatus);
exports.default = router;
