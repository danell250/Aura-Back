"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublicAuthCallbackUrl = exports.getPublicWebUrl = void 0;
const DEFAULT_PUBLIC_WEB_URL = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5003'
    : 'https://www.aurasocial.world';
const normalizeUrl = (value) => value.trim().replace(/\/$/, '');
const getPublicWebUrl = () => {
    const configured = process.env.PUBLIC_WEB_URL ||
        process.env.AURA_PUBLIC_WEB_URL ||
        process.env.PUBLIC_AUTH_BASE_URL ||
        process.env.FRONTEND_URL ||
        process.env.VITE_FRONTEND_URL ||
        '';
    if (configured && configured.trim().length > 0) {
        return normalizeUrl(configured);
    }
    return DEFAULT_PUBLIC_WEB_URL;
};
exports.getPublicWebUrl = getPublicWebUrl;
const buildPublicAuthCallbackUrl = (provider) => `${(0, exports.getPublicWebUrl)()}/api/auth/${provider}/callback`;
exports.buildPublicAuthCallbackUrl = buildPublicAuthCallbackUrl;
