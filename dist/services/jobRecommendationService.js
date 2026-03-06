"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobRecommendationScore = exports.buildRecommendationCandidateCriteria = exports.buildRecommendationProfile = exports.buildJobRecommendationPrecomputedFields = exports.resolveRecommendationMatchTier = exports.MATCH_TIER_GOOD_MIN_SCORE = exports.MATCH_TIER_BEST_MIN_SCORE = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const RECOMMENDATION_WEIGHTS = {
    skillPerMatch: 16,
    skillCap: 48,
    rolePerMatch: 14,
    roleCap: 28,
    remoteBonus: 18,
    workModelPreferenceBonus: 14,
    experienceDirectBonus: 10,
    experienceNearBonus: 5,
    locationBonus: 24,
    industryPerMatch: 6,
    industryCap: 12,
    salarySignalBonus: 2,
    freshnessDay1Bonus: 8,
    freshnessWeekBonus: 6,
    freshnessMonthBonus: 3,
};
const RECOMMENDATION_METADATA_CACHE_MAX_KEYS = 1500;
const RECOMMENDATION_PROFILE_CACHE_MAX_KEYS = 1000;
exports.MATCH_TIER_BEST_MIN_SCORE = 70;
exports.MATCH_TIER_GOOD_MIN_SCORE = 40;
const recommendationMetadataCache = new Map();
const recommendationProfileCache = new Map();
const resolveRecommendationMatchTier = (score) => {
    if (score >= exports.MATCH_TIER_BEST_MIN_SCORE)
        return 'best';
    if (score >= exports.MATCH_TIER_GOOD_MIN_SCORE)
        return 'good';
    return 'other';
};
exports.resolveRecommendationMatchTier = resolveRecommendationMatchTier;
const normalizeRecommendationToken = (value, maxLength = 100) => {
    const normalized = (0, inputSanitizers_1.readString)(String(value || ''), maxLength)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9+.#\-/\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized;
};
const tokenizeRecommendationText = (value, maxTokens = 120) => {
    const normalized = normalizeRecommendationToken(value, 800);
    if (!normalized)
        return [];
    return normalized
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .slice(0, maxTokens);
};
const readRecommendationSkillTokens = (value, maxItems = 80) => {
    if (!Array.isArray(value))
        return [];
    const dedupe = new Set();
    const next = [];
    for (const item of value) {
        const normalized = normalizeRecommendationToken(item, 80);
        if (!normalized || dedupe.has(normalized))
            continue;
        dedupe.add(normalized);
        next.push(normalized);
        if (next.length >= maxItems)
            break;
    }
    return next;
};
const readRecommendationTokenArray = (value, maxItems = 320) => {
    if (!Array.isArray(value))
        return [];
    const dedupe = new Set();
    const next = [];
    for (const item of value) {
        const normalized = normalizeRecommendationToken(item, 120);
        if (!normalized || dedupe.has(normalized))
            continue;
        dedupe.add(normalized);
        next.push(normalized);
        if (next.length >= maxItems)
            break;
    }
    return next;
};
const readRecommendationSkillLabelMap = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return new Map();
    }
    const next = new Map();
    for (const [rawToken, rawLabel] of Object.entries(value)) {
        const token = normalizeRecommendationToken(rawToken, 120);
        const label = (0, inputSanitizers_1.readString)(rawLabel, 120);
        if (!token || !label || next.has(token))
            continue;
        next.set(token, label);
    }
    return next;
};
const normalizeWorkModelPreference = (value) => {
    const normalized = (0, inputSanitizers_1.readString)(value, 40).toLowerCase();
    if (normalized === 'remote')
        return 'remote';
    if (normalized === 'hybrid')
        return 'hybrid';
    if (normalized === 'onsite' || normalized === 'on_site' || normalized === 'on-site')
        return 'onsite';
    return null;
};
const readPreferredWorkModels = (user) => {
    const candidates = [];
    const listFields = [
        user === null || user === void 0 ? void 0 : user.preferredWorkModels,
        user === null || user === void 0 ? void 0 : user.workPreferences,
        user === null || user === void 0 ? void 0 : user.jobWorkModels,
    ];
    for (const field of listFields) {
        if (!Array.isArray(field))
            continue;
        candidates.push(...field);
    }
    candidates.push(user === null || user === void 0 ? void 0 : user.preferredWorkModel, user === null || user === void 0 ? void 0 : user.workPreference, user === null || user === void 0 ? void 0 : user.remotePreference);
    const next = new Set();
    for (const value of candidates) {
        const normalized = normalizeWorkModelPreference(value);
        if (normalized)
            next.add(normalized);
    }
    return next;
};
const parseFiniteNumber = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return null;
    return parsed;
};
const normalizeExperienceLevel = (value) => {
    const normalized = (0, inputSanitizers_1.readString)(value, 60).toLowerCase();
    if (!normalized)
        return null;
    if (normalized.includes('lead')
        || normalized.includes('principal')
        || normalized.includes('staff')
        || normalized.includes('director')
        || normalized.includes('vp')) {
        return 'lead';
    }
    if (normalized.includes('senior') || normalized === 'sr' || normalized.startsWith('sr ')) {
        return 'senior';
    }
    if (normalized.includes('mid') || normalized.includes('intermediate')) {
        return 'mid';
    }
    if (normalized.includes('junior')
        || normalized.includes('entry')
        || normalized.includes('graduate')
        || normalized.includes('intern')) {
        return 'junior';
    }
    return null;
};
const inferExperienceLevelFromYears = (years) => {
    if (years == null || years < 0)
        return null;
    if (years <= 2)
        return 'junior';
    if (years <= 5)
        return 'mid';
    if (years <= 9)
        return 'senior';
    return 'lead';
};
const resolveExperienceLevel = (user) => {
    var _a, _b;
    const explicit = normalizeExperienceLevel((user === null || user === void 0 ? void 0 : user.experienceLevel)
        || (user === null || user === void 0 ? void 0 : user.seniority)
        || (user === null || user === void 0 ? void 0 : user.roleLevel)
        || (user === null || user === void 0 ? void 0 : user.jobSeniorityPreference));
    if (explicit)
        return explicit;
    const years = parseFiniteNumber((_b = (_a = user === null || user === void 0 ? void 0 : user.yearsOfExperience) !== null && _a !== void 0 ? _a : user === null || user === void 0 ? void 0 : user.experienceYears) !== null && _b !== void 0 ? _b : user === null || user === void 0 ? void 0 : user.totalExperienceYears);
    return inferExperienceLevelFromYears(years);
};
const inferJobExperienceLevel = (job) => {
    const semanticText = normalizeRecommendationToken(`${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 120)} ${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.summary, 220)} ${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.description, 1200)}`, 1800);
    if (!semanticText)
        return null;
    if (/\b(principal|staff|head|director|vp|lead)\b/.test(semanticText)) {
        return 'lead';
    }
    if (/\b(senior|sr)\b/.test(semanticText)) {
        return 'senior';
    }
    if (/\b(mid|intermediate)\b/.test(semanticText)) {
        return 'mid';
    }
    if (/\b(junior|entry level|entry-level|graduate|intern)\b/.test(semanticText)) {
        return 'junior';
    }
    return null;
};
const countSetIntersection = (source, target) => {
    if (source.size === 0 || target.size === 0)
        return 0;
    let count = 0;
    for (const token of source) {
        if (target.has(token))
            count += 1;
    }
    return count;
};
const buildRecommendationSkillMap = (job) => {
    let skillLabelByToken = readRecommendationSkillLabelMap(job === null || job === void 0 ? void 0 : job.recommendationSkillLabelByToken);
    if (skillLabelByToken.size === 0) {
        skillLabelByToken = new Map();
        for (const tag of Array.isArray(job === null || job === void 0 ? void 0 : job.tags) ? job.tags : []) {
            const label = (0, inputSanitizers_1.readString)(tag, 80);
            const normalized = normalizeRecommendationToken(label, 80);
            if (!label || !normalized || skillLabelByToken.has(normalized))
                continue;
            skillLabelByToken.set(normalized, label);
        }
    }
    return skillLabelByToken;
};
const buildRecommendationLocationTokens = (job) => {
    const storedLocationTokens = readRecommendationTokenArray(job === null || job === void 0 ? void 0 : job.recommendationLocationTokens, 40);
    return new Set(storedLocationTokens.length > 0
        ? storedLocationTokens
        : tokenizeRecommendationText(job === null || job === void 0 ? void 0 : job.locationText, 20).filter((token) => token.length >= 3));
};
const buildRecommendationSemanticTokens = (job) => {
    const storedSemanticTokens = readRecommendationTokenArray(job === null || job === void 0 ? void 0 : job.recommendationSemanticTokens, 320);
    return new Set(storedSemanticTokens.length > 0
        ? storedSemanticTokens
        : tokenizeRecommendationText(`${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 120)} ${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.summary, 220)} ${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.description, 1200)}`, 260).filter((token) => token.length >= 3));
};
const resolveRecommendationPublishedTs = (job) => {
    const storedPublishedTs = Number(job === null || job === void 0 ? void 0 : job.recommendationPublishedTs);
    const publishedAtRaw = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.publishedAt, 80) || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.createdAt, 80);
    const publishedAtTs = publishedAtRaw ? new Date(publishedAtRaw).getTime() : 0;
    return Number.isFinite(storedPublishedTs)
        ? storedPublishedTs
        : (Number.isFinite(publishedAtTs) ? publishedAtTs : 0);
};
const resolveRecommendationHasSalarySignal = (job) => {
    const storedHasSalarySignal = job === null || job === void 0 ? void 0 : job.recommendationHasSalarySignal;
    return typeof storedHasSalarySignal === 'boolean'
        ? storedHasSalarySignal
        : (typeof (job === null || job === void 0 ? void 0 : job.salaryMin) === 'number' || typeof (job === null || job === void 0 ? void 0 : job.salaryMax) === 'number');
};
const resolveRecommendationIsRemoteRole = (job) => {
    const storedIsRemoteRole = job === null || job === void 0 ? void 0 : job.recommendationIsRemoteRole;
    return typeof storedIsRemoteRole === 'boolean'
        ? storedIsRemoteRole
        : (String((job === null || job === void 0 ? void 0 : job.workModel) || '').toLowerCase() === 'remote');
};
const buildRecommendationMetadataCacheKey = (job) => {
    const jobId = typeof (job === null || job === void 0 ? void 0 : job.id) === 'string' ? job.id.trim() : '';
    if (!jobId)
        return '';
    const versionStamp = [
        typeof (job === null || job === void 0 ? void 0 : job.updatedAt) === 'string' ? job.updatedAt.trim() : '',
        typeof (job === null || job === void 0 ? void 0 : job.publishedAt) === 'string' ? job.publishedAt.trim() : '',
        typeof (job === null || job === void 0 ? void 0 : job.createdAt) === 'string' ? job.createdAt.trim() : '',
    ].find((value) => value.length > 0);
    if (!versionStamp)
        return '';
    return `job-id=${jobId}::version=${versionStamp}`;
};
const buildRecommendationProfileCacheKey = (user) => {
    const userId = typeof (user === null || user === void 0 ? void 0 : user.id) === 'string' ? user.id.trim() : '';
    if (!userId)
        return '';
    const versionStamp = [
        typeof (user === null || user === void 0 ? void 0 : user.updatedAt) === 'string' ? user.updatedAt.trim() : '',
        typeof (user === null || user === void 0 ? void 0 : user.createdAt) === 'string' ? user.createdAt.trim() : '',
    ].find((value) => value.length > 0) || 'profile-static';
    return `user-id=${userId}::version=${versionStamp}`;
};
const storeRecommendationMetadataCacheEntry = (cacheKey, metadata) => {
    if (!cacheKey)
        return;
    recommendationMetadataCache.delete(cacheKey);
    recommendationMetadataCache.set(cacheKey, metadata);
    if (recommendationMetadataCache.size > RECOMMENDATION_METADATA_CACHE_MAX_KEYS) {
        const oldestCacheKey = recommendationMetadataCache.keys().next().value;
        if (oldestCacheKey) {
            recommendationMetadataCache.delete(oldestCacheKey);
        }
    }
};
const storeRecommendationProfileCacheEntry = (cacheKey, profile) => {
    if (!cacheKey)
        return;
    recommendationProfileCache.delete(cacheKey);
    recommendationProfileCache.set(cacheKey, profile);
    if (recommendationProfileCache.size > RECOMMENDATION_PROFILE_CACHE_MAX_KEYS) {
        const oldestCacheKey = recommendationProfileCache.keys().next().value;
        if (oldestCacheKey) {
            recommendationProfileCache.delete(oldestCacheKey);
        }
    }
};
const buildJobRecommendationMetadata = (job) => {
    const cacheKey = buildRecommendationMetadataCacheKey(job);
    const cachedMetadata = cacheKey ? recommendationMetadataCache.get(cacheKey) : undefined;
    if (cachedMetadata) {
        recommendationMetadataCache.delete(cacheKey);
        recommendationMetadataCache.set(cacheKey, cachedMetadata);
        return cachedMetadata;
    }
    const skillLabelByToken = buildRecommendationSkillMap(job);
    const locationTokens = buildRecommendationLocationTokens(job);
    const semanticTokens = buildRecommendationSemanticTokens(job);
    const publishedTs = resolveRecommendationPublishedTs(job);
    const hasSalarySignal = resolveRecommendationHasSalarySignal(job);
    const isRemoteRole = resolveRecommendationIsRemoteRole(job);
    const workModel = normalizeWorkModelPreference(job === null || job === void 0 ? void 0 : job.workModel) || (isRemoteRole ? 'remote' : 'onsite');
    const inferredExperienceLevel = inferJobExperienceLevel(job);
    const metadata = {
        skillLabelByToken,
        locationTokens,
        semanticTokens,
        publishedTs,
        hasSalarySignal,
        isRemoteRole,
        workModel,
        inferredExperienceLevel,
    };
    storeRecommendationMetadataCacheEntry(cacheKey, metadata);
    return metadata;
};
const buildJobRecommendationPrecomputedFields = (source) => {
    const recommendationSkillLabelByToken = {};
    for (const tag of Array.isArray(source === null || source === void 0 ? void 0 : source.tags) ? source.tags : []) {
        const label = (0, inputSanitizers_1.readString)(tag, 80);
        const normalized = normalizeRecommendationToken(label, 80);
        if (!label || !normalized || recommendationSkillLabelByToken[normalized])
            continue;
        recommendationSkillLabelByToken[normalized] = label;
    }
    const recommendationLocationTokens = tokenizeRecommendationText(source === null || source === void 0 ? void 0 : source.locationText, 20)
        .filter((token) => token.length >= 3)
        .slice(0, 40);
    const semanticText = `${(0, inputSanitizers_1.readString)(source === null || source === void 0 ? void 0 : source.title, 120)} ${(0, inputSanitizers_1.readString)(source === null || source === void 0 ? void 0 : source.summary, 220)} ${(0, inputSanitizers_1.readString)(source === null || source === void 0 ? void 0 : source.description, 1200)}`;
    const recommendationSemanticTokens = tokenizeRecommendationText(semanticText, 260)
        .filter((token) => token.length >= 3)
        .slice(0, 320);
    const publishedAtRaw = (0, inputSanitizers_1.readString)(source === null || source === void 0 ? void 0 : source.publishedAt, 80) || (0, inputSanitizers_1.readString)(source === null || source === void 0 ? void 0 : source.createdAt, 80);
    const publishedAtTs = publishedAtRaw ? new Date(publishedAtRaw).getTime() : 0;
    const recommendationPublishedTs = Number.isFinite(publishedAtTs) ? publishedAtTs : 0;
    return {
        recommendationSkillLabelByToken,
        recommendationLocationTokens,
        recommendationSemanticTokens,
        recommendationPublishedTs,
        recommendationHasSalarySignal: typeof (source === null || source === void 0 ? void 0 : source.salaryMin) === 'number' || typeof (source === null || source === void 0 ? void 0 : source.salaryMax) === 'number',
        recommendationIsRemoteRole: String((source === null || source === void 0 ? void 0 : source.workModel) || '').toLowerCase() === 'remote',
    };
};
exports.buildJobRecommendationPrecomputedFields = buildJobRecommendationPrecomputedFields;
const buildRecommendationProfile = (user) => {
    const cacheKey = buildRecommendationProfileCacheKey(user);
    const cachedProfile = cacheKey ? recommendationProfileCache.get(cacheKey) : undefined;
    if (cachedProfile) {
        recommendationProfileCache.delete(cacheKey);
        recommendationProfileCache.set(cacheKey, cachedProfile);
        return cachedProfile;
    }
    const skillTokens = new Set([
        ...readRecommendationSkillTokens(user === null || user === void 0 ? void 0 : user.skills, 80),
        ...readRecommendationSkillTokens(user === null || user === void 0 ? void 0 : user.profileSkills, 80),
    ]);
    const roleTokens = new Set(tokenizeRecommendationText((user === null || user === void 0 ? void 0 : user.title)
        || (user === null || user === void 0 ? void 0 : user.role)
        || (user === null || user === void 0 ? void 0 : user.desiredRole)
        || (user === null || user === void 0 ? void 0 : user.jobTitle), 20).filter((token) => token.length >= 3));
    const locationTokens = new Set([
        ...tokenizeRecommendationText(user === null || user === void 0 ? void 0 : user.location, 20).filter((token) => token.length >= 3),
        ...tokenizeRecommendationText(user === null || user === void 0 ? void 0 : user.country, 8).filter((token) => token.length >= 3),
    ]);
    const industryTokens = new Set(tokenizeRecommendationText(user === null || user === void 0 ? void 0 : user.industry, 20).filter((token) => token.length >= 3));
    const preferredWorkModels = readPreferredWorkModels(user);
    const experienceLevel = resolveExperienceLevel(user);
    const profile = {
        skillTokens,
        roleTokens,
        locationTokens,
        industryTokens,
        preferredWorkModels,
        experienceLevel,
    };
    storeRecommendationProfileCacheEntry(cacheKey, profile);
    return profile;
};
exports.buildRecommendationProfile = buildRecommendationProfile;
const buildRecommendationCandidateCriteria = (profile) => {
    const skillTokens = Array.from(profile.skillTokens).slice(0, 20);
    const semanticTokens = Array.from(new Set([
        ...Array.from(profile.roleTokens),
        ...Array.from(profile.industryTokens),
    ])).slice(0, 16);
    const preferredWorkModels = Array.from(profile.preferredWorkModels);
    return {
        status: 'open',
        skillTokens,
        semanticTokens,
        preferredWorkModels,
    };
};
exports.buildRecommendationCandidateCriteria = buildRecommendationCandidateCriteria;
const scoreSkillMatch = (metadata, profile) => {
    const matchedSkills = [];
    for (const [token, label] of metadata.skillLabelByToken.entries()) {
        if (profile.skillTokens.has(token))
            matchedSkills.push(label);
    }
    if (matchedSkills.length === 0) {
        return { score: 0, matchedSkills };
    }
    return {
        score: Math.min(RECOMMENDATION_WEIGHTS.skillCap, matchedSkills.length * RECOMMENDATION_WEIGHTS.skillPerMatch),
        matchedSkills,
        reason: `${matchedSkills.length} skill match${matchedSkills.length === 1 ? '' : 'es'}`,
    };
};
const scoreRoleAlignment = (metadata, profile) => {
    if (profile.roleTokens.size === 0)
        return { score: 0 };
    const roleMatchCount = countSetIntersection(profile.roleTokens, metadata.semanticTokens);
    if (roleMatchCount === 0)
        return { score: 0 };
    return {
        score: Math.min(RECOMMENDATION_WEIGHTS.roleCap, roleMatchCount * RECOMMENDATION_WEIGHTS.rolePerMatch),
        reason: 'Role fit aligned',
    };
};
const scoreRemoteRole = (metadata, profile) => {
    if (!metadata.isRemoteRole)
        return { score: 0 };
    if (profile.preferredWorkModels.size > 0
        && !profile.preferredWorkModels.has('remote')) {
        return { score: 0 };
    }
    return {
        score: RECOMMENDATION_WEIGHTS.remoteBonus,
        reason: 'Remote role',
    };
};
const scoreWorkModelPreference = (metadata, profile) => {
    if (profile.preferredWorkModels.size === 0)
        return { score: 0 };
    if (!profile.preferredWorkModels.has(metadata.workModel))
        return { score: 0 };
    return {
        score: RECOMMENDATION_WEIGHTS.workModelPreferenceBonus,
        reason: 'Work model preference matched',
    };
};
const scoreLocationAlignment = (metadata, profile) => {
    const locationMatchCount = countSetIntersection(profile.locationTokens, metadata.locationTokens);
    if (locationMatchCount === 0)
        return { score: 0 };
    return {
        score: RECOMMENDATION_WEIGHTS.locationBonus,
        reason: 'Location aligned',
    };
};
const scoreIndustryAlignment = (metadata, profile) => {
    if (profile.industryTokens.size === 0)
        return { score: 0 };
    const industryMatchCount = countSetIntersection(profile.industryTokens, metadata.semanticTokens);
    if (industryMatchCount === 0)
        return { score: 0 };
    return {
        score: Math.min(RECOMMENDATION_WEIGHTS.industryCap, industryMatchCount * RECOMMENDATION_WEIGHTS.industryPerMatch),
        reason: 'Industry aligned',
    };
};
const EXPERIENCE_LEVEL_INDEX = {
    junior: 0,
    mid: 1,
    senior: 2,
    lead: 3,
};
const toExperienceLevelIndex = (value) => {
    const normalized = normalizeExperienceLevel(value);
    if (!normalized)
        return null;
    return EXPERIENCE_LEVEL_INDEX[normalized];
};
const scoreExperienceAlignment = (metadata, profile) => {
    const profileIndex = toExperienceLevelIndex(profile.experienceLevel);
    const jobIndex = toExperienceLevelIndex(metadata.inferredExperienceLevel);
    if (profileIndex == null || jobIndex == null)
        return { score: 0 };
    const distance = Math.abs(profileIndex - jobIndex);
    if (distance === 0) {
        return {
            score: RECOMMENDATION_WEIGHTS.experienceDirectBonus,
            reason: 'Experience level aligned',
        };
    }
    if (distance === 1) {
        return {
            score: RECOMMENDATION_WEIGHTS.experienceNearBonus,
            reason: 'Experience level near match',
        };
    }
    return { score: 0 };
};
const scoreSalarySignal = (metadata) => metadata.hasSalarySignal ? RECOMMENDATION_WEIGHTS.salarySignalBonus : 0;
const scoreFreshness = (publishedTs) => {
    if (publishedTs <= 0)
        return 0;
    const ageDays = Math.max(0, (Date.now() - publishedTs) / (24 * 60 * 60 * 1000));
    if (ageDays <= 1)
        return RECOMMENDATION_WEIGHTS.freshnessDay1Bonus;
    if (ageDays <= 7)
        return RECOMMENDATION_WEIGHTS.freshnessWeekBonus;
    if (ageDays <= 30)
        return RECOMMENDATION_WEIGHTS.freshnessMonthBonus;
    return 0;
};
const runRecommendationSignals = (signalRuns) => {
    const reasons = [];
    let matchedSkills = [];
    const breakdown = {
        skills: 0,
        role: 0,
        remote: 0,
        workModel: 0,
        location: 0,
        experience: 0,
        industry: 0,
        salarySignal: 0,
        freshness: 0,
    };
    for (const signalRun of signalRuns) {
        const result = signalRun.signal();
        breakdown[signalRun.key] = result.score;
        if (result.reason)
            reasons.push(result.reason);
        if (result.matchedSkills && result.matchedSkills.length > 0) {
            matchedSkills = result.matchedSkills;
        }
    }
    return {
        score: Object.values(breakdown).reduce((total, value) => total + value, 0),
        reasons,
        matchedSkills,
        breakdown,
    };
};
const buildJobRecommendationScore = (job, profile) => {
    const metadata = buildJobRecommendationMetadata(job);
    const publishedTs = metadata.publishedTs;
    const scoredSignals = runRecommendationSignals([
        {
            key: 'skills',
            signal: () => scoreSkillMatch(metadata, profile),
        },
        {
            key: 'role',
            signal: () => scoreRoleAlignment(metadata, profile),
        },
        {
            key: 'remote',
            signal: () => scoreRemoteRole(metadata, profile),
        },
        {
            key: 'workModel',
            signal: () => scoreWorkModelPreference(metadata, profile),
        },
        {
            key: 'location',
            signal: () => scoreLocationAlignment(metadata, profile),
        },
        {
            key: 'experience',
            signal: () => scoreExperienceAlignment(metadata, profile),
        },
        {
            key: 'industry',
            signal: () => scoreIndustryAlignment(metadata, profile),
        },
        {
            key: 'salarySignal',
            signal: () => ({ score: scoreSalarySignal(metadata) }),
        },
        {
            key: 'freshness',
            signal: () => ({ score: scoreFreshness(publishedTs) }),
        },
    ]);
    return {
        score: scoredSignals.score,
        reasons: scoredSignals.reasons,
        matchedSkills: scoredSignals.matchedSkills,
        publishedTs,
        breakdown: scoredSignals.breakdown,
    };
};
exports.buildJobRecommendationScore = buildJobRecommendationScore;
