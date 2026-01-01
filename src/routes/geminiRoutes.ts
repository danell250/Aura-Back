import express from 'express';
import { generatePostInspiration, suggestReply, generateQuirkyBirthdayWish, analyzeDataAura } from '../controllers/geminiController';

const router = express.Router();

router.post('/inspiration', generatePostInspiration);
router.post('/reply', suggestReply);
router.post('/birthday', generateQuirkyBirthdayWish);
router.post('/analyze', analyzeDataAura);

export default router;
