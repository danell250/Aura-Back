import express from 'express';
import { messagesController } from '../controllers/messagesController';
import { requireAuth } from '../middleware/authMiddleware';

const router = express.Router();

// Apply requireAuth to all routes in this router
router.use(requireAuth);

// GET /api/messages/rtc-config - Get WebRTC ICE configuration
router.get('/rtc-config', messagesController.getRtcConfig);

// GET /api/messages/conversations - Get all conversations for a user
router.get('/conversations', messagesController.getConversations);
// GET /api/messages/call-history - Get call history for an identity
router.get('/call-history', messagesController.getCallHistory);
// Alias for conversation-specific messages
router.get('/conversation/:userId', messagesController.getMessages);

// PUT /api/messages/mark-read - Mark messages as read
router.put('/mark-read', messagesController.markAsRead);

// DELETE /api/messages/conversation - Delete all messages in a conversation
router.delete('/conversation', messagesController.deleteConversation);

// POST /api/messages/archive - Archive or unarchive a conversation
router.post('/archive', messagesController.archiveConversation);

// POST /api/messages/thread-state - Set thread state (active|archived|requests|muted|blocked)
router.post('/thread-state', messagesController.setThreadState);

// GET /api/messages/thread-meta - Read thread metadata
router.get('/thread-meta', messagesController.getThreadMeta);

// POST /api/messages/thread-meta - Update thread metadata
router.post('/thread-meta', messagesController.updateThreadMeta);

// POST /api/messages - Send a new message
router.post('/', messagesController.sendMessage);

// GET /api/messages/:userId - Get messages between current user and another user
router.get('/:userId', messagesController.getMessages);

// PUT /api/messages/:messageId - Edit a message
router.put('/:messageId', messagesController.editMessage);

// DELETE /api/messages/:messageId - Delete a message
router.delete('/:messageId', messagesController.deleteMessage);

export default router;
