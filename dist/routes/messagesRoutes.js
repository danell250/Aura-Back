"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const messagesController_1 = require("../controllers/messagesController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// GET /api/messages/conversations - Get all conversations for a user
router.get('/conversations', authMiddleware_1.requireAuth, messagesController_1.messagesController.getConversations);
// PUT /api/messages/mark-read - Mark messages as read
router.put('/mark-read', authMiddleware_1.requireAuth, messagesController_1.messagesController.markAsRead);
// DELETE /api/messages/conversation - Delete all messages in a conversation
router.delete('/conversation', authMiddleware_1.requireAuth, messagesController_1.messagesController.deleteConversation);
// POST /api/messages/archive - Archive or unarchive a conversation
router.post('/archive', authMiddleware_1.requireAuth, messagesController_1.messagesController.archiveConversation);
// POST /api/messages - Send a new message
router.post('/', authMiddleware_1.requireAuth, messagesController_1.messagesController.sendMessage);
// GET /api/messages/:userId - Get messages between current user and another user
router.get('/:userId', authMiddleware_1.requireAuth, messagesController_1.messagesController.getMessages);
// PUT /api/messages/:messageId - Edit a message
router.put('/:messageId', authMiddleware_1.requireAuth, messagesController_1.messagesController.editMessage);
// DELETE /api/messages/:messageId - Delete a message
router.delete('/:messageId', authMiddleware_1.requireAuth, messagesController_1.messagesController.deleteMessage);
exports.default = router;
