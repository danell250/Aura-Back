"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveJobPulseDiscoveredAt = exports.resolveJobPulseSourceType = exports.normalizeJobPulseCount = exports.resolveLatestJobPulseIso = exports.parseJobPulseIsoMs = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const parseJobPulseIsoMs = (value) => {
    const normalized = (0, inputSanitizers_1.readString)(String(value || ''), 80);
    if (!normalized)
        return 0;
    const parsed = new Date(normalized).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};
exports.parseJobPulseIsoMs = parseJobPulseIsoMs;
const resolveLatestJobPulseIso = (...values) => {
    let bestValue = null;
    let bestMs = Number.NEGATIVE_INFINITY;
    for (const value of values) {
        const parsedMs = (0, exports.parseJobPulseIsoMs)(value);
        if (parsedMs <= 0)
            continue;
        if (parsedMs <= bestMs)
            continue;
        bestMs = parsedMs;
        bestValue = value || null;
    }
    return bestValue;
};
exports.resolveLatestJobPulseIso = resolveLatestJobPulseIso;
const normalizeJobPulseCount = (value) => Number.isFinite(Number(value))
    ? Math.max(0, Math.floor(Number(value)))
    : 0;
exports.normalizeJobPulseCount = normalizeJobPulseCount;
const resolveJobPulseSourceType = (source) => source && source.startsWith('aura:')
    ? 'aura'
    : 'aggregated';
exports.resolveJobPulseSourceType = resolveJobPulseSourceType;
const resolveJobPulseDiscoveredAt = (job) => (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.discoveredAt, 80) || null;
exports.resolveJobPulseDiscoveredAt = resolveJobPulseDiscoveredAt;
