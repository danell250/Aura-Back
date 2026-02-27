"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requiresRelaxedCrossOriginPolicy = void 0;
const RELAXED_CROSS_ORIGIN_PATH_PREFIXES = [
    '/payment-success',
    '/payment-cancelled',
    '/api/auth/google',
    '/api/auth/github',
    '/api/auth/linkedin',
    '/api/auth/discord',
];
const requiresRelaxedCrossOriginPolicy = (requestPath) => {
    return RELAXED_CROSS_ORIGIN_PATH_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
};
exports.requiresRelaxedCrossOriginPolicy = requiresRelaxedCrossOriginPolicy;
