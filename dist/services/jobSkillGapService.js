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
exports.buildJobSkillGap = void 0;
const crypto_1 = __importDefault(require("crypto"));
const LEARNING_RESOURCES_COLLECTION = 'learning_resources';
const LEARNING_RESOURCES_CACHE_COLLECTION = 'learning_resources_cache';
const LEARNING_RESOURCES_CACHE_TTL_MS = 5 * 60 * 1000;
const JOB_SKILL_METADATA_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_JOB_SKILL_METADATA_CACHE_ENTRIES = 400;
const JOB_SKILL_METADATA_CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const jobSkillMetadataCache = new Map();
const cleanupExpiredJobSkillMetadataCache = (nowTs = Date.now()) => {
    for (const [cacheKey, cacheRow] of jobSkillMetadataCache.entries()) {
        if (cacheRow.expiresAt < nowTs) {
            jobSkillMetadataCache.delete(cacheKey);
        }
    }
};
const jobSkillMetadataCleanupTimer = setInterval(() => cleanupExpiredJobSkillMetadataCache(), JOB_SKILL_METADATA_CACHE_CLEANUP_INTERVAL_MS);
if (typeof (jobSkillMetadataCleanupTimer === null || jobSkillMetadataCleanupTimer === void 0 ? void 0 : jobSkillMetadataCleanupTimer.unref) === 'function') {
    jobSkillMetadataCleanupTimer.unref();
}
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const readStringOrNull = (value, maxLength = 10000) => {
    const normalized = readString(value, maxLength);
    return normalized.length > 0 ? normalized : null;
};
const normalizeExternalUrl = (value) => {
    const raw = readString(String(value || ''), 600);
    if (!raw)
        return null;
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const parsed = new URL(withProtocol);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return null;
        return parsed.toString();
    }
    catch (_a) {
        return null;
    }
};
const normalizeSkillToken = (value) => {
    const base = readString(String(value || ''), 80)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (!base)
        return '';
    return base.replace(/[^a-z0-9+.#\-/\s]/g, '').replace(/\s+/g, ' ').trim();
};
const readSkillArray = (value, maxItems = 60) => {
    if (!Array.isArray(value))
        return [];
    const dedupe = new Set();
    const next = [];
    for (const item of value) {
        const normalized = normalizeSkillToken(item);
        if (!normalized || dedupe.has(normalized))
            continue;
        dedupe.add(normalized);
        next.push(normalized);
        if (next.length >= maxItems)
            break;
    }
    return next;
};
const toLearningResourceResponse = (resource, skillLabelByToken) => {
    if (!resource || typeof resource !== 'object')
        return null;
    const url = normalizeExternalUrl(resource.url);
    const title = readString(resource.title, 180);
    if (!url || !title)
        return null;
    const provider = readString(resource.provider, 120) || 'Learning Platform';
    const normalizedSkill = normalizeSkillToken(resource.skill);
    const skill = normalizedSkill
        ? (skillLabelByToken.get(normalizedSkill) || normalizedSkill)
        : 'general';
    return {
        id: readString(resource.id, 140) || `learning-${crypto_1.default.randomBytes(4).toString('hex')}`,
        skill,
        title,
        provider,
        url,
        level: readStringOrNull(resource.level, 80),
        duration: readStringOrNull(resource.duration, 80),
        source: 'db',
    };
};
const buildFallbackLearningResources = (missingSkills) => missingSkills.slice(0, 4).map((skill) => ({
    id: `learning-fallback-${normalizeSkillToken(skill) || crypto_1.default.randomBytes(4).toString('hex')}`,
    skill,
    title: `Learn ${skill}`,
    provider: 'Coursera',
    url: `https://www.coursera.org/search?query=${encodeURIComponent(skill)}`,
    source: 'fallback',
}));
const buildJobSkillMetadata = (job) => {
    const jobSkills = Array.isArray(job === null || job === void 0 ? void 0 : job.tags)
        ? Array.from(new Set(job.tags
            .map((tag) => readString(tag, 80))
            .filter((tag) => tag.length > 0))).slice(0, 60)
        : [];
    const skillLabelByToken = new Map();
    for (const skill of jobSkills) {
        const normalized = normalizeSkillToken(skill);
        if (!normalized || skillLabelByToken.has(normalized))
            continue;
        skillLabelByToken.set(normalized, skill);
    }
    return { jobSkills, skillLabelByToken };
};
const getJobSkillMetadataCacheKey = (job) => {
    const jobId = readString(job === null || job === void 0 ? void 0 : job.id, 120) || 'unknown-job';
    const version = readString(job === null || job === void 0 ? void 0 : job.updatedAt, 80) || readString(job === null || job === void 0 ? void 0 : job.publishedAt, 80) || '';
    return `${jobId}|${version}`;
};
const getJobSkillMetadata = (job) => {
    const key = getJobSkillMetadataCacheKey(job);
    const now = Date.now();
    const cached = jobSkillMetadataCache.get(key);
    if (cached && cached.expiresAt >= now) {
        return cached.metadata;
    }
    const metadata = buildJobSkillMetadata(job);
    cleanupExpiredJobSkillMetadataCache(now);
    while (jobSkillMetadataCache.size >= MAX_JOB_SKILL_METADATA_CACHE_ENTRIES) {
        const oldestKey = jobSkillMetadataCache.keys().next().value;
        if (!oldestKey)
            break;
        jobSkillMetadataCache.delete(oldestKey);
    }
    jobSkillMetadataCache.set(key, {
        expiresAt: now + JOB_SKILL_METADATA_CACHE_TTL_MS,
        metadata,
    });
    return metadata;
};
const buildSkillMatch = (job, userSkillSet) => {
    const metadata = getJobSkillMetadata(job);
    const { jobSkills, skillLabelByToken } = metadata;
    const matchedSkills = [];
    const missingSkills = [];
    for (const [normalized, displayLabel] of skillLabelByToken.entries()) {
        if (userSkillSet.has(normalized)) {
            matchedSkills.push(displayLabel);
        }
        else {
            missingSkills.push(displayLabel);
        }
    }
    return {
        jobSkills,
        matchedSkills,
        missingSkills,
        skillLabelByToken,
    };
};
const resolveViewerSkillSet = (viewer) => {
    const viewerSkills = new Set([
        ...readSkillArray(viewer === null || viewer === void 0 ? void 0 : viewer.skills, 80),
        ...readSkillArray(viewer === null || viewer === void 0 ? void 0 : viewer.profileSkills, 80),
    ]);
    return viewerSkills.size > 0 ? viewerSkills : null;
};
const toMissingSkillTokens = (missingSkills) => missingSkills
    .map((skill) => normalizeSkillToken(skill))
    .filter((token) => token.length > 0);
const createMongoLearningResourceGateway = (db) => ({
    readCache: (cacheKey, now, signal) => __awaiter(void 0, void 0, void 0, function* () {
        const cachedDoc = yield db.collection(LEARNING_RESOURCES_CACHE_COLLECTION).findOne({
            cacheKey,
            expiresAt: { $gt: now },
        }, {
            projection: { rows: 1 },
            signal,
        });
        if (!Array.isArray(cachedDoc === null || cachedDoc === void 0 ? void 0 : cachedDoc.rows))
            return null;
        return cachedDoc.rows;
    }),
    queryResources: (missingSkillTokens, signal) => __awaiter(void 0, void 0, void 0, function* () {
        return yield db.collection(LEARNING_RESOURCES_COLLECTION)
            .find({
            $or: [
                { skill: { $in: missingSkillTokens } },
                { skills: { $in: missingSkillTokens } },
            ],
        }, { signal })
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(20)
            .toArray();
    }),
    writeCache: (cacheKey, rows, now, signal) => __awaiter(void 0, void 0, void 0, function* () {
        yield db.collection(LEARNING_RESOURCES_CACHE_COLLECTION).updateOne({ cacheKey }, {
            $set: {
                cacheKey,
                rows,
                expiresAt: new Date(Date.now() + LEARNING_RESOURCES_CACHE_TTL_MS),
                updatedAt: now.toISOString(),
            },
            $setOnInsert: {
                createdAt: now.toISOString(),
            },
        }, { upsert: true, signal });
    }),
});
const transformLearningResourceRows = (resourceRows, skillLabelByToken) => {
    const dedupeByUrl = new Set();
    const transformedRows = [];
    for (const row of resourceRows) {
        const transformed = toLearningResourceResponse(row, skillLabelByToken);
        if (!transformed)
            continue;
        if (dedupeByUrl.has(transformed.url))
            continue;
        dedupeByUrl.add(transformed.url);
        transformedRows.push(transformed);
        if (transformedRows.length >= 8)
            break;
    }
    return transformedRows;
};
const fetchLearningResourcesByMissingSkills = (gateway, missingSkills, skillLabelByToken, signal) => __awaiter(void 0, void 0, void 0, function* () {
    const missingSkillTokens = toMissingSkillTokens(missingSkills);
    if (missingSkillTokens.length === 0)
        return [];
    const cacheKey = missingSkillTokens.slice().sort().join('|');
    const now = new Date();
    const cachedRows = yield gateway.readCache(cacheKey, now, signal);
    if (cachedRows && cachedRows.length > 0) {
        return cachedRows;
    }
    const resourceRows = yield gateway.queryResources(missingSkillTokens, signal);
    const learningResources = transformLearningResourceRows(resourceRows, skillLabelByToken);
    const finalRows = learningResources.length > 0
        ? learningResources
        : buildFallbackLearningResources(missingSkills);
    try {
        yield gateway.writeCache(cacheKey, finalRows, now, signal);
    }
    catch (_a) {
        // Cache write failures should not block skill-gap response generation.
    }
    return finalRows;
});
const buildJobSkillGap = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const { db, currentUserId, viewer, job, signal } = params;
    const userId = readString(currentUserId, 120);
    if (!userId)
        return null;
    const userSkillSet = resolveViewerSkillSet(viewer);
    if (!userSkillSet || !job || typeof job !== 'object')
        return null;
    const skillMatch = buildSkillMatch(job, userSkillSet);
    const gateway = createMongoLearningResourceGateway(db);
    const learningResources = yield fetchLearningResourcesByMissingSkills(gateway, skillMatch.missingSkills, skillMatch.skillLabelByToken, signal);
    return {
        userSkills: Array.from(userSkillSet),
        jobSkills: skillMatch.jobSkills,
        matchedSkills: skillMatch.matchedSkills,
        missingSkills: skillMatch.missingSkills,
        learningResources,
    };
});
exports.buildJobSkillGap = buildJobSkillGap;
