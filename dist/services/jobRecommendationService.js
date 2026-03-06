"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobRecommendationScore = exports.buildRecommendationCandidateFilter = exports.buildRecommendationProfile = exports.buildJobRecommendationPrecomputedFields = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const RECOMMENDATION_WEIGHTS = {
    skillPerMatch: 16,
    skillCap: 48,
    remoteBonus: 18,
    locationBonus: 24,
    industryPerMatch: 6,
    industryCap: 12,
    salarySignalBonus: 2,
    freshnessDay1Bonus: 8,
    freshnessWeekBonus: 6,
    freshnessMonthBonus: 3,
};
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
const buildJobRecommendationMetadata = (job) => {
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
    const storedLocationTokens = readRecommendationTokenArray(job === null || job === void 0 ? void 0 : job.recommendationLocationTokens, 40);
    const locationTokens = new Set(storedLocationTokens.length > 0
        ? storedLocationTokens
        : tokenizeRecommendationText(job === null || job === void 0 ? void 0 : job.locationText, 20).filter((token) => token.length >= 3));
    const storedSemanticTokens = readRecommendationTokenArray(job === null || job === void 0 ? void 0 : job.recommendationSemanticTokens, 320);
    const semanticTokens = new Set(storedSemanticTokens.length > 0
        ? storedSemanticTokens
        : tokenizeRecommendationText(`${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 120)} ${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.summary, 220)} ${(0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.description, 1200)}`, 260).filter((token) => token.length >= 3));
    const storedPublishedTs = Number(job === null || job === void 0 ? void 0 : job.recommendationPublishedTs);
    const publishedAtRaw = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.publishedAt, 80) || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.createdAt, 80);
    const publishedAtTs = publishedAtRaw ? new Date(publishedAtRaw).getTime() : 0;
    const publishedTs = Number.isFinite(storedPublishedTs)
        ? storedPublishedTs
        : (Number.isFinite(publishedAtTs) ? publishedAtTs : 0);
    const storedHasSalarySignal = job === null || job === void 0 ? void 0 : job.recommendationHasSalarySignal;
    const hasSalarySignal = typeof storedHasSalarySignal === 'boolean'
        ? storedHasSalarySignal
        : (typeof (job === null || job === void 0 ? void 0 : job.salaryMin) === 'number' || typeof (job === null || job === void 0 ? void 0 : job.salaryMax) === 'number');
    const storedIsRemoteRole = job === null || job === void 0 ? void 0 : job.recommendationIsRemoteRole;
    const isRemoteRole = typeof storedIsRemoteRole === 'boolean'
        ? storedIsRemoteRole
        : (String((job === null || job === void 0 ? void 0 : job.workModel) || '').toLowerCase() === 'remote');
    return {
        skillLabelByToken,
        locationTokens,
        semanticTokens,
        publishedTs,
        hasSalarySignal,
        isRemoteRole,
    };
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
    const skillTokens = new Set([
        ...readRecommendationSkillTokens(user === null || user === void 0 ? void 0 : user.skills, 80),
        ...readRecommendationSkillTokens(user === null || user === void 0 ? void 0 : user.profileSkills, 80),
    ]);
    const locationTokens = new Set([
        ...tokenizeRecommendationText(user === null || user === void 0 ? void 0 : user.location, 20).filter((token) => token.length >= 3),
        ...tokenizeRecommendationText(user === null || user === void 0 ? void 0 : user.country, 8).filter((token) => token.length >= 3),
    ]);
    const industryTokens = new Set(tokenizeRecommendationText(user === null || user === void 0 ? void 0 : user.industry, 20).filter((token) => token.length >= 3));
    return {
        skillTokens,
        locationTokens,
        industryTokens,
    };
};
exports.buildRecommendationProfile = buildRecommendationProfile;
const buildRecommendationCandidateFilter = (profile) => {
    const skillTokens = Array.from(profile.skillTokens).slice(0, 20);
    const orFilters = [];
    if (skillTokens.length > 0) {
        orFilters.push({ tags: { $in: skillTokens } });
    }
    if (orFilters.length === 0) {
        return { status: 'open' };
    }
    return {
        status: 'open',
        $or: orFilters,
    };
};
exports.buildRecommendationCandidateFilter = buildRecommendationCandidateFilter;
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
const scoreRemoteRole = (metadata) => {
    if (!metadata.isRemoteRole)
        return { score: 0 };
    return {
        score: RECOMMENDATION_WEIGHTS.remoteBonus,
        reason: 'Remote role',
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
const buildJobRecommendationScore = (job, profile) => {
    const reasons = [];
    let score = 0;
    const metadata = buildJobRecommendationMetadata(job);
    const skillSignal = scoreSkillMatch(metadata, profile);
    if (skillSignal.score > 0) {
        score += skillSignal.score;
        if (skillSignal.reason)
            reasons.push(skillSignal.reason);
    }
    const remoteSignal = scoreRemoteRole(metadata);
    if (remoteSignal.score > 0) {
        score += remoteSignal.score;
        if (remoteSignal.reason)
            reasons.push(remoteSignal.reason);
    }
    const locationSignal = scoreLocationAlignment(metadata, profile);
    if (locationSignal.score > 0) {
        score += locationSignal.score;
        if (locationSignal.reason)
            reasons.push(locationSignal.reason);
    }
    const industrySignal = scoreIndustryAlignment(metadata, profile);
    if (industrySignal.score > 0) {
        score += industrySignal.score;
        if (industrySignal.reason)
            reasons.push(industrySignal.reason);
    }
    score += scoreSalarySignal(metadata);
    const publishedTs = metadata.publishedTs;
    score += scoreFreshness(publishedTs);
    return {
        score,
        reasons,
        matchedSkills: skillSignal.matchedSkills,
        publishedTs,
    };
};
exports.buildJobRecommendationScore = buildJobRecommendationScore;
