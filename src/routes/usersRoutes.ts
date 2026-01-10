import { Router, Request, Response } from 'express';
import { usersController } from '../controllers/usersController';

const router = Router();

console.log('Users routes loaded successfully');

// GET /api/users - Get all users
router.get('/', usersController.getAllUsers);

// POST /api/users - Create new user
router.post('/', usersController.createUser);

// POST /api/users/purchase-credits - Purchase credits (simplified route)
console.log('Registering purchase-credits route');
router.post('/purchase-credits', (req: Request, res: Response) => {
  console.log('Purchase credits route hit!', req.body);
  // Get userId from body instead of params for this simplified version
  const userId = req.body.userId;
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'Missing userId',
      message: 'userId is required in request body'
    });
  }
  
  // Modify req.params to include the id for the controller
  req.params.id = userId;
  usersController.purchaseCredits(req, res);
});

// Test route to verify routing works
router.post('/test-route', (req: Request, res: Response) => {
  console.log('Test route hit!');
  res.json({ success: true, message: 'Test route working!' });
});

// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', usersController.sendConnectionRequest);

// POST /api/users/:id/block - Block user
router.post('/:id/block', usersController.blockUser);

// GET /api/users/:id - Get user by ID
router.get('/:id', usersController.getUserById);

// PUT /api/users/:id - Update user
router.put('/:id', usersController.updateUser);

// DELETE /api/users/:id - Delete user
router.delete('/:id', usersController.deleteUser);

export default router;