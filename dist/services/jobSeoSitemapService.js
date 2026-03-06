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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJobsSitemapReadStream = exports.refreshJobsSitemapCache = exports.readJobsSitemapFilePath = exports.invalidateJobsSitemapCache = exports.getJobsSitemapFallbackXml = exports.ensureJobSeoSitemapIndexes = void 0;
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
const db_1 = require("../db");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobResponseService_1 = require("./jobResponseService");
const JOBS_COLLECTION = 'jobs';
const DEFAULT_SITEMAP_MAX_URLS = 50000;
const SITEMAP_CACHE_TTL_MS = 60 * 60 * 1000;
const SITEMAP_CACHE_MAX_KEYS = 4;
const SITEMAP_CACHE_DIR = path_1.default.join(os_1.default.tmpdir(), 'aura-jobs-sitemaps');
const AURA_PUBLIC_WEB_BASE_URL = ((0, inputSanitizers_1.readString)(process.env.AURA_PUBLIC_WEB_URL, 320)
    || (0, inputSanitizers_1.readString)(process.env.FRONTEND_URL, 320)
    || (0, inputSanitizers_1.readString)(process.env.VITE_FRONTEND_URL, 320)
    || 'https://aura.social').replace(/\/+$/, '');
const sitemapCache = new Map();
const pendingSitemapBuilds = new Map();
let jobsSitemapIndexesPromise = null;
const escapeXml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const normalizeSitemapLimit = (limit = DEFAULT_SITEMAP_MAX_URLS) => Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), DEFAULT_SITEMAP_MAX_URLS) : DEFAULT_SITEMAP_MAX_URLS;
const buildSitemapUrlEntry = (params) => [
    '<url>',
    `<loc>${escapeXml(params.loc)}</loc>`,
    params.lastmod ? `<lastmod>${escapeXml(params.lastmod)}</lastmod>` : '',
    `<changefreq>${params.changefreq}</changefreq>`,
    `<priority>${params.priority}</priority>`,
    '</url>',
].join('');
const removeFile = (filePath) => __awaiter(void 0, void 0, void 0, function* () {
    if (!filePath)
        return;
    yield fs_1.promises.unlink(filePath).catch(() => undefined);
});
const trimSitemapCache = () => __awaiter(void 0, void 0, void 0, function* () {
    while (sitemapCache.size > SITEMAP_CACHE_MAX_KEYS) {
        const oldest = sitemapCache.keys().next();
        if (oldest.done)
            break;
        const entry = sitemapCache.get(oldest.value);
        sitemapCache.delete(oldest.value);
        yield removeFile(entry === null || entry === void 0 ? void 0 : entry.filePath);
    }
});
const readCachedSitemapPath = (limit_1, ...args_1) => __awaiter(void 0, [limit_1, ...args_1], void 0, function* (limit, allowStale = false) {
    const cached = sitemapCache.get(limit);
    if (!cached)
        return null;
    if (!allowStale && cached.expiresAt <= Date.now()) {
        sitemapCache.delete(limit);
        yield removeFile(cached.filePath);
        return null;
    }
    const exists = yield fs_1.promises.access(cached.filePath).then(() => true).catch(() => false);
    if (!exists) {
        sitemapCache.delete(limit);
        return null;
    }
    sitemapCache.delete(limit);
    sitemapCache.set(limit, cached);
    return cached.filePath;
});
const storeCachedSitemap = (limit, filePath) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = sitemapCache.get(limit);
    sitemapCache.set(limit, {
        expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS,
        filePath,
    });
    if (existing && existing.filePath !== filePath) {
        yield removeFile(existing.filePath);
    }
    yield trimSitemapCache();
    return filePath;
});
const buildJobsBoardSitemapEntry = () => buildSitemapUrlEntry({
    loc: `${AURA_PUBLIC_WEB_BASE_URL}/jobs`,
    lastmod: new Date().toISOString(),
    changefreq: 'hourly',
    priority: '0.9',
});
const ensureJobSeoSitemapIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (!jobsSitemapIndexesPromise) {
        jobsSitemapIndexesPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
            yield db.collection(JOBS_COLLECTION).createIndex({
                status: 1,
                updatedAt: -1,
                publishedAt: -1,
                createdAt: -1,
                slug: 1,
                title: 1,
                locationText: 1,
                companyName: 1,
                companyHandle: 1,
                id: 1,
            }, { name: 'jobs_sitemap_status_updated_published_created_idx' });
        }))().catch((error) => {
            jobsSitemapIndexesPromise = null;
            throw error;
        });
    }
    return jobsSitemapIndexesPromise;
});
exports.ensureJobSeoSitemapIndexes = ensureJobSeoSitemapIndexes;
const getJobsSitemapFallbackXml = () => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    buildJobsBoardSitemapEntry(),
    '</urlset>',
].join('');
exports.getJobsSitemapFallbackXml = getJobsSitemapFallbackXml;
const writeXmlChunk = (stream, chunk) => __awaiter(void 0, void 0, void 0, function* () {
    if (!stream.write(chunk)) {
        yield (0, events_1.once)(stream, 'drain');
    }
});
const buildJobsSitemapFile = (limit) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c;
    yield fs_1.promises.mkdir(SITEMAP_CACHE_DIR, { recursive: true });
    const finalPath = path_1.default.join(SITEMAP_CACHE_DIR, `jobs-sitemap-${limit}.xml`);
    const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    const stream = (0, fs_1.createWriteStream)(tempPath, { encoding: 'utf8' });
    try {
        yield writeXmlChunk(stream, '<?xml version="1.0" encoding="UTF-8"?>');
        yield writeXmlChunk(stream, '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
        yield writeXmlChunk(stream, buildJobsBoardSitemapEntry());
        if ((0, db_1.isDBConnected)()) {
            const db = (0, db_1.getDB)();
            yield (0, exports.ensureJobSeoSitemapIndexes)(db);
            const cursor = db.collection(JOBS_COLLECTION)
                .find({ status: 'open' }, {
                projection: {
                    id: 1,
                    slug: 1,
                    title: 1,
                    locationText: 1,
                    companyName: 1,
                    companyHandle: 1,
                    updatedAt: 1,
                    publishedAt: 1,
                    createdAt: 1,
                },
            })
                .sort({ updatedAt: -1, publishedAt: -1, createdAt: -1 })
                .limit(limit);
            try {
                try {
                    for (var _d = true, cursor_1 = __asyncValues(cursor), cursor_1_1; cursor_1_1 = yield cursor_1.next(), _a = cursor_1_1.done, !_a; _d = true) {
                        _c = cursor_1_1.value;
                        _d = false;
                        const job = _c;
                        const response = (0, jobResponseService_1.toJobResponse)(job);
                        const slug = (0, inputSanitizers_1.readString)(response.slug, 220);
                        if (!slug)
                            continue;
                        const sitemapLastModified = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.updatedAt, 80)
                            || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.publishedAt, 80)
                            || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.createdAt, 80)
                            || null;
                        yield writeXmlChunk(stream, buildSitemapUrlEntry({
                            loc: `${AURA_PUBLIC_WEB_BASE_URL}/jobs/${encodeURIComponent(slug)}`,
                            lastmod: sitemapLastModified,
                            changefreq: 'hourly',
                            priority: '0.8',
                        }));
                    }
                }
                catch (e_1_1) { e_1 = { error: e_1_1 }; }
                finally {
                    try {
                        if (!_d && !_a && (_b = cursor_1.return)) yield _b.call(cursor_1);
                    }
                    finally { if (e_1) throw e_1.error; }
                }
            }
            finally {
                yield cursor.close().catch(() => undefined);
            }
        }
        yield writeXmlChunk(stream, '</urlset>');
        stream.end();
        yield (0, events_1.once)(stream, 'finish');
        yield fs_1.promises.rename(tempPath, finalPath);
        return finalPath;
    }
    catch (error) {
        stream.destroy();
        yield removeFile(tempPath);
        throw error;
    }
});
const invalidateJobsSitemapCache = () => __awaiter(void 0, void 0, void 0, function* () {
    const filePaths = Array.from(sitemapCache.values()).map((entry) => entry.filePath);
    sitemapCache.clear();
    pendingSitemapBuilds.clear();
    yield Promise.all(filePaths.map((filePath) => removeFile(filePath)));
});
exports.invalidateJobsSitemapCache = invalidateJobsSitemapCache;
const readJobsSitemapFilePath = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (limit = DEFAULT_SITEMAP_MAX_URLS) { return readCachedSitemapPath(normalizeSitemapLimit(limit), true); });
exports.readJobsSitemapFilePath = readJobsSitemapFilePath;
const refreshJobsSitemapCache = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (limit = DEFAULT_SITEMAP_MAX_URLS) {
    const normalizedLimit = normalizeSitemapLimit(limit);
    const freshCached = yield readCachedSitemapPath(normalizedLimit);
    if (freshCached)
        return freshCached;
    const existingBuild = pendingSitemapBuilds.get(normalizedLimit);
    if (existingBuild)
        return existingBuild;
    const nextBuild = buildJobsSitemapFile(normalizedLimit)
        .then((filePath) => storeCachedSitemap(normalizedLimit, filePath))
        .finally(() => {
        pendingSitemapBuilds.delete(normalizedLimit);
    });
    pendingSitemapBuilds.set(normalizedLimit, nextBuild);
    return nextBuild;
});
exports.refreshJobsSitemapCache = refreshJobsSitemapCache;
const createJobsSitemapReadStream = (filePath) => (0, fs_1.createReadStream)(filePath, { encoding: 'utf8' });
exports.createJobsSitemapReadStream = createJobsSitemapReadStream;
