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
    var _a, _b, _c, _d, _e;
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
        const summary = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.summary) === 'object' && ((_c = req.body) === null || _c === void 0 ? void 0 : _c.summary) ? req.body.summary : {};
        const deliveryMode = ((_d = req.body) === null || _d === void 0 ? void 0 : _d.deliveryMode) === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
        let pdfAttachment;
        const rawAttachment = (_e = req.body) === null || _e === void 0 ? void 0 : _e.pdfAttachment;
        if (rawAttachment && typeof rawAttachment === 'object') {
            const filename = typeof rawAttachment.filename === 'string' ? rawAttachment.filename.trim() : '';
            const contentBase64 = typeof rawAttachment.contentBase64 === 'string' ? rawAttachment.contentBase64.trim() : '';
            if (contentBase64.length > 0) {
                const normalizedBase64 = contentBase64.replace(/^data:application\/pdf;base64,/, '');
                if (normalizedBase64.length > 8000000) {
                    return res.status(400).json({ success: false, error: 'PDF attachment is too large' });
                }
                pdfAttachment = {
                    filename: filename || 'aura-scheduled-report.pdf',
                    contentBase64: normalizedBase64
                };
            }
        }
        const payload = Object.assign(Object.assign(Object.assign({}, summary), { deliveryMode }), (pdfAttachment ? { pdfAttachment } : {}));
        yield Promise.all(recipients.map((recipient) => (0, emailService_1.sendReportPreviewEmail)(recipient, payload)));
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
