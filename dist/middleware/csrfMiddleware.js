"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCsrfProtection = void 0;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const normalizeOrigin = (value) => value.trim().replace(/\/$/, '').toLowerCase();
const parseRefererOrigin = (value) => {
    if (typeof value !== 'string' || value.trim().length === 0)
        return '';
    try {
        return normalizeOrigin(new URL(value).origin);
    }
    catch (_a) {
        return '';
    }
};
const isCsrfEnforced = () => process.env.CSRF_PROTECTION_ENABLED === 'true' ||
    process.env.NODE_ENV === 'production';
const createCsrfProtection = (options) => {
    const trustedOrigins = new Set(options.allowedOrigins
        .filter((origin) => typeof origin === 'string' && origin.trim().length > 0)
        .map(normalizeOrigin));
    return (req, res, next) => {
        var _a, _b, _c;
        if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
            return next();
        }
        const hasSessionCookie = !!((_a = req.cookies) === null || _a === void 0 ? void 0 : _a.accessToken) ||
            !!((_b = req.cookies) === null || _b === void 0 ? void 0 : _b.refreshToken) ||
            !!((_c = req.cookies) === null || _c === void 0 ? void 0 : _c['connect.sid']);
        // CSRF is relevant for browser-cookie sessions only.
        if (!hasSessionCookie) {
            return next();
        }
        const origin = typeof req.headers.origin === 'string'
            ? normalizeOrigin(req.headers.origin)
            : '';
        const refererOrigin = parseRefererOrigin(req.headers.referer);
        const requestOrigin = origin || refererOrigin;
        if (requestOrigin && trustedOrigins.has(requestOrigin)) {
            return next();
        }
        if (!isCsrfEnforced()) {
            console.warn('[CSRF] Non-production request missing trusted origin. Allowed due scaffold mode.', {
                method: req.method,
                path: req.originalUrl,
                origin: origin || null,
                refererOrigin: refererOrigin || null
            });
            return next();
        }
        return res.status(403).json({
            success: false,
            error: 'CSRF validation failed',
            message: 'Request origin is not allowed for cookie-authenticated write operation'
        });
    };
};
exports.createCsrfProtection = createCsrfProtection;
