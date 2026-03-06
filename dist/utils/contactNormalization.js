"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeEmailAddress = exports.normalizeExternalUrl = void 0;
const inputSanitizers_1 = require("./inputSanitizers");
const normalizeExternalUrl = (value, maxLength = 600) => {
    const raw = (0, inputSanitizers_1.readString)(String(value || ''), maxLength);
    if (!raw)
        return null;
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const parsed = new URL(withProtocol);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return null;
        return parsed.toString();
    }
    catch (_a) {
        return null;
    }
};
exports.normalizeExternalUrl = normalizeExternalUrl;
const normalizeEmailAddress = (value, maxLength = 200) => {
    const raw = (0, inputSanitizers_1.readString)(String(value || ''), maxLength).toLowerCase();
    if (!raw)
        return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))
        return null;
    return raw;
};
exports.normalizeEmailAddress = normalizeEmailAddress;
