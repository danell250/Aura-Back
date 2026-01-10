import express from 'express';
import { messagesController } from '../controllers/messagesController';

const router = express.Router();

// GET /api/messages/conversations - Get all conversations for a user
router.get('/conversations', messagesController.getConversations);

// GET /api/messages/:userId - Get messages between current user and another user
router.get('/:userId', messagesController.getMessages);

// POST /api/messages - Send a new message
router.post('/', messagesController.sendMessage);

// PUT /api/messages/:messageId - Edit a message
router.put('/:messageId', messagesController.editMessage);

// DELETE /api/messages/:messageId - Delete a message
router.delete('/:messageId', messagesController.deleteMessage);

// PUT /api/messages/mark-read - Mark messages as read
router.put('/mark-read', messagesController.markAsRead);

export default router;