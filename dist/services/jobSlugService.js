"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeJobSlugValue = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const normalizeJobSlugValue = (value, maxLength = 220) => {
    const raw = (0, inputSanitizers_1.readString)(String(value || ''), maxLength)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (!raw)
        return '';
    return raw
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
};
exports.normalizeJobSlugValue = normalizeJobSlugValue;
