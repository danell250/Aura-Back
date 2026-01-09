import { Router } from 'express';

const router = Router();

// Placeholder for posts routes
// These will be implemented when database integration is fully ready

router.get('/', (req, res) => {
  // For now, return empty array or mock data since DB might not be connected
  res.json({ 
    message: 'Posts endpoint - using mock data since database may not be connected',
    posts: [] 
  });
});

router.post('/', (req, res) => {
  res.status(400).json({ 
    error: 'Database not available - posts cannot be created in this deployment' 
  });
});

export default router;