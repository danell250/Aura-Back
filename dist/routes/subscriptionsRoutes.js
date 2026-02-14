"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const subscriptionsController_1 = require("../controllers/subscriptionsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// Get user subscriptions
router.get('/user/:userId', authMiddleware_1.requireAuth, subscriptionsController_1.subscriptionsController.getUserSubscriptions);
// Create subscription
router.post('/', authMiddleware_1.requireAuth, subscriptionsController_1.subscriptionsController.createSubscription);
// Cancel subscription
router.post('/:subscriptionId/cancel', authMiddleware_1.requireAuth, subscriptionsController_1.subscriptionsController.cancelSubscription);
// Webhook for PayPal subscription events
router.post('/webhook', subscriptionsController_1.subscriptionsController.handleWebhook);
exports.default = router;
