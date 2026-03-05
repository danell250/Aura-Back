"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.partnerAuth = void 0;
const crypto_1 = __importDefault(require("crypto"));
const PARTNER_KEY_ENV_KEYS = [
    'PARTNER_API_KEYS',
    'PARTNER_API_KEY',
    'JOBS_PARTNER_API_KEYS',
    'JOBS_PARTNER_API_KEY',
];
const readString = (value) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized;
};
const readFirstString = (value) => {
    if (typeof value === 'string')
        return readString(value);
    if (Array.isArray(value) && typeof value[0] === 'string')
        return readString(value[0]);
    return '';
};
const normalizeTokenCandidate = (value) => {
    if (!value)
        return '';
    try {
        return decodeURIComponent(value).trim();
    }
    catch (_a) {
        return value.trim();
    }
};
const parseConfiguredPartnerKeys = () => {
    const keys = new Set();
    for (const envKey of PARTNER_KEY_ENV_KEYS) {
        const raw = process.env[envKey];
        if (typeof raw !== 'string' || raw.trim().length === 0)
            continue;
        raw
            .split(',')
            .map((entry) => normalizeTokenCandidate(readString(entry)))
            .filter((entry) => entry.length > 0)
            .forEach((entry) => keys.add(entry));
    }
    return keys;
};
const toDigest = (value) => crypto_1.default.createHash('sha256').update(value).digest();
const buildPartnerKeyMaterial = () => Array.from(parseConfiguredPartnerKeys()).map((key) => ({
    key,
    digest: toDigest(key),
}));
let configuredPartnerKeyMaterial = buildPartnerKeyMaterial();
const readPartnerApiKeyFromRequest = (req) => {
    var _a;
    const queryKey = normalizeTokenCandidate(readFirstString((_a = req.query) === null || _a === void 0 ? void 0 : _a.apiKey));
    if (queryKey)
        return queryKey;
    const headerKey = normalizeTokenCandidate(readFirstString(req.headers['x-api-key']));
    if (headerKey)
        return headerKey;
    const authHeader = readFirstString(req.headers.authorization);
    if (authHeader.toLowerCase().startsWith('bearer ')) {
        return normalizeTokenCandidate(authHeader.slice(7));
    }
    return '';
};
const isSuppliedKeyValid = (suppliedKey) => {
    if (!suppliedKey || configuredPartnerKeyMaterial.length === 0)
        return false;
    const suppliedDigest = toDigest(suppliedKey);
    return configuredPartnerKeyMaterial.some((material) => crypto_1.default.timingSafeEqual(material.digest, suppliedDigest));
};
const partnerAuth = (req, res, next) => {
    const suppliedKey = readPartnerApiKeyFromRequest(req);
    if (configuredPartnerKeyMaterial.length === 0) {
        configuredPartnerKeyMaterial = buildPartnerKeyMaterial();
    }
    if (configuredPartnerKeyMaterial.length === 0) {
        return res.status(503).json({
            success: false,
            error: 'Partner syndication is not configured',
            message: 'No partner API keys are configured on this server',
        });
    }
    if (!isSuppliedKeyValid(suppliedKey)) {
        return res.status(401).json({
            success: false,
            error: 'Invalid partner API key',
            message: 'Provide a valid partner API key in ?apiKey= or x-api-key',
        });
    }
    return next();
};
exports.partnerAuth = partnerAuth;
