"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestFingerprint = void 0;
const fnv1a = (value) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};
const requestFingerprint = (req) => {
    var _a, _b;
    const ip = ((_b = (_a = req.headers['x-forwarded-for']) === null || _a === void 0 ? void 0 : _a.split(',')[0]) === null || _b === void 0 ? void 0 : _b.trim()) || req.ip || '';
    const userAgent = String(req.headers['user-agent'] || '');
    return fnv1a(`${ip}|${userAgent}`);
};
exports.requestFingerprint = requestFingerprint;
