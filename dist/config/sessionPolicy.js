"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSessionCookiePolicy = void 0;
const getHostnameFromUrl = (value) => {
    try {
        return new URL(value).hostname;
    }
    catch (_a) {
        return '';
    }
};
const normalizeSameSite = (value) => {
    if (value === 'none' || value === 'strict' || value === 'lax') {
        return value;
    }
    return null;
};
const resolveSessionCookiePolicy = ({ isProductionRuntime, configuredSameSite, configuredDomain, frontendUrl, backendUrl, }) => {
    const frontendHostname = getHostnameFromUrl(frontendUrl);
    const backendHostname = getHostnameFromUrl(backendUrl);
    const requiresCrossSiteCookie = !!frontendHostname && !!backendHostname && frontendHostname !== backendHostname;
    const explicitSameSite = normalizeSameSite(configuredSameSite);
    const sameSite = explicitSameSite || (isProductionRuntime && requiresCrossSiteCookie ? 'none' : 'lax');
    const secure = isProductionRuntime || sameSite === 'none';
    return {
        secure,
        sameSite,
        domain: configuredDomain || undefined,
        requiresCrossSiteCookie,
    };
};
exports.resolveSessionCookiePolicy = resolveSessionCookiePolicy;
