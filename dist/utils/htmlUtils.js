"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeNumber = exports.safeHtmlText = exports.escapeHtml = exports.safeText = void 0;
const safeText = (value, fallback = 'N/A') => {
    if (typeof value === 'string' && value.trim().length > 0)
        return value.trim();
    return fallback;
};
exports.safeText = safeText;
const escapeHtml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
exports.escapeHtml = escapeHtml;
const safeHtmlText = (value, fallback = 'N/A') => (0, exports.escapeHtml)((0, exports.safeText)(value, fallback));
exports.safeHtmlText = safeHtmlText;
const safeNumber = (value, digits = 2) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue))
        return Number(0).toFixed(digits);
    return numberValue.toFixed(digits);
};
exports.safeNumber = safeNumber;
