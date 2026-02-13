import express from 'express';
import { messagesController } from '../controllers/messagesController';
import { requireAuth } from '../middleware/authMiddleware';

const router = express.Router();

// GET /api/messages/conversations - Get all conversations for a user
router.get('/conversations', requireAuth, messagesController.getConversations);

// PUT /api/messages/mark-read - Mark messages as read
router.put('/mark-read', requireAuth, messagesController.markAsRead);

// DELETE /api/messages/conversation - Delete all messages in a conversation
router.delete('/conversation', requireAuth, messagesController.deleteConversation);

// POST /api/messages/archive - Archive or unarchive a conversation
router.post('/archive', requireAuth, messagesController.archiveConversation);

// POST /api/messages - Send a new message
router.post('/', requireAuth, messagesController.sendMessage);

// GET /api/messages/:userId - Get messages between current user and another user
router.get('/:userId', requireAuth, messagesController.getMessages);

// PUT /api/messages/:messageId - Edit a message
router.put('/:messageId', requireAuth, messagesController.editMessage);

// DELETE /api/messages/:messageId - Delete a message
router.delete('/:messageId', requireAuth, messagesController.deleteMessage);

export default router;
