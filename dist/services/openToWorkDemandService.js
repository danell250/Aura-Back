"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDemandSignals = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const DEMAND_LABEL_CACHE_MAX_KEYS = 600;
const PROFILE_VIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const demandLabelCache = new Map();
const ROLE_FAMILY_MAPPINGS = [
    { pattern: /\b(paid media|performance marketing|google ads)\b/, label: 'Paid Media Manager', roleFamily: 'paid-media' },
    { pattern: /\b(growth marketer|growth marketing|growth)\b/, label: 'Growth Marketer', roleFamily: 'growth-marketing' },
    { pattern: /\b(seo)\b/, label: 'SEO Specialist', roleFamily: 'seo' },
    { pattern: /\b(product manager|product management)\b/, label: 'Product Manager', roleFamily: 'product-management' },
    { pattern: /\b(product designer|ux designer|ui designer|designer)\b/, label: 'Product Designer', roleFamily: 'product-design' },
    { pattern: /\b(data analyst|analytics)\b/, label: 'Data Analyst', roleFamily: 'data-analytics' },
    { pattern: /\b(frontend|front-end|backend|back-end|full stack|full-stack|software engineer|software developer|developer|engineer)\b/, label: 'Software Engineer', roleFamily: 'software-engineering' },
    { pattern: /\b(marketing manager|marketing specialist|marketing)\b/, label: 'Marketing Manager', roleFamily: 'marketing' },
    { pattern: /\b(customer success|customer support)\b/, label: 'Customer Success', roleFamily: 'customer-success' },
    { pattern: /\b(sales|account executive|business development)\b/, label: 'Sales', roleFamily: 'sales' },
];
const touchDemandLabelCache = (key, value) => {
    demandLabelCache.delete(key);
    demandLabelCache.set(key, value);
};
const storeDemandLabelCache = (key, value) => {
    while (demandLabelCache.size >= DEMAND_LABEL_CACHE_MAX_KEYS) {
        const oldest = demandLabelCache.keys().next();
        if (oldest.done)
            break;
        demandLabelCache.delete(oldest.value);
    }
    demandLabelCache.set(key, value);
};
const normalizeRoleFamilySlug = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const resolveTimestampMs = (value) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (value instanceof Date) {
        const parsed = value.getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};
const normalizeDemandLabel = (rawTitle) => {
    const normalized = (0, inputSanitizers_1.readString)(rawTitle, 160).toLowerCase();
    if (!normalized)
        return null;
    const cached = demandLabelCache.get(normalized);
    if (cached !== undefined) {
        touchDemandLabelCache(normalized, cached);
        return cached;
    }
    const cleaned = normalized
        .replace(/\b(senior|sr|junior|jr|mid|intermediate|lead|principal|staff|remote|hybrid|onsite|on-site|cape town|johannesburg|south africa)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    for (const mapping of ROLE_FAMILY_MAPPINGS) {
        if (mapping.pattern.test(cleaned)) {
            const result = { roleFamily: mapping.roleFamily, label: mapping.label };
            storeDemandLabelCache(normalized, result);
            return result;
        }
    }
    const fallback = cleaned
        .split(/\s+/)
        .slice(0, 5)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
    if (!fallback) {
        storeDemandLabelCache(normalized, null);
        return null;
    }
    const result = {
        roleFamily: normalizeRoleFamilySlug(fallback),
        label: fallback,
    };
    storeDemandLabelCache(normalized, result);
    return result;
};
const computeDemandSignals = (jobs) => {
    const freshThresholdMs = Date.now() - PROFILE_VIEW_WINDOW_MS;
    const grouped = new Map();
    for (const job of jobs) {
        const normalized = normalizeDemandLabel(job === null || job === void 0 ? void 0 : job.title);
        if (!normalized)
            continue;
        const existing = grouped.get(normalized.roleFamily) || {
            roleFamily: normalized.roleFamily,
            label: normalized.label,
            activeJobs: 0,
            freshJobs7d: 0,
        };
        existing.activeJobs += 1;
        const freshnessMs = resolveTimestampMs(job === null || job === void 0 ? void 0 : job.discoveredAt) || resolveTimestampMs(job === null || job === void 0 ? void 0 : job.publishedAt);
        if (freshnessMs >= freshThresholdMs) {
            existing.freshJobs7d += 1;
        }
        grouped.set(normalized.roleFamily, existing);
    }
    const groupedEntries = Array.from(grouped.values());
    const maxActiveJobs = groupedEntries.reduce((max, entry) => Math.max(max, entry.activeJobs), 0);
    const maxDemandScore = groupedEntries.reduce((max, entry) => Math.max(max, (entry.activeJobs * 2) + (entry.freshJobs7d * 3)), 0);
    const highActiveThreshold = Math.max(6, Math.ceil(maxActiveJobs * 0.7));
    const mediumActiveThreshold = Math.max(3, Math.ceil(maxActiveJobs * 0.35));
    const highScoreThreshold = Math.max(18, Math.ceil(maxDemandScore * 0.75));
    const mediumScoreThreshold = Math.max(8, Math.ceil(maxDemandScore * 0.45));
    return groupedEntries
        .map((entry) => {
        const demandScore = (entry.activeJobs * 2) + (entry.freshJobs7d * 3);
        let demand = 'LOW';
        if (demandScore >= highScoreThreshold || entry.activeJobs >= highActiveThreshold) {
            demand = 'HIGH';
        }
        else if (demandScore >= mediumScoreThreshold || entry.activeJobs >= mediumActiveThreshold) {
            demand = 'MEDIUM';
        }
        return Object.assign(Object.assign({}, entry), { demand });
    })
        .sort((left, right) => {
        const scoreDelta = ((right.activeJobs * 2) + (right.freshJobs7d * 3)) - ((left.activeJobs * 2) + (left.freshJobs7d * 3));
        if (scoreDelta !== 0)
            return scoreDelta;
        return right.activeJobs - left.activeJobs;
    })
        .slice(0, 3);
};
exports.computeDemandSignals = computeDemandSignals;
