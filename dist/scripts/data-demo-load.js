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
exports.runDataDemoData = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const PRESETS = {
    small: { profiles: 25, posts: 120 },
    medium: { profiles: 150, posts: 1200 },
    large: { profiles: 600, posts: 10000 }
};
const DEFAULT_DATA_SOURCE = 'demo-data';
const COMPANY_RATIO = 0.25;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_NAMES = [
    'Aiden', 'Liam', 'Noah', 'Ethan', 'Mason', 'Lucas', 'Leo', 'Elijah',
    'Ava', 'Mia', 'Amelia', 'Sophia', 'Isla', 'Nora', 'Grace', 'Layla',
    'Danell', 'Nia', 'Zuri', 'Khaya', 'Lebo', 'Amahle', 'Sanele', 'Thabo'
];
const LAST_NAMES = [
    'Oosthuizen', 'Nkosi', 'Mokoena', 'Jacobs', 'Williams', 'Davids', 'Naidoo', 'Petersen',
    'Smith', 'Khumalo', 'Dlamini', 'Botha', 'van der Merwe', 'Meyer', 'Mthembu', 'Pillay'
];
const COUNTRIES = ['South Africa', 'Kenya', 'Nigeria', 'United States', 'United Kingdom', 'Germany', 'India', 'Brazil'];
const INDUSTRIES = ['Technology', 'Media', 'Marketing', 'Education', 'Finance', 'Healthcare', 'Retail', 'Consulting'];
const CITY_BY_COUNTRY = {
    'South Africa': ['Cape Town', 'Johannesburg', 'Durban', 'Pretoria'],
    Kenya: ['Nairobi', 'Mombasa', 'Kisumu'],
    Nigeria: ['Lagos', 'Abuja', 'Port Harcourt'],
    'United States': ['Austin', 'San Francisco', 'New York', 'Seattle'],
    'United Kingdom': ['London', 'Manchester', 'Birmingham'],
    Germany: ['Berlin', 'Munich', 'Hamburg'],
    India: ['Bengaluru', 'Mumbai', 'Hyderabad'],
    Brazil: ['Sao Paulo', 'Rio de Janeiro', 'Belo Horizonte']
};
const ENERGY_VALUES = ['⚡ High Energy', '🌿 Calm', '💡 Deep Dive', '🪐 Neutral', '💪 Motivated', '🎉 Celebrating'];
const TOPIC_TAGS = [
    '#CreatorEconomy', '#Marketing', '#Growth', '#Startups', '#AI', '#Product', '#Leadership',
    '#SaaS', '#Design', '#Community', '#Sales', '#Content', '#Brand', '#Analytics'
];
const REACTION_EMOJIS = ['🔥', '💡', '⚡', '👏', '🚀', '❤️', '🎯', '📈', '🧠'];
const HOOKS = [
    'Shipping this update changed how our team works.',
    'One lesson from this week that moved the needle.',
    'A practical framework we use in every campaign.',
    'If you are building in public, this helps.',
    'A quick operator note from the last sprint.'
];
const OUTCOMES = [
    'Result: faster execution with less back-and-forth.',
    'Result: clearer priorities and more consistent output.',
    'Result: stronger conversion quality without extra spend.',
    'Result: better retention in the first 7 days.',
    'Result: fewer blockers across product and growth.'
];
const COMPANY_WORDS = ['Signal', 'Orbit', 'Summit', 'North', 'Catalyst', 'Vertex', 'Pulse', 'Anchor', 'Studio', 'Labs'];
const AD_HEADLINES = [
    'Launch a campaign that converts without burning spend.',
    'Scale qualified pipeline with creator-native demand.',
    'Turn audience attention into measurable growth.',
    'Book higher-intent calls from your next campaign sprint.',
    'Run clean, high-signal campaigns with live performance insight.'
];
const AD_DESCRIPTIONS = [
    'Built for operators who need reliable performance, not vanity metrics. This campaign stack focuses on clear outcomes and rapid iteration.',
    'We combine creative clarity, strong positioning, and precise calls-to-action so your team can scale without guesswork.',
    'Use this campaign to drive qualified traffic, stronger conversion quality, and better visibility into what actually works.',
    'A practical campaign setup for founders and growth teams who need fast feedback loops and measurable ROI.',
    'Designed for modern teams: compact creative, precise targeting logic, and execution that compounds every week.'
];
const AD_CTA_TEXTS = ['View Case Study', 'Book a Demo', 'Get the Playbook', 'Start Now', 'See Strategy'];
const AD_CAMPAIGN_WHYS = [
    'safe_clicks_conversions',
    'lead_capture_no_exit',
    'email_growth',
    'book_more_calls',
    'gate_high_intent_downloads'
];
const AD_PLACEMENTS = ['feed', 'sidebar', 'story', 'search'];
const AD_ANALYTICS_DAYS = 14;
const nowIso = () => new Date().toISOString();
const sanitizeBatchId = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
const ensureBatchId = (value) => {
    const sanitized = sanitizeBatchId(value);
    if (!sanitized) {
        throw new Error('Invalid --batch value. Use letters, numbers, dashes, or underscores.');
    }
    return sanitized;
};
const sanitizeDataSource = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
const ensureDataSource = (value) => {
    const sanitized = sanitizeDataSource(value);
    if (!sanitized) {
        throw new Error('Invalid --source value. Use letters, numbers, dashes, or underscores.');
    }
    return sanitized;
};
const buildDefaultBatchId = (prefix, preset) => {
    const safePrefix = sanitizeBatchId(prefix) || 'demo';
    return sanitizeBatchId(`${safePrefix}-${preset}-${Date.now()}`) || `demo-${Date.now()}`;
};
const normalizeIdentityId = (value) => {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 128) : undefined;
};
const parseCliOptions = (defaults) => {
    const args = process.argv.slice(2);
    const readArgValue = (flag) => {
        const idx = args.findIndex((arg) => arg === flag);
        if (idx === -1)
            return undefined;
        return args[idx + 1];
    };
    const presetInput = (readArgValue('--preset') || defaults.preset).toLowerCase();
    const preset = ['small', 'medium', 'large'].includes(presetInput)
        ? presetInput
        : defaults.preset;
    const batchId = readArgValue('--batch');
    const resetOnly = args.includes('--reset');
    const noClear = args.includes('--no-clear');
    const clearAliasFlag = args.some((arg) => /^--clear-[a-z]+$/.test(arg) && arg !== '--clear-tagged');
    const clearFlag = args.includes('--clear-tagged') || clearAliasFlag;
    const clearTaggedData = resetOnly
        ? false
        : (clearFlag ? true : (noClear ? false : defaults.clearTaggedData));
    const dataSource = ensureDataSource((readArgValue('--source') || defaults.dataSource).trim());
    const targetUserId = normalizeIdentityId(readArgValue('--target-user') || readArgValue('--user-id'));
    const targetCompanyId = normalizeIdentityId(readArgValue('--target-company') || readArgValue('--company-id'));
    return {
        preset,
        resetOnly,
        clearTaggedData,
        dataSource,
        batchId: batchId && batchId.trim().length > 0 ? ensureBatchId(batchId.trim()) : undefined,
        targetUserId,
        targetCompanyId
    };
};
const buildLegacyTagConfigs = (db, batchCollections, dataSource) => __awaiter(void 0, void 0, void 0, function* () {
    const legacyBatchCollections = batchCollections
        .filter((name) => name.endsWith('_batches') && name !== 'data_batches');
    if (legacyBatchCollections.length === 0)
        return [];
    const probeCollection = legacyBatchCollections[0];
    const probePrefix = probeCollection.replace(/_batches$/, '');
    const probeDoc = yield db.collection(probeCollection).findOne({}, { projection: { _id: 0 } });
    const sourceSuffix = probeDoc
        ? (Object.keys(probeDoc).find((key) => key !== 'dataSource' && key.startsWith(probePrefix) && key.endsWith('Source')) || `${probePrefix}Source`).slice(probePrefix.length)
        : 'Source';
    const batchSuffix = probeDoc
        ? (Object.keys(probeDoc).find((key) => key !== 'dataBatchId' && key.startsWith(probePrefix) && key.endsWith('BatchId')) || `${probePrefix}BatchId`).slice(probePrefix.length)
        : 'BatchId';
    return legacyBatchCollections
        .map((batchCollection) => {
        const prefix = batchCollection.replace(/_batches$/, '');
        if (prefix.length === 0 || !/^[a-z0-9_]+$/.test(prefix)) {
            return null;
        }
        return {
            batchCollection,
            sourceKey: `${prefix}${sourceSuffix}`,
            batchKey: `${prefix}${batchSuffix}`,
            sourceValues: [dataSource, `${prefix}-${dataSource}`]
        };
    })
        .filter((config) => config !== null);
});
const ensureDataLoadAllowed = () => {
    const isProd = process.env.NODE_ENV === 'production';
    const allowDataLoad = process.env.ALLOW_DATA_LOAD === 'true' || process.env.ALLOW_DATA === 'true';
    if (isProd && !allowDataLoad) {
        throw new Error('Refusing data bootstrap in production without ALLOW_DATA_LOAD=true.');
    }
};
const dataFromString = (source) => {
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
        hash = (hash << 5) - hash + source.charCodeAt(i);
        hash |= 0;
    }
    return hash >>> 0;
};
const createRng = (data) => {
    let t = data >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
};
const randomInt = (rng, min, max) => {
    if (max <= min)
        return min;
    return Math.floor(rng() * (max - min + 1)) + min;
};
const pickOne = (rng, list) => list[randomInt(rng, 0, list.length - 1)];
const pickManyUnique = (rng, source, count) => {
    if (count <= 0)
        return [];
    if (count >= source.length)
        return [...source];
    const cloned = [...source];
    for (let i = cloned.length - 1; i > 0; i -= 1) {
        const j = randomInt(rng, 0, i);
        const temp = cloned[i];
        cloned[i] = cloned[j];
        cloned[j] = temp;
    }
    return cloned.slice(0, count);
};
const slugify = (input) => input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const normalizeHandleText = (input) => input.toLowerCase().replace(/[^a-z0-9]+/g, '');
const createUniqueHandleBase = (preferredName, fallbackToken, usedHandles) => {
    const base = normalizeHandleText(preferredName).slice(0, 24)
        || normalizeHandleText(fallbackToken).slice(0, 24)
        || 'aura';
    if (!usedHandles.has(base)) {
        usedHandles.add(base);
        return base;
    }
    let suffix = 2;
    while (true) {
        const suffixText = String(suffix);
        const candidate = `${base.slice(0, Math.max(1, 24 - suffixText.length))}${suffixText}`;
        if (!usedHandles.has(candidate)) {
            usedHandles.add(candidate);
            return candidate;
        }
        suffix += 1;
    }
};
const createTimestamp = (rng, daysBack) => {
    const offset = randomInt(rng, 0, daysBack * ONE_DAY_MS);
    return Date.now() - offset;
};
const buildUsers = (rng, count, dataBatchId, dataSource, usedHandles) => {
    const createdAt = nowIso();
    const users = [];
    for (let i = 0; i < count; i += 1) {
        const firstName = pickOne(rng, FIRST_NAMES);
        const lastName = pickOne(rng, LAST_NAMES);
        const id = `${dataBatchId}-user-${String(i + 1).padStart(4, '0')}`;
        const country = pickOne(rng, COUNTRIES);
        const displayName = `${firstName} ${lastName}`;
        const handleBase = createUniqueHandleBase(displayName, id, usedHandles);
        users.push({
            id,
            type: 'user',
            firstName,
            lastName,
            name: displayName,
            handle: `@${handleBase}`,
            email: `${handleBase}@demo.aura.local`,
            avatar: `https://robohash.org/${encodeURIComponent(`${displayName}-${id}`)}?set=set4&size=256x256`,
            avatarType: 'image',
            coverImage: `https://picsum.photos/1600/520?random=${encodeURIComponent(`${id}-cover`)}`,
            coverType: 'image',
            bio: `Creator in ${pickOne(rng, INDUSTRIES)} sharing practical progress and lessons from live work.`,
            country,
            companyName: '',
            website: `https://portfolio.${handleBase}.aura.local`,
            profileLinks: [],
            acquaintances: [],
            subscribedCompanyIds: [],
            sentAcquaintanceRequests: [],
            sentCompanySubscriptionRequests: [],
            sentConnectionRequests: [],
            blockedUsers: [],
            profileViews: [],
            notifications: [],
            featuredPostIds: [],
            isPrivate: false,
            isVerified: rng() > 0.42,
            userMode: 'creator',
            trustScore: randomInt(rng, 42, 98),
            auraCredits: randomInt(rng, 0, 480),
            auraCreditsSpent: randomInt(rng, 0, 220),
            activeGlow: pickOne(rng, ['emerald', 'cyan', 'amber', 'none']),
            refreshTokens: [],
            createdAt,
            updatedAt: createdAt,
            lastLogin: createdAt,
            dataSource,
            dataBatchId
        });
    }
    return users;
};
const buildCompanies = (rng, count, users, dataBatchId, dataSource, usedHandles) => {
    const companies = [];
    for (let i = 0; i < count; i += 1) {
        const id = `${dataBatchId}-company-${String(i + 1).padStart(4, '0')}`;
        const industry = pickOne(rng, INDUSTRIES);
        const country = pickOne(rng, COUNTRIES);
        const city = pickOne(rng, CITY_BY_COUNTRY[country] || ['Global']);
        const owner = users[i % users.length];
        const companyWord = pickOne(rng, COMPANY_WORDS);
        const companyName = `${companyWord} ${industry} ${String(i + 1).padStart(2, '0')}`;
        const handleBase = createUniqueHandleBase(companyName, id, usedHandles);
        const websiteDomain = `${slugify(companyName)}.aura.local`;
        companies.push({
            id,
            type: 'company',
            name: companyName,
            handle: `@${handleBase}`,
            avatar: `https://robohash.org/${encodeURIComponent(`${companyName}-${id}`)}?set=set2&size=256x256`,
            avatarType: 'image',
            coverImage: `https://picsum.photos/1600/520?random=${encodeURIComponent(`${id}-cover`)}`,
            coverType: 'image',
            bio: `${companyName} builds practical ${industry.toLowerCase()} systems for modern teams and creators.`,
            industry,
            website: `https://www.${websiteDomain}`,
            location: city,
            country,
            employeeCount: randomInt(rng, 4, 900),
            ownerId: owner.id,
            trustScore: randomInt(rng, 58, 100),
            auraCredits: randomInt(rng, 0, 2400),
            isVerified: true,
            isPrivate: false,
            subscribers: [],
            subscriberCount: 0,
            profileLinks: [],
            featuredPostIds: [],
            createdAt: new Date(createTimestamp(rng, 540)),
            updatedAt: new Date(),
            dataSource,
            dataBatchId
        });
    }
    return companies;
};
const buildRelationships = (rng, users, companies) => {
    const acquaintancesMap = new Map();
    const subscriptionsMap = new Map();
    users.forEach((user) => {
        acquaintancesMap.set(user.id, new Set());
        subscriptionsMap.set(user.id, new Set());
    });
    // Bidirectional acquaintance graph
    for (let i = 0; i < users.length; i += 1) {
        const user = users[i];
        const mine = acquaintancesMap.get(user.id);
        const targetCount = randomInt(rng, 7, 22);
        let attempts = 0;
        while (mine.size < targetCount && attempts < users.length * 2) {
            attempts += 1;
            const candidate = users[randomInt(rng, 0, users.length - 1)];
            if (!candidate || candidate.id === user.id)
                continue;
            mine.add(candidate.id);
            acquaintancesMap.get(candidate.id).add(user.id);
        }
    }
    // Company subscribers
    for (const company of companies) {
        const minSubs = Math.min(18, users.length);
        const maxSubs = Math.min(130, users.length);
        const desired = randomInt(rng, minSubs, maxSubs);
        const subscribers = pickManyUnique(rng, users.map((u) => u.id), desired);
        company.subscribers = subscribers;
        company.subscriberCount = subscribers.length;
        subscribers.forEach((userId) => {
            subscriptionsMap.get(userId).add(company.id);
        });
    }
    for (const user of users) {
        user.acquaintances = Array.from(acquaintancesMap.get(user.id) || []).sort();
        user.subscribedCompanyIds = Array.from(subscriptionsMap.get(user.id) || []).sort();
    }
};
const buildCompanyMembers = (companies, dataBatchId, dataSource) => companies.map((company, index) => ({
    id: `${dataBatchId}-member-${String(index + 1).padStart(4, '0')}`,
    companyId: company.id,
    userId: company.ownerId,
    role: 'owner',
    joinedAt: new Date(),
    updatedAt: new Date(),
    dataSource,
    dataBatchId
}));
const buildPostContent = (rng, topic, mentionHandle) => {
    const hook = pickOne(rng, HOOKS);
    const outcome = pickOne(rng, OUTCOMES);
    const mentionText = mentionHandle ? `\n\nShoutout to ${mentionHandle} for the execution quality.` : '';
    return `${hook}\n\n${outcome}\n\nFocus area: ${topic.replace('#', '')}.${mentionText}`;
};
const buildPosts = (rng, totalPosts, users, companies, dataBatchId, dataSource) => {
    const posts = [];
    const authorPool = [
        ...users.map((user) => ({ id: user.id, type: 'user', name: user.name, firstName: user.firstName, lastName: user.lastName, handle: user.handle, avatar: user.avatar, activeGlow: user.activeGlow })),
        ...companies.map((company) => ({ id: company.id, type: 'company', name: company.name, firstName: company.name, lastName: '', handle: company.handle, avatar: company.avatar, activeGlow: 'none' }))
    ];
    for (let i = 0; i < totalPosts; i += 1) {
        const id = `${dataBatchId}-post-${String(i + 1).padStart(6, '0')}`;
        const preferCompany = rng() < 0.28;
        const companyAuthors = authorPool.filter((author) => author.type === 'company');
        const userAuthors = authorPool.filter((author) => author.type === 'user');
        const author = preferCompany ? pickOne(rng, companyAuthors) : pickOne(rng, userAuthors);
        const hashtags = pickManyUnique(rng, TOPIC_TAGS, randomInt(rng, 2, 4));
        const topic = hashtags[0] || '#Growth';
        const mentionUser = rng() < 0.12 ? pickOne(rng, users) : undefined;
        const content = buildPostContent(rng, topic, mentionUser === null || mentionUser === void 0 ? void 0 : mentionUser.handle);
        const timestamp = createTimestamp(rng, 180);
        const hasMedia = rng() < 0.68;
        const isBoosted = rng() < 0.11;
        const reactions = {};
        const reactionCount = randomInt(rng, 1, 4);
        const reactionSet = pickManyUnique(rng, REACTION_EMOJIS, reactionCount);
        let reactionTotal = 0;
        reactionSet.forEach((emoji) => {
            const count = randomInt(rng, 0, 90);
            reactions[emoji] = count;
            reactionTotal += count;
        });
        const baseViews = randomInt(rng, 15, 6200);
        const visibility = author.type === 'company'
            ? (rng() < 0.72 ? 'public' : (rng() < 0.86 ? 'subscribers' : 'private'))
            : (rng() < 0.72 ? 'public' : (rng() < 0.86 ? 'acquaintances' : 'private'));
        const mediaUrl = hasMedia
            ? `https://picsum.photos/1200/900?random=${encodeURIComponent(id)}`
            : undefined;
        const mediaItems = hasMedia
            ? [{
                    id: `${id}-m1`,
                    url: mediaUrl,
                    type: 'image',
                    title: '',
                    description: '',
                    caption: '',
                    order: 0,
                    metrics: {
                        views: Math.max(0, Math.round(baseViews * (0.7 + rng() * 0.6))),
                        clicks: randomInt(rng, 0, 120),
                        saves: randomInt(rng, 0, 80),
                        dwellMs: randomInt(rng, 1200, 19000)
                    }
                }]
            : undefined;
        posts.push({
            id,
            type: 'post',
            author: {
                id: author.id,
                firstName: author.firstName,
                lastName: author.lastName,
                name: author.name,
                handle: author.handle,
                avatar: author.avatar,
                avatarType: 'image',
                activeGlow: author.activeGlow,
                type: author.type
            },
            authorId: author.id,
            ownerId: author.id,
            ownerType: author.type,
            content,
            mediaUrl,
            mediaType: hasMedia ? 'image' : undefined,
            mediaItems,
            taggedUserIds: mentionUser ? [mentionUser.id] : [],
            hashtags,
            energy: pickOne(rng, ENERGY_VALUES),
            radiance: Math.max(0, Math.round(reactionTotal * (0.35 + rng() * 0.7)) + (isBoosted ? 30 : 0)),
            timestamp,
            visibility,
            reactions,
            reactionUsers: {},
            userReactions: [],
            comments: [],
            commentCount: 0,
            isBoosted,
            viewCount: baseViews,
            dataSource,
            dataBatchId
        });
    }
    return posts;
};
const normalizeHandle = (rawValue, fallbackName, fallbackId) => {
    const candidate = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (candidate.length > 0) {
        return candidate.startsWith('@') ? candidate : `@${candidate}`;
    }
    const slugBase = slugify(fallbackName) || sanitizeBatchId(fallbackId) || 'aura';
    return `@${slugBase.slice(0, 28)}`;
};
const toDataAdOwnerFromUser = (user, isTargeted) => ({
    id: user.id,
    type: 'user',
    name: user.name,
    handle: normalizeHandle(user.handle, user.name, user.id),
    avatar: user.avatar,
    avatarType: user.avatarType,
    email: user.email,
    activeGlow: user.activeGlow,
    isTargeted
});
const toDataAdOwnerFromCompany = (company, isTargeted) => ({
    id: company.id,
    type: 'company',
    name: company.name,
    handle: normalizeHandle(company.handle, company.name, company.id),
    avatar: company.avatar,
    avatarType: company.avatarType,
    activeGlow: 'none',
    isTargeted
});
const loadExistingAdOwner = (db, ownerType, ownerId) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = ownerType === 'company' ? 'companies' : 'users';
    const doc = yield db.collection(collection).findOne({ id: ownerId });
    if (!doc)
        return null;
    const name = ownerType === 'company'
        ? String((doc === null || doc === void 0 ? void 0 : doc.name) || ownerId)
        : String((doc === null || doc === void 0 ? void 0 : doc.name) || `${(doc === null || doc === void 0 ? void 0 : doc.firstName) || ''} ${(doc === null || doc === void 0 ? void 0 : doc.lastName) || ''}`.trim() || ownerId);
    return {
        id: String((doc === null || doc === void 0 ? void 0 : doc.id) || ownerId),
        type: ownerType,
        name,
        handle: normalizeHandle(doc === null || doc === void 0 ? void 0 : doc.handle, name, ownerId),
        avatar: typeof (doc === null || doc === void 0 ? void 0 : doc.avatar) === 'string' ? doc.avatar : `https://robohash.org/${encodeURIComponent(`${name}-${ownerId}`)}?set=set1&size=256x256`,
        avatarType: (doc === null || doc === void 0 ? void 0 : doc.avatarType) === 'video' ? 'video' : 'image',
        email: typeof (doc === null || doc === void 0 ? void 0 : doc.email) === 'string' ? doc.email : undefined,
        activeGlow: typeof (doc === null || doc === void 0 ? void 0 : doc.activeGlow) === 'string' ? doc.activeGlow : 'none',
        isTargeted: true
    };
});
const mergeAdOwners = (owners) => {
    const byKey = new Map();
    owners.forEach((owner) => {
        const key = `${owner.type}:${owner.id}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, owner);
            return;
        }
        if (owner.isTargeted && !existing.isTargeted) {
            byKey.set(key, owner);
        }
    });
    return Array.from(byKey.values());
};
const resolveAdOwners = (db, rng, users, companies, targetUserId, targetCompanyId) => __awaiter(void 0, void 0, void 0, function* () {
    const sampledUsers = pickManyUnique(rng, users, Math.min(users.length, Math.max(4, Math.round(users.length * 0.12))));
    const sampledCompanies = pickManyUnique(rng, companies, Math.min(companies.length, Math.max(2, Math.round(companies.length * 0.22))));
    const owners = [
        ...sampledUsers.map((user) => toDataAdOwnerFromUser(user, false)),
        ...sampledCompanies.map((company) => toDataAdOwnerFromCompany(company, false))
    ];
    const unresolvedTargets = [];
    if (targetUserId) {
        const dataedUser = users.find((user) => user.id === targetUserId);
        if (dataedUser) {
            owners.push(toDataAdOwnerFromUser(dataedUser, true));
        }
        else {
            const owner = yield loadExistingAdOwner(db, 'user', targetUserId);
            if (owner)
                owners.push(owner);
            else
                unresolvedTargets.push(`user:${targetUserId}`);
        }
    }
    if (targetCompanyId) {
        const dataedCompany = companies.find((company) => company.id === targetCompanyId);
        if (dataedCompany) {
            owners.push(toDataAdOwnerFromCompany(dataedCompany, true));
        }
        else {
            const owner = yield loadExistingAdOwner(db, 'company', targetCompanyId);
            if (owner)
                owners.push(owner);
            else
                unresolvedTargets.push(`company:${targetCompanyId}`);
        }
    }
    return {
        owners: mergeAdOwners(owners),
        unresolvedTargets
    };
});
const pickDataAdStatus = (rng) => {
    const statusRoll = rng();
    if (statusRoll < 0.72)
        return 'active';
    if (statusRoll < 0.9)
        return 'paused';
    return 'expired';
};
const buildDataAdReactions = (rng) => {
    const reactions = {};
    pickManyUnique(rng, REACTION_EMOJIS, randomInt(rng, 1, 3)).forEach((emoji) => {
        reactions[emoji] = randomInt(rng, 0, 44);
    });
    return reactions;
};
const buildAdDailyAnalytics = (rng, adId, owner, status, now, dataSource, dataBatchId) => {
    const daily = [];
    const totals = {
        impressions: 0,
        clicks: 0,
        engagement: 0,
        conversions: 0,
        spend: 0,
        reach: 0
    };
    for (let dayOffset = AD_ANALYTICS_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
        const day = new Date(now - dayOffset * ONE_DAY_MS);
        day.setUTCHours(0, 0, 0, 0);
        const dateKey = day.toISOString().slice(0, 10);
        const recencyBoost = 0.62 + ((AD_ANALYTICS_DAYS - dayOffset) / AD_ANALYTICS_DAYS) * 0.78;
        const ownerBoost = owner.isTargeted ? 1.8 : 1;
        const statusBoost = status === 'active' ? 1 : (status === 'paused' ? 0.42 : 0.16);
        const baseImpressions = randomInt(rng, 20, 1100);
        const impressions = Math.max(0, Math.round(baseImpressions * recencyBoost * ownerBoost * statusBoost));
        const clicks = Math.min(impressions, Math.round(impressions * (0.006 + rng() * 0.06)));
        const engagement = Math.max(clicks, Math.round(impressions * (0.012 + rng() * 0.07)));
        const conversions = Math.min(clicks, Math.round(clicks * (0.05 + rng() * 0.3)));
        const uniqueReach = Math.min(impressions, Math.round(impressions * (0.55 + rng() * 0.35)));
        const spend = Number((impressions * (0.0035 + rng() * 0.018)).toFixed(2));
        const updatedAt = day.getTime() + randomInt(rng, 10, 23) * 60 * 60 * 1000;
        daily.push({
            adId,
            ownerId: owner.id,
            ownerType: owner.type,
            dateKey,
            impressions,
            clicks,
            engagement,
            conversions,
            spend,
            uniqueReach,
            updatedAt,
            createdAt: day.getTime(),
            dataSource,
            dataBatchId
        });
        totals.impressions += impressions;
        totals.clicks += clicks;
        totals.engagement += engagement;
        totals.conversions += conversions;
        totals.spend += spend;
        totals.reach += uniqueReach;
    }
    return { daily, totals };
};
const buildDataAdDocument = (rng, adId, owner, now, dataSource, dataBatchId) => {
    const status = pickDataAdStatus(rng);
    const createdAt = createTimestamp(rng, 55);
    const expiryDate = status === 'expired'
        ? createdAt + randomInt(rng, 5, 30) * ONE_DAY_MS
        : now + randomInt(rng, 7, 75) * ONE_DAY_MS;
    const campaignWhy = pickOne(rng, AD_CAMPAIGN_WHYS);
    const campaignToken = crypto_1.default.createHash('sha1').update(adId).digest('hex').slice(0, 10);
    const leadCapture = rng() < 0.26
        ? {
            type: 'email_capture',
            title: 'Get campaign brief',
            description: 'Drop your email and we will send the full execution brief.',
            submitLabel: 'Send brief',
            successMessage: 'Brief sent. Check your inbox.',
            includeEmail: true
        }
        : { type: 'none' };
    return {
        id: adId,
        ownerId: owner.id,
        ownerType: owner.type,
        ownerName: owner.name,
        ownerAvatar: owner.avatar,
        ownerAvatarType: owner.avatarType,
        ownerEmail: owner.email,
        ownerActiveGlow: owner.activeGlow || 'none',
        headline: pickOne(rng, AD_HEADLINES),
        description: `${pickOne(rng, AD_DESCRIPTIONS)}\n\nBy ${owner.name}.`,
        mediaUrl: `https://picsum.photos/1280/720?random=${encodeURIComponent(`${adId}-media`)}`,
        mediaType: 'image',
        ctaText: pickOne(rng, AD_CTA_TEXTS),
        ctaLink: `https://www.aura.net.za/campaigns/${owner.type}/${campaignToken}`,
        ctaPositionX: randomInt(rng, 24, 76),
        ctaPositionY: randomInt(rng, 68, 90),
        campaignWhy,
        leadCapture,
        placement: pickOne(rng, AD_PLACEMENTS),
        isSponsored: true,
        status,
        expiryDate,
        timestamp: createdAt,
        reactions: buildDataAdReactions(rng),
        reactionUsers: {},
        hashtags: pickManyUnique(rng, TOPIC_TAGS, randomInt(rng, 2, 4)),
        dataSource,
        dataBatchId
    };
};
const buildDataAdAnalyticsDocument = (rng, adId, owner, now, totals, dataSource, dataBatchId) => {
    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    return {
        adId,
        ownerId: owner.id,
        ownerType: owner.type,
        impressions: totals.impressions,
        clicks: totals.clicks,
        ctr,
        reach: Math.min(totals.reach, totals.impressions),
        engagement: totals.engagement,
        conversions: totals.conversions,
        spend: Number(totals.spend.toFixed(2)),
        lastUpdated: now - randomInt(rng, 0, 3) * ONE_DAY_MS,
        dataSource,
        dataBatchId
    };
};
const buildAdsAndAnalytics = (rng, owners, dataBatchId, dataSource) => {
    const ads = [];
    const adAnalytics = [];
    const adAnalyticsDaily = [];
    const now = Date.now();
    let adIndex = 1;
    owners.forEach((owner) => {
        const adCount = owner.isTargeted ? randomInt(rng, 6, 9) : randomInt(rng, 1, 3);
        for (let i = 0; i < adCount; i += 1) {
            const adId = `${dataBatchId}-ad-${String(adIndex).padStart(5, '0')}`;
            adIndex += 1;
            const ad = buildDataAdDocument(rng, adId, owner, now, dataSource, dataBatchId);
            const { daily, totals } = buildAdDailyAnalytics(rng, adId, owner, ad.status, now, dataSource, dataBatchId);
            const aggregate = buildDataAdAnalyticsDocument(rng, adId, owner, now, totals, dataSource, dataBatchId);
            ads.push(ad);
            adAnalytics.push(aggregate);
            adAnalyticsDaily.push(...daily);
        }
    });
    return { ads, adAnalytics, adAnalyticsDaily };
};
const clearExistingDataData = (db, dataSource, dataBatchId) => __awaiter(void 0, void 0, void 0, function* () {
    const taggedQuery = {
        dataSource
    };
    if (dataBatchId)
        taggedQuery.dataBatchId = dataBatchId;
    const batchQuery = {
        dataSource
    };
    if (dataBatchId)
        batchQuery.batchId = dataBatchId;
    const primaryCollections = [
        'adAnalyticsDaily',
        'adAnalytics',
        'ads',
        'posts',
        'comments',
        'company_members',
        'companies',
        'users'
    ];
    const batchCollections = (yield db.listCollections({}, { nameOnly: true }).toArray())
        .map((collection) => String(collection.name || ''))
        .filter((name) => name.endsWith('_batches'));
    if (!batchCollections.includes('data_batches')) {
        batchCollections.push('data_batches');
    }
    yield Promise.all([
        ...primaryCollections.map((collectionName) => db.collection(collectionName).deleteMany(taggedQuery)),
        ...batchCollections.map((collectionName) => db.collection(collectionName).deleteMany(batchQuery))
    ]);
    const legacyConfigs = yield buildLegacyTagConfigs(db, batchCollections, dataSource);
    if (legacyConfigs.length === 0)
        return;
    const legacyPrimaryDeletions = legacyConfigs.flatMap((config) => {
        const query = {
            [config.sourceKey]: { $in: config.sourceValues }
        };
        if (dataBatchId)
            query[config.batchKey] = dataBatchId;
        return primaryCollections.map((collectionName) => db.collection(collectionName).deleteMany(query));
    });
    const legacyBatchDeletions = legacyConfigs.map((config) => {
        const query = {
            [config.sourceKey]: { $in: config.sourceValues }
        };
        if (dataBatchId)
            query.batchId = dataBatchId;
        return db.collection(config.batchCollection).deleteMany(query);
    });
    yield Promise.all([...legacyPrimaryDeletions, ...legacyBatchDeletions]);
});
const insertDataData = (db, plan, dataBatchId, dataSource, targetUserId, targetCompanyId) => __awaiter(void 0, void 0, void 0, function* () {
    const dataNumber = dataFromString(dataBatchId);
    const rng = createRng(dataNumber);
    const usedHandles = new Set();
    const companyCount = Math.round(plan.profiles * COMPANY_RATIO);
    const userCount = plan.profiles - companyCount;
    const users = buildUsers(rng, userCount, dataBatchId, dataSource, usedHandles);
    const companies = buildCompanies(rng, companyCount, users, dataBatchId, dataSource, usedHandles);
    buildRelationships(rng, users, companies);
    const companyMembers = buildCompanyMembers(companies, dataBatchId, dataSource);
    const posts = buildPosts(rng, plan.posts, users, companies, dataBatchId, dataSource);
    const { owners: adOwners, unresolvedTargets } = yield resolveAdOwners(db, rng, users, companies, targetUserId, targetCompanyId);
    const { ads, adAnalytics, adAnalyticsDaily } = buildAdsAndAnalytics(rng, adOwners, dataBatchId, dataSource);
    yield db.collection('users').insertMany(users, { ordered: false });
    yield db.collection('companies').insertMany(companies, { ordered: false });
    yield db.collection('company_members').insertMany(companyMembers, { ordered: false });
    yield db.collection('posts').insertMany(posts, { ordered: false });
    if (ads.length > 0) {
        yield db.collection('ads').insertMany(ads, { ordered: false });
    }
    if (adAnalytics.length > 0) {
        yield db.collection('adAnalytics').insertMany(adAnalytics, { ordered: false });
    }
    if (adAnalyticsDaily.length > 0) {
        yield db.collection('adAnalyticsDaily').insertMany(adAnalyticsDaily, { ordered: false });
    }
    yield db.collection('data_batches').updateOne({ dataSource, batchId: dataBatchId }, {
        $set: {
            batchId: dataBatchId,
            dataSource,
            preset: plan === PRESETS.large ? 'large' : plan === PRESETS.medium ? 'medium' : 'small',
            profiles: plan.profiles,
            posts: plan.posts,
            users: userCount,
            companies: companyCount,
            ads: ads.length,
            adOwners: adOwners.length,
            targetedOwners: adOwners.filter((owner) => owner.isTargeted).length,
            unresolvedTargets,
            createdAt: new Date()
        }
    }, { upsert: true });
    return {
        users: userCount,
        companies: companyCount,
        posts: plan.posts,
        ads: ads.length,
        adOwners: adOwners.length,
        targetedOwners: adOwners.filter((owner) => owner.isTargeted).length,
        unresolvedTargets
    };
});
const resolveDefaults = (options = {}) => {
    var _a;
    return ({
        preset: options.preset || 'large',
        clearTaggedData: (_a = options.clearTaggedData) !== null && _a !== void 0 ? _a : true,
        dataSource: ensureDataSource(options.dataSource || DEFAULT_DATA_SOURCE),
        batchIdPrefix: sanitizeBatchId(options.batchIdPrefix || 'demo') || 'demo',
        resetCommand: options.resetCommand || 'npm run data:demo:reset'
    });
};
const runDataDemoData = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (options = {}) {
    const defaults = resolveDefaults(options);
    const cli = parseCliOptions(defaults);
    const plan = PRESETS[cli.preset];
    const batchId = cli.batchId || buildDefaultBatchId(defaults.batchIdPrefix, cli.preset);
    ensureDataLoadAllowed();
    try {
        yield (0, db_1.connectDB)();
        if (!(0, db_1.isDBConnected)()) {
            throw new Error('Database connection is unavailable.');
        }
        const db = (0, db_1.getDB)();
        if (cli.resetOnly) {
            yield clearExistingDataData(db, cli.dataSource, cli.batchId);
            console.log(`✅ Data reset complete for source "${cli.dataSource}"${cli.batchId ? ` and batch "${cli.batchId}"` : ''}.`);
            return;
        }
        if (cli.clearTaggedData) {
            yield clearExistingDataData(db, cli.dataSource);
            console.log(`🧹 Cleared existing records for source "${cli.dataSource}".`);
        }
        console.log(`🌱 Loading source "${cli.dataSource}" (preset "${cli.preset}") with ${plan.profiles} profiles and ${plan.posts} posts...`);
        if (cli.targetUserId || cli.targetCompanyId) {
            console.log(`   Target user: ${cli.targetUserId || '(none)'}`);
            console.log(`   Target company: ${cli.targetCompanyId || '(none)'}`);
        }
        const summary = yield insertDataData(db, plan, batchId, cli.dataSource, cli.targetUserId, cli.targetCompanyId);
        console.log('✅ Data load completed successfully.');
        console.log(`   Source: ${cli.dataSource}`);
        console.log(`   Batch: ${batchId}`);
        console.log(`   Profiles: ${plan.profiles} (${summary.users} users / ${summary.companies} companies)`);
        console.log(`   Posts: ${summary.posts}`);
        console.log(`   Ads: ${summary.ads} across ${summary.adOwners} owners`);
        if (summary.targetedOwners > 0) {
            console.log(`   Targeted owners loaded: ${summary.targetedOwners}`);
        }
        if (summary.unresolvedTargets.length > 0) {
            console.log(`   Unresolved targets: ${summary.unresolvedTargets.join(', ')}`);
        }
        console.log('');
        console.log('Tip: reset this source tag with:');
        console.log(`  ${defaults.resetCommand} -- --source ${cli.dataSource}`);
        console.log(`  ${defaults.resetCommand} -- --source ${cli.dataSource} --batch ${batchId}`);
    }
    finally {
        yield (0, db_1.closeDB)();
    }
});
exports.runDataDemoData = runDataDemoData;
if (require.main === module) {
    (0, exports.runDataDemoData)().catch((error) => {
        console.error('❌ Data load failed:', error);
        process.exitCode = 1;
    });
}
