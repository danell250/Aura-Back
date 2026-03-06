"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCachedDiscoveredCount = exports.buildDiscoveredCountCacheKey = exports.buildDiscoveredWindowFilter = exports.buildPublicJobsQuerySpec = exports.ensureJobsTextIndex = exports.getPagination = exports.JOB_DISCOVERED_WINDOW_MINUTES = exports.ALLOWED_JOB_STATUSES = exports.JOBS_COLLECTION = void 0;
const crypto_1 = __importDefault(require("crypto"));
const inputSanitizers_1 = require("../utils/inputSanitizers");
exports.JOBS_COLLECTION = 'jobs';
exports.ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
exports.JOB_DISCOVERED_WINDOW_MINUTES = 30;
const JOB_DISCOVERED_COUNT_CACHE_TTL_MS = 60000;
const JOB_DISCOVERED_COUNT_CACHE_MAX_KEYS = 100;
const discoveredCountCache = new Map();
let jobsTextIndexEnsured = false;
const escapeRegexPattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sanitizeSearchRegex = (raw) => {
    const trimmed = (0, inputSanitizers_1.readString)(raw, 100);
    if (!trimmed)
        return null;
    const escaped = escapeRegexPattern(trimmed);
    return new RegExp(escaped, 'i');
};
const parseDelimitedAllowedValues = (raw, allowed) => raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0 && allowed.has(item));
const getPagination = (query) => {
    const page = (0, inputSanitizers_1.parsePositiveInt)(query.page, 1, 1, 100000);
    const limit = (0, inputSanitizers_1.parsePositiveInt)(query.limit, 20, 1, 100);
    return {
        page,
        limit,
        skip: (page - 1) * limit,
    };
};
exports.getPagination = getPagination;
const ensureJobsTextIndex = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (jobsTextIndexEnsured)
        return true;
    try {
        yield db.collection(exports.JOBS_COLLECTION).createIndex({
            title: 'text',
            summary: 'text',
            description: 'text',
            locationText: 'text',
            companyName: 'text',
            companyHandle: 'text',
            tags: 'text',
        }, {
            name: 'jobs_public_search_text_idx',
            weights: {
                title: 10,
                companyName: 8,
                tags: 6,
                summary: 4,
                description: 2,
                locationText: 2,
                companyHandle: 1,
            },
        });
        jobsTextIndexEnsured = true;
        return true;
    }
    catch (error) {
        const message = String((error === null || error === void 0 ? void 0 : error.message) || '').toLowerCase();
        if (message.includes('already exists') ||
            message.includes('index with name') ||
            message.includes('equivalent index already exists')) {
            jobsTextIndexEnsured = true;
            return true;
        }
        console.error('Failed to ensure jobs text index:', error);
        return false;
    }
});
exports.ensureJobsTextIndex = ensureJobsTextIndex;
const buildPublicJobsQuerySpec = (params) => {
    const workModels = params.workModelRaw
        ? parseDelimitedAllowedValues(params.workModelRaw, ALLOWED_WORK_MODELS)
        : [];
    const employmentTypes = params.employmentTypeRaw
        ? parseDelimitedAllowedValues(params.employmentTypeRaw, ALLOWED_EMPLOYMENT_TYPES)
        : [];
    const locationRegex = sanitizeSearchRegex(params.locationRaw);
    const companyRegex = sanitizeSearchRegex(params.companyRaw);
    const searchText = (0, inputSanitizers_1.readString)(params.searchRaw, 120);
    const andClauses = [];
    if (params.status === 'all') {
        andClauses.push({ status: { $ne: 'archived' } });
    }
    else {
        andClauses.push({ status: params.status });
    }
    if (workModels.length > 0) {
        andClauses.push({ workModel: { $in: workModels } });
    }
    if (employmentTypes.length > 0) {
        andClauses.push({ employmentType: { $in: employmentTypes } });
    }
    if (locationRegex) {
        andClauses.push({ locationText: locationRegex });
    }
    if (companyRegex) {
        andClauses.push({ companyName: companyRegex });
    }
    if (Number.isFinite(params.minSalary) && params.minSalary > 0) {
        andClauses.push({
            $or: [
                { salaryMax: { $gte: params.minSalary } },
                { salaryMin: { $gte: params.minSalary } },
            ],
        });
    }
    if (Number.isFinite(params.maxSalary) && params.maxSalary > 0) {
        andClauses.push({
            $or: [
                { salaryMin: { $lte: params.maxSalary } },
                { salaryMax: { $lte: params.maxSalary } },
            ],
        });
    }
    if (Number.isFinite(params.postedWithinHours) && params.postedWithinHours > 0) {
        const thresholdIso = new Date(Date.now() - (params.postedWithinHours * 60 * 60 * 1000)).toISOString();
        andClauses.push({
            $or: [
                { publishedAt: { $gte: thresholdIso } },
                { createdAt: { $gte: thresholdIso } },
            ],
        });
    }
    const usesTextSearch = searchText.length > 0 && params.allowTextSearch;
    if (usesTextSearch) {
        andClauses.push({ $text: { $search: searchText } });
    }
    const filter = andClauses.length === 1
        ? andClauses[0]
        : andClauses.length > 1
            ? { $and: andClauses }
            : {};
    const sortByNormalized = (0, inputSanitizers_1.readString)(params.sortBy, 40).toLowerCase();
    const sort = sortByNormalized === 'salary_desc'
        ? Object.assign(Object.assign({ salaryMax: -1, salaryMin: -1 }, (usesTextSearch ? { score: { $meta: 'textScore' } } : {})), { publishedAt: -1, createdAt: -1 }) : sortByNormalized === 'salary_asc'
        ? Object.assign(Object.assign({ salaryMin: 1, salaryMax: 1 }, (usesTextSearch ? { score: { $meta: 'textScore' } } : {})), { publishedAt: -1, createdAt: -1 }) : usesTextSearch
        ? { score: { $meta: 'textScore' }, publishedAt: -1, createdAt: -1 }
        : { publishedAt: -1, createdAt: -1 };
    return {
        filter: filter,
        sort,
        usesTextSearch,
        searchText,
    };
};
exports.buildPublicJobsQuerySpec = buildPublicJobsQuerySpec;
const buildDiscoveredWindowFilter = (baseFilter, thresholdIso) => {
    const hasBaseFilter = baseFilter && Object.keys(baseFilter).length > 0;
    const discoveredClause = {
        discoveredAt: {
            $type: 'string',
            $gte: thresholdIso,
        },
    };
    if (!hasBaseFilter)
        return discoveredClause;
    return { $and: [baseFilter, discoveredClause] };
};
exports.buildDiscoveredWindowFilter = buildDiscoveredWindowFilter;
const buildDiscoveredCountCacheKey = (parts) => {
    const normalizedParts = Object.entries(parts)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value !== null && value !== void 0 ? value : ''))}`)
        .join('&');
    return crypto_1.default.createHash('sha256').update(normalizedParts).digest('hex');
};
exports.buildDiscoveredCountCacheKey = buildDiscoveredCountCacheKey;
const refreshDiscoveredCountCacheEntry = (cacheKey, entry) => {
    discoveredCountCache.delete(cacheKey);
    discoveredCountCache.set(cacheKey, entry);
};
const storeDiscoveredCountCacheEntry = (cacheKey, entry, now) => {
    refreshDiscoveredCountCacheEntry(cacheKey, entry);
    pruneDiscoveredCountCache(now);
};
const pruneDiscoveredCountCache = (now) => {
    for (const [key, cacheValue] of discoveredCountCache.entries()) {
        if (cacheValue.expiresAt <= now) {
            discoveredCountCache.delete(key);
        }
    }
    while (discoveredCountCache.size > JOB_DISCOVERED_COUNT_CACHE_MAX_KEYS) {
        const oldestEntry = discoveredCountCache.keys().next();
        if (oldestEntry.done)
            break;
        discoveredCountCache.delete(oldestEntry.value);
    }
};
const resolveCachedDiscoveredCount = (db, filter, cacheKey) => __awaiter(void 0, void 0, void 0, function* () {
    const now = Date.now();
    pruneDiscoveredCountCache(now);
    const cached = discoveredCountCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        refreshDiscoveredCountCacheEntry(cacheKey, cached);
        return cached.count;
    }
    const count = yield db.collection(exports.JOBS_COLLECTION).countDocuments(filter);
    storeDiscoveredCountCacheEntry(cacheKey, {
        count,
        expiresAt: now + JOB_DISCOVERED_COUNT_CACHE_TTL_MS,
    }, now);
    return count;
});
exports.resolveCachedDiscoveredCount = resolveCachedDiscoveredCount;
