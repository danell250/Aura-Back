import express from 'express';
import { shareController } from '../controllers/shareController';

const router = express.Router();

// Route for sharing posts: /share/p/:id
router.get('/p/:id', shareController.getPostShare);

export default router;
