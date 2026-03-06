"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSessionCookiePolicy = void 0;
const parseUrl = (value) => {
    try {
        return new URL(value);
    }
    catch (_a) {
        return null;
    }
};
const isLocalHostname = (value) => value === 'localhost'
    || value === '127.0.0.1'
    || value === '::1'
    || value.endsWith('.local');
const normalizeSameSite = (value) => {
    if (value === 'none' || value === 'strict' || value === 'lax') {
        return value;
    }
    return null;
};
const resolveSessionCookiePolicy = ({ isProductionRuntime, configuredSameSite, configuredDomain, frontendUrl, backendUrl, }) => {
    const frontendUrlObject = parseUrl(frontendUrl);
    const backendUrlObject = parseUrl(backendUrl);
    const frontendHostname = (frontendUrlObject === null || frontendUrlObject === void 0 ? void 0 : frontendUrlObject.hostname) || '';
    const backendHostname = (backendUrlObject === null || backendUrlObject === void 0 ? void 0 : backendUrlObject.hostname) || '';
    const requiresCrossSiteCookie = !!frontendHostname && !!backendHostname && frontendHostname !== backendHostname;
    const supportsSecureCrossSiteCookie = (frontendUrlObject === null || frontendUrlObject === void 0 ? void 0 : frontendUrlObject.protocol) === 'https:'
        && (backendUrlObject === null || backendUrlObject === void 0 ? void 0 : backendUrlObject.protocol) === 'https:';
    const hasPublicHttpsOrigin = [frontendUrlObject, backendUrlObject].some((urlObject) => !!urlObject
        && urlObject.protocol === 'https:'
        && !isLocalHostname(urlObject.hostname));
    const explicitSameSite = normalizeSameSite(configuredSameSite);
    let sameSite = explicitSameSite || ((isProductionRuntime || supportsSecureCrossSiteCookie) && requiresCrossSiteCookie ? 'none' : 'lax');
    let downgradedFromNone = false;
    if (sameSite === 'none' && !isProductionRuntime && !supportsSecureCrossSiteCookie) {
        sameSite = 'lax';
        downgradedFromNone = true;
    }
    const secure = isProductionRuntime || sameSite === 'none' || hasPublicHttpsOrigin;
    return {
        secure,
        sameSite,
        domain: configuredDomain || undefined,
        requiresCrossSiteCookie,
        supportsSecureCrossSiteCookie,
        downgradedFromNone,
        shouldEnableHsts: isProductionRuntime || hasPublicHttpsOrigin,
    };
};
exports.resolveSessionCookiePolicy = resolveSessionCookiePolicy;
