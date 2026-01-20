import express from 'express';
import { generatePostInspiration, suggestReply, analyzeDataAura, generateContent } from '../controllers/geminiController';

const router = express.Router();

router.post('/inspiration', generatePostInspiration);
router.post('/reply', suggestReply);
router.post('/analyze', analyzeDataAura);
router.post('/content', generateContent);

export default router;
