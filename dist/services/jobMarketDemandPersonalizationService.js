"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPersonalizedJobMarketDemandQuery = void 0;
const normalizeRoleHints = (user) => {
    const deduped = new Set();
    const hints = [];
    const preferredRoles = Array.isArray(user === null || user === void 0 ? void 0 : user.preferredRoles) ? user.preferredRoles : [];
    for (const value of preferredRoles) {
        const normalized = String(value || '').trim();
        if (!normalized)
            continue;
        const dedupeKey = normalized.toLowerCase();
        if (deduped.has(dedupeKey))
            continue;
        deduped.add(dedupeKey);
        hints.push(normalized);
        if (hints.length >= 6)
            return hints;
    }
    const title = String((user === null || user === void 0 ? void 0 : user.title) || '').trim();
    if (title && !deduped.has(title.toLowerCase())) {
        hints.push(title);
    }
    return hints.slice(0, 6);
};
const normalizeLocationHint = (user) => {
    const country = String((user === null || user === void 0 ? void 0 : user.country) || '').trim();
    if (country)
        return country;
    const preferredLocations = Array.isArray(user === null || user === void 0 ? void 0 : user.preferredLocations) ? user.preferredLocations : [];
    for (const value of preferredLocations) {
        const normalized = String(value || '').trim();
        if (!normalized)
            continue;
        const lower = normalized.toLowerCase();
        if (lower === 'remote' || lower === 'worldwide' || lower === 'global' || lower === 'anywhere')
            continue;
        return normalized;
    }
    return '';
};
const normalizeWorkModelHint = (user) => {
    const preferredWorkModels = Array.isArray(user === null || user === void 0 ? void 0 : user.preferredWorkModels)
        ? user.preferredWorkModels
            .map((value) => String(value || '').trim().toLowerCase())
            .filter((value) => value === 'remote' || value === 'hybrid' || value === 'onsite')
        : [];
    if (preferredWorkModels.length === 1) {
        return preferredWorkModels[0];
    }
    return '';
};
const buildPersonalizedJobMarketDemandQuery = (user, limit = 3) => ({
    location: normalizeLocationHint(user),
    workModel: normalizeWorkModelHint(user),
    roles: normalizeRoleHints(user),
    limit,
});
exports.buildPersonalizedJobMarketDemandQuery = buildPersonalizedJobMarketDemandQuery;
