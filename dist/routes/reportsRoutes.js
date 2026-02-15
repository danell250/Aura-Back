"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middleware/authMiddleware");
const emailService_1 = require("../services/emailService");
const router = (0, express_1.Router)();
router.post('/preview-email', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const actor = req.user;
        if (!(actor === null || actor === void 0 ? void 0 : actor.id)) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const recipientsRaw = (_a = req.body) === null || _a === void 0 ? void 0 : _a.recipients;
        if (!Array.isArray(recipientsRaw) || recipientsRaw.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one recipient is required' });
        }
        const recipients = recipientsRaw
            .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
            .filter((entry) => entry.length > 0)
            .slice(0, 5);
        if (recipients.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid recipients found' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (recipients.some((entry) => !emailRegex.test(entry))) {
            return res.status(400).json({ success: false, error: 'One or more recipients are invalid' });
        }
        const summary = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.summary) || {};
        yield Promise.all(recipients.map((recipient) => (0, emailService_1.sendReportPreviewEmail)(recipient, summary)));
        return res.json({
            success: true,
            sentTo: recipients.length
        });
    }
    catch (error) {
        console.error('Error sending report preview email:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to send report preview email'
        });
    }
}));
exports.default = router;
