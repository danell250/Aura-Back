import express from 'express';
import { generatePostInspiration, suggestReply, generateQuirkyBirthdayWish, analyzeDataAura, generateContent } from '../controllers/geminiController';

const router = express.Router();

router.post('/inspiration', generatePostInspiration);
router.post('/reply', suggestReply);
router.post('/birthday', generateQuirkyBirthdayWish);
router.post('/analyze', analyzeDataAura);
router.post('/content', generateContent);

export default router;
