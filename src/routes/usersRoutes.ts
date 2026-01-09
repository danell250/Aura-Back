import { Router } from 'express';

const router = Router();

console.log('Users routes loaded successfully');

// Simple test route
router.get('/test', (req, res) => {
  res.json({ message: 'Users route test working!' });
});

// GET /api/users - Get all users (simple version)
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: '1',
        firstName: 'James',
        lastName: 'Mitchell',
        name: 'James Mitchell',
        handle: '@jamesmitchell',
        email: 'james@leadership.io',
        trustScore: 98,
        auraCredits: 0
      }
    ]
  });
});

export default router;