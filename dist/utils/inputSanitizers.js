"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePositiveInt = exports.readStringOrNull = exports.readString = void 0;
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
exports.readString = readString;
const readStringOrNull = (value, maxLength = 10000) => {
    const normalized = (0, exports.readString)(value, maxLength);
    return normalized.length > 0 ? normalized : null;
};
exports.readStringOrNull = readStringOrNull;
const parsePositiveInt = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    const rounded = Math.round(parsed);
    if (rounded < min)
        return min;
    if (rounded > max)
        return max;
    return rounded;
};
exports.parsePositiveInt = parsePositiveInt;
