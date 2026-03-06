"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobRecommendationScore = exports.buildRecommendationCandidateFilter = exports.buildRecommendationProfile = exports.buildJobRecommendationPrecomputedFields = exports.resolveRecommendationMatchTier = exports.MATCH_TIER_GOOD_MIN_SCORE = exports.MATCH_TIER_BEST_MIN_SCORE = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const RECOMMENDATION_WEIGHTS = {
    skillPerMatch: 16,
    skillCap: 48,
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
exports.MATCH_TIER_BEST_MIN_SCORE = 70;
exports.MATCH_TIER_GOOD_MIN_SCORE = 40;
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
const buildJobRecommendationMetadata = (job) => {
    const skillLabelByToken = buildRecommendationSkillMap(job);
    const locationTokens = buildRecommendationLocationTokens(job);
    const semanticTokens = buildRecommendationSemanticTokens(job);
    const publishedTs = resolveRecommendationPublishedTs(job);
    const hasSalarySignal = resolveRecommendationHasSalarySignal(job);
    const isRemoteRole = resolveRecommendationIsRemoteRole(job);
    const workModel = normalizeWorkModelPreference(job === null || job === void 0 ? void 0 : job.workModel) || (isRemoteRole ? 'remote' : 'onsite');
    const inferredExperienceLevel = inferJobExperienceLevel(job);
    return {
        skillLabelByToken,
        locationTokens,
        semanticTokens,
        publishedTs,
        hasSalarySignal,
        isRemoteRole,
        workModel,
        inferredExperienceLevel,
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
    const preferredWorkModels = readPreferredWorkModels(user);
    const experienceLevel = resolveExperienceLevel(user);
    return {
        skillTokens,
        locationTokens,
        industryTokens,
        preferredWorkModels,
        experienceLevel,
    };
};
exports.buildRecommendationProfile = buildRecommendationProfile;
const buildRecommendationCandidateFilter = (profile) => {
    const skillTokens = Array.from(profile.skillTokens).slice(0, 20);
    const preferredWorkModels = Array.from(profile.preferredWorkModels);
    const orFilters = [];
    if (skillTokens.length > 0) {
        orFilters.push({ tags: { $in: skillTokens } });
    }
    if (preferredWorkModels.length > 0) {
        orFilters.push({ workModel: { $in: preferredWorkModels } });
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
const runRecommendationSignals = (signals) => {
    const reasons = [];
    let totalScore = 0;
    let matchedSkills = [];
    for (const nextSignal of signals) {
        const signal = nextSignal();
        if (signal.score > 0) {
            totalScore += signal.score;
            if (signal.reason)
                reasons.push(signal.reason);
        }
        if (signal.matchedSkills && signal.matchedSkills.length > 0) {
            matchedSkills = signal.matchedSkills;
        }
    }
    return {
        score: totalScore,
        reasons,
        matchedSkills,
    };
};
const buildJobRecommendationScore = (job, profile) => {
    const metadata = buildJobRecommendationMetadata(job);
    const publishedTs = metadata.publishedTs;
    const scoredSignals = runRecommendationSignals([
        () => {
            const signal = scoreSkillMatch(metadata, profile);
            return {
                score: signal.score,
                reason: signal.reason,
                matchedSkills: signal.matchedSkills,
            };
        },
        () => scoreRemoteRole(metadata, profile),
        () => scoreWorkModelPreference(metadata, profile),
        () => scoreLocationAlignment(metadata, profile),
        () => scoreExperienceAlignment(metadata, profile),
        () => scoreIndustryAlignment(metadata, profile),
        () => ({ score: scoreSalarySignal(metadata) }),
        () => ({ score: scoreFreshness(publishedTs) }),
    ]);
    return {
        score: scoredSignals.score,
        reasons: scoredSignals.reasons,
        matchedSkills: scoredSignals.matchedSkills,
        publishedTs,
    };
};
exports.buildJobRecommendationScore = buildJobRecommendationScore;
