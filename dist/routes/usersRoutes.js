"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const usersController_1 = require("../controllers/usersController");
const router = (0, express_1.Router)();
console.log('Users routes loaded successfully');
// GET /api/users - Get all users
router.get('/', usersController_1.usersController.getAllUsers);
// GET /api/users/:id - Get user by ID
router.get('/:id', usersController_1.usersController.getUserById);
// POST /api/users - Create new user
router.post('/', usersController_1.usersController.createUser);
// PUT /api/users/:id - Update user
router.put('/:id', usersController_1.usersController.updateUser);
// DELETE /api/users/:id - Delete user
router.delete('/:id', usersController_1.usersController.deleteUser);
// POST /api/users/:id/connect - Send connection request
router.post('/:id/connect', usersController_1.usersController.sendConnectionRequest);
// POST /api/users/:id/block - Block user
router.post('/:id/block', usersController_1.usersController.blockUser);
// POST /api/users/:id/purchase-credits - Purchase credits
router.post('/:id/purchase-credits', usersController_1.usersController.purchaseCredits);
exports.default = router;
