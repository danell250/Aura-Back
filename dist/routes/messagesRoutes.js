"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const messagesController_1 = require("../controllers/messagesController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// Apply requireAuth to all routes in this router
router.use(authMiddleware_1.requireAuth);
// GET /api/messages/conversations - Get all conversations for a user
router.get('/conversations', messagesController_1.messagesController.getConversations);
// Alias for conversation-specific messages
router.get('/conversation/:userId', messagesController_1.messagesController.getMessages);
// PUT /api/messages/mark-read - Mark messages as read
router.put('/mark-read', messagesController_1.messagesController.markAsRead);
// DELETE /api/messages/conversation - Delete all messages in a conversation
router.delete('/conversation', messagesController_1.messagesController.deleteConversation);
// POST /api/messages/archive - Archive or unarchive a conversation
router.post('/archive', messagesController_1.messagesController.archiveConversation);
// POST /api/messages - Send a new message
router.post('/', messagesController_1.messagesController.sendMessage);
// GET /api/messages/:userId - Get messages between current user and another user
router.get('/:userId', messagesController_1.messagesController.getMessages);
// PUT /api/messages/:messageId - Edit a message
router.put('/:messageId', messagesController_1.messagesController.editMessage);
// DELETE /api/messages/:messageId - Delete a message
router.delete('/:messageId', messagesController_1.messagesController.deleteMessage);
exports.default = router;
