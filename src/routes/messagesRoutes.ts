import express from 'express';
import { messagesController } from '../controllers/messagesController';

const router = express.Router();

// GET /api/messages/conversations - Get all conversations for a user
router.get('/conversations', messagesController.getConversations);

// PUT /api/messages/mark-read - Mark messages as read
router.put('/mark-read', messagesController.markAsRead);

// DELETE /api/messages/conversation - Delete all messages in a conversation
router.delete('/conversation', messagesController.deleteConversation);

// POST /api/messages/archive - Archive or unarchive a conversation
router.post('/archive', messagesController.archiveConversation);

// POST /api/messages - Send a new message
router.post('/', messagesController.sendMessage);

// GET /api/messages/:userId - Get messages between current user and another user
router.get('/:userId', messagesController.getMessages);

// PUT /api/messages/:messageId - Edit a message
router.put('/:messageId', messagesController.editMessage);

// DELETE /api/messages/:messageId - Delete a message
router.delete('/:messageId', messagesController.deleteMessage);

export default router;
