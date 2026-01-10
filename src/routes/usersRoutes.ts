import { Router } from 'express';
import { usersController } from '../controllers/usersController';

const router = Router();

console.log('Users routes loaded successfully');

// GET /api/users - Get all users
router.get('/', usersController.getAllUsers);

// GET /api/users/:id - Get user by ID
router.get('/:id', usersController.getUserById);

// POST /api/users - Create new user
router.post('/', usersController.createUser);

// PUT /api/users/:id - Update user
router.put('/:id', usersController.updateUser);

// DELETE /api/users/:id - Delete user
router.delete('/:id', usersController.deleteUser);

// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', usersController.sendConnectionRequest);

// POST /api/users/:id/block - Block user
router.post('/:id/block', usersController.blockUser);

export default router;