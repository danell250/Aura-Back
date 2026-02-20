import crypto from 'crypto';
import { Db } from 'mongodb';
import { closeDB, connectDB, getDB, isDBConnected } from '../db';

type PresetName = 'small' | 'medium' | 'large';

interface SeedPlan {
  profiles: number;
  posts: number;
}

interface CliOptions {
  preset: PresetName;
  resetOnly: boolean;
  clearAllSeeded: boolean;
  seedSource: string;
  batchId?: string;
  targetUserId?: string;
  targetCompanyId?: string;
}

interface SeedScriptDefaults {
  preset: PresetName;
  clearAllSeeded: boolean;
  seedSource: string;
  batchIdPrefix: string;
  resetCommand: string;
}

export interface RunSeedDemoDataOptions {
  preset?: PresetName;
  clearAllSeeded?: boolean;
  seedSource?: string;
  batchIdPrefix?: string;
  resetCommand?: string;
}

type OwnerType = 'user' | 'company';

type SeedGlow = 'emerald' | 'cyan' | 'amber' | 'none';

interface SeedUserDoc {
  id: string;
  type: 'user';
  firstName: string;
  lastName: string;
  name: string;
  handle: string;
  email: string;
  avatar: string;
  avatarType: 'image';
  coverImage: string;
  coverType: 'image';
  bio: string;
  country: string;
  companyName: string;
  website: string;
  profileLinks: Array<{ id: string; label: string; url: string }>;
  acquaintances: string[];
  subscribedCompanyIds: string[];
  sentAcquaintanceRequests: string[];
  sentCompanySubscriptionRequests: string[];
  sentConnectionRequests: string[];
  blockedUsers: string[];
  profileViews: string[];
  notifications: unknown[];
  featuredPostIds: string[];
  isPrivate: boolean;
  isVerified: boolean;
  userMode: 'creator';
  trustScore: number;
  auraCredits: number;
  auraCreditsSpent: number;
  activeGlow: SeedGlow;
  refreshTokens: string[];
  createdAt: string;
  updatedAt: string;
  lastLogin: string;
  seedSource: string;
  seedBatchId: string;
}

interface SeedCompanyDoc {
  id: string;
  type: 'company';
  name: string;
  handle: string;
  avatar: string;
  avatarType: 'image';
  coverImage: string;
  coverType: 'image';
  bio: string;
  industry: string;
  website: string;
  location: string;
  country: string;
  employeeCount: number;
  ownerId: string;
  trustScore: number;
  auraCredits: number;
  isVerified: boolean;
  isPrivate: boolean;
  subscribers: string[];
  subscriberCount: number;
  profileLinks: Array<{ id: string; label: string; url: string }>;
  featuredPostIds: string[];
  createdAt: Date;
  updatedAt: Date;
  seedSource: string;
  seedBatchId: string;
}

interface SeedCompanyMemberDoc {
  id: string;
  companyId: string;
  userId: string;
  role: 'owner';
  joinedAt: Date;
  updatedAt: Date;
  seedSource: string;
  seedBatchId: string;
}

interface SeedPostDoc {
  id: string;
  type: 'post';
  author: {
    id: string;
    firstName: string;
    lastName: string;
    name: string;
    handle: string;
    avatar: string;
    avatarType: 'image';
    activeGlow: SeedGlow;
    type: OwnerType;
  };
  authorId: string;
  ownerId: string;
  ownerType: OwnerType;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image';
  mediaItems?: Array<{
    id: string;
    url: string;
    type: 'image';
    title: string;
    description: string;
    caption: string;
    order: number;
    metrics: {
      views: number;
      clicks: number;
      saves: number;
      dwellMs: number;
    };
  }>;
  taggedUserIds: string[];
  hashtags: string[];
  energy: string;
  radiance: number;
  timestamp: number;
  visibility: 'public' | 'private' | 'acquaintances' | 'subscribers';
  reactions: Record<string, number>;
  reactionUsers: Record<string, string[]>;
  userReactions: string[];
  comments: unknown[];
  commentCount: number;
  isBoosted: boolean;
  viewCount: number;
  seedSource: string;
  seedBatchId: string;
}

interface SeedAdOwner {
  id: string;
  type: OwnerType;
  name: string;
  handle: string;
  avatar: string;
  avatarType: 'image' | 'video';
  email?: string;
  activeGlow: string;
  isTargeted: boolean;
}

interface SeedAdDoc {
  id: string;
  ownerId: string;
  ownerType: OwnerType;
  ownerName: string;
  ownerAvatar: string;
  ownerAvatarType: 'image' | 'video';
  ownerEmail?: string;
  ownerActiveGlow: string;
  headline: string;
  description: string;
  mediaUrl: string;
  mediaType: 'image';
  ctaText: string;
  ctaLink: string;
  ctaPositionX: number;
  ctaPositionY: number;
  campaignWhy: 'safe_clicks_conversions' | 'lead_capture_no_exit' | 'email_growth' | 'book_more_calls' | 'gate_high_intent_downloads';
  leadCapture: {
    type: 'none' | 'email_capture';
    title?: string;
    description?: string;
    submitLabel?: string;
    successMessage?: string;
    includeEmail?: boolean;
  };
  placement: 'feed' | 'sidebar' | 'story' | 'search';
  isSponsored: boolean;
  status: 'active' | 'paused' | 'expired';
  expiryDate: number;
  timestamp: number;
  reactions: Record<string, number>;
  reactionUsers: Record<string, string[]>;
  hashtags: string[];
  seedSource: string;
  seedBatchId: string;
}

interface SeedAdAnalyticsDoc {
  adId: string;
  ownerId: string;
  ownerType: OwnerType;
  impressions: number;
  clicks: number;
  ctr: number;
  reach: number;
  engagement: number;
  conversions: number;
  spend: number;
  lastUpdated: number;
  seedSource: string;
  seedBatchId: string;
}

interface SeedAdAnalyticsDailyDoc {
  adId: string;
  ownerId: string;
  ownerType: OwnerType;
  dateKey: string;
  impressions: number;
  clicks: number;
  engagement: number;
  conversions: number;
  spend: number;
  uniqueReach: number;
  updatedAt: number;
  createdAt: number;
  seedSource: string;
  seedBatchId: string;
}

interface SeedInsertionSummary {
  users: number;
  companies: number;
  posts: number;
  ads: number;
  adOwners: number;
  targetedOwners: number;
  unresolvedTargets: string[];
}

const PRESETS: Record<PresetName, SeedPlan> = {
  small: { profiles: 25, posts: 120 },
  medium: { profiles: 150, posts: 1200 },
  large: { profiles: 600, posts: 10000 }
};

const DEFAULT_SEED_SOURCE = 'seed-demo-data';
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
const CITY_BY_COUNTRY: Record<string, string[]> = {
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
const AD_CAMPAIGN_WHYS: SeedAdDoc['campaignWhy'][] = [
  'safe_clicks_conversions',
  'lead_capture_no_exit',
  'email_growth',
  'book_more_calls',
  'gate_high_intent_downloads'
];
const AD_PLACEMENTS: SeedAdDoc['placement'][] = ['feed', 'sidebar', 'story', 'search'];
const AD_ANALYTICS_DAYS = 14;

const nowIso = (): string => new Date().toISOString();

const sanitizeBatchId = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9-_]/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

const ensureBatchId = (value: string): string => {
  const sanitized = sanitizeBatchId(value);
  if (!sanitized) {
    throw new Error('Invalid --batch value. Use letters, numbers, dashes, or underscores.');
  }
  return sanitized;
};

const sanitizeSeedSource = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9-_]/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

const ensureSeedSource = (value: string): string => {
  const sanitized = sanitizeSeedSource(value);
  if (!sanitized) {
    throw new Error('Invalid --source value. Use letters, numbers, dashes, or underscores.');
  }
  return sanitized;
};

const buildDefaultBatchId = (prefix: string, preset: PresetName): string => {
  const safePrefix = sanitizeBatchId(prefix) || 'seed';
  return sanitizeBatchId(`${safePrefix}-${preset}-${Date.now()}`) || `seed-${Date.now()}`;
};

const normalizeIdentityId = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 128) : undefined;
};

const parseCliOptions = (defaults: SeedScriptDefaults): CliOptions => {
  const args = process.argv.slice(2);
  const readArgValue = (flag: string): string | undefined => {
    const idx = args.findIndex((arg) => arg === flag);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };

  const presetInput = (readArgValue('--preset') || defaults.preset).toLowerCase();
  const preset = (['small', 'medium', 'large'] as PresetName[]).includes(presetInput as PresetName)
    ? (presetInput as PresetName)
    : defaults.preset;
  const batchId = readArgValue('--batch');
  const resetOnly = args.includes('--reset');
  const noClear = args.includes('--no-clear');
  const clearFlag = args.includes('--clear-seeded');
  const clearAllSeeded = resetOnly
    ? false
    : (clearFlag ? true : (noClear ? false : defaults.clearAllSeeded));
  const seedSource = ensureSeedSource((readArgValue('--source') || defaults.seedSource).trim());
  const targetUserId = normalizeIdentityId(readArgValue('--target-user') || readArgValue('--user-id'));
  const targetCompanyId = normalizeIdentityId(readArgValue('--target-company') || readArgValue('--company-id'));

  return {
    preset,
    resetOnly,
    clearAllSeeded,
    seedSource,
    batchId: batchId && batchId.trim().length > 0 ? ensureBatchId(batchId.trim()) : undefined,
    targetUserId,
    targetCompanyId
  };
};

const ensureSeedingAllowed = (): void => {
  const isProd = process.env.NODE_ENV === 'production';
  const allowSeed = process.env.ALLOW_SEED === 'true';
  if (isProd && !allowSeed) {
    throw new Error('Refusing to seed in production without ALLOW_SEED=true.');
  }
};

const seedFromString = (source: string): number => {
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
};

const createRng = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const randomInt = (rng: () => number, min: number, max: number): number => {
  if (max <= min) return min;
  return Math.floor(rng() * (max - min + 1)) + min;
};

const pickOne = <T,>(rng: () => number, list: T[]): T => list[randomInt(rng, 0, list.length - 1)];

const pickManyUnique = <T,>(rng: () => number, source: T[], count: number): T[] => {
  if (count <= 0) return [];
  if (count >= source.length) return [...source];
  const cloned = [...source];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, 0, i);
    const temp = cloned[i];
    cloned[i] = cloned[j];
    cloned[j] = temp;
  }
  return cloned.slice(0, count);
};

const slugify = (input: string): string => input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const createTimestamp = (rng: () => number, daysBack: number): number => {
  const offset = randomInt(rng, 0, daysBack * ONE_DAY_MS);
  return Date.now() - offset;
};

const buildUsers = (
  rng: () => number,
  batchSlug: string,
  count: number,
  seedBatchId: string,
  seedSource: string
): SeedUserDoc[] => {
  const createdAt = nowIso();
  const users: SeedUserDoc[] = [];
  for (let i = 0; i < count; i += 1) {
    const firstName = pickOne(rng, FIRST_NAMES);
    const lastName = pickOne(rng, LAST_NAMES);
    const id = `${seedBatchId}-user-${String(i + 1).padStart(4, '0')}`;
    const handleBase = `seed${batchSlug}u${String(i + 1).padStart(4, '0')}`;
    const country = pickOne(rng, COUNTRIES);
    const displayName = `${firstName} ${lastName}`;
    users.push({
      id,
      type: 'user',
      firstName,
      lastName,
      name: displayName,
      handle: `@${handleBase}`,
      email: `${handleBase}@seed.aura.local`,
      avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName + id)}`,
      avatarType: 'image',
      coverImage: `https://picsum.photos/seed/${encodeURIComponent(`${id}-cover`)}/1600/520`,
      coverType: 'image',
      bio: `Creator in ${pickOne(rng, INDUSTRIES)} sharing practical progress and lessons from live work.`,
      country,
      companyName: '',
      website: `https://portfolio.${handleBase}.seed`,
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
      seedSource,
      seedBatchId
    });
  }
  return users;
};

const buildCompanies = (
  rng: () => number,
  batchSlug: string,
  count: number,
  users: SeedUserDoc[],
  seedBatchId: string,
  seedSource: string
): SeedCompanyDoc[] => {
  const companies: SeedCompanyDoc[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `${seedBatchId}-company-${String(i + 1).padStart(4, '0')}`;
    const industry = pickOne(rng, INDUSTRIES);
    const country = pickOne(rng, COUNTRIES);
    const city = pickOne(rng, CITY_BY_COUNTRY[country] || ['Global']);
    const owner = users[i % users.length];
    const companyWord = pickOne(rng, COMPANY_WORDS);
    const companyName = `${companyWord} ${industry} ${String(i + 1).padStart(2, '0')}`;
    const handleBase = `seed${batchSlug}c${String(i + 1).padStart(4, '0')}`;
    const websiteDomain = `${slugify(companyName)}.seed`;
    companies.push({
      id,
      type: 'company',
      name: companyName,
      handle: `@${handleBase}`,
      avatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(companyName + id)}`,
      avatarType: 'image',
      coverImage: `https://picsum.photos/seed/${encodeURIComponent(`${id}-cover`)}/1600/520`,
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
      seedSource,
      seedBatchId
    });
  }
  return companies;
};

const buildRelationships = (
  rng: () => number,
  users: SeedUserDoc[],
  companies: SeedCompanyDoc[]
): void => {
  const acquaintancesMap = new Map<string, Set<string>>();
  const subscriptionsMap = new Map<string, Set<string>>();
  users.forEach((user) => {
    acquaintancesMap.set(user.id, new Set<string>());
    subscriptionsMap.set(user.id, new Set<string>());
  });

  // Bidirectional acquaintance graph
  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    const mine = acquaintancesMap.get(user.id)!;
    const targetCount = randomInt(rng, 7, 22);
    let attempts = 0;
    while (mine.size < targetCount && attempts < users.length * 2) {
      attempts += 1;
      const candidate = users[randomInt(rng, 0, users.length - 1)];
      if (!candidate || candidate.id === user.id) continue;
      mine.add(candidate.id);
      acquaintancesMap.get(candidate.id)!.add(user.id);
    }
  }

  // Company subscribers
  for (const company of companies) {
    const minSubs = Math.min(18, users.length);
    const maxSubs = Math.min(130, users.length);
    const desired = randomInt(rng, minSubs, maxSubs);
    const subscribers = pickManyUnique(
      rng,
      users.map((u) => u.id),
      desired
    );
    company.subscribers = subscribers;
    company.subscriberCount = subscribers.length;
    subscribers.forEach((userId) => {
      subscriptionsMap.get(userId)!.add(company.id);
    });
  }

  for (const user of users) {
    user.acquaintances = Array.from(acquaintancesMap.get(user.id) || []).sort();
    user.subscribedCompanyIds = Array.from(subscriptionsMap.get(user.id) || []).sort();
  }
};

const buildCompanyMembers = (
  companies: SeedCompanyDoc[],
  seedBatchId: string,
  seedSource: string
): SeedCompanyMemberDoc[] => companies.map((company, index) => ({
  id: `${seedBatchId}-member-${String(index + 1).padStart(4, '0')}`,
  companyId: company.id,
  userId: company.ownerId,
  role: 'owner',
  joinedAt: new Date(),
  updatedAt: new Date(),
  seedSource,
  seedBatchId
}));

const buildPostContent = (
  rng: () => number,
  topic: string,
  mentionHandle?: string
): string => {
  const hook = pickOne(rng, HOOKS);
  const outcome = pickOne(rng, OUTCOMES);
  const mentionText = mentionHandle ? `\n\nShoutout to ${mentionHandle} for the execution quality.` : '';
  return `${hook}\n\n${outcome}\n\nFocus area: ${topic.replace('#', '')}.${mentionText}`;
};

const buildPosts = (
  rng: () => number,
  totalPosts: number,
  users: SeedUserDoc[],
  companies: SeedCompanyDoc[],
  seedBatchId: string,
  seedSource: string
): SeedPostDoc[] => {
  const posts: SeedPostDoc[] = [];
  const authorPool = [
    ...users.map((user) => ({ id: user.id, type: 'user' as const, name: user.name, firstName: user.firstName, lastName: user.lastName, handle: user.handle, avatar: user.avatar, activeGlow: user.activeGlow })),
    ...companies.map((company) => ({ id: company.id, type: 'company' as const, name: company.name, firstName: company.name, lastName: '', handle: company.handle, avatar: company.avatar, activeGlow: 'none' as SeedGlow }))
  ];

  for (let i = 0; i < totalPosts; i += 1) {
    const id = `${seedBatchId}-post-${String(i + 1).padStart(6, '0')}`;
    const preferCompany = rng() < 0.28;
    const companyAuthors = authorPool.filter((author) => author.type === 'company');
    const userAuthors = authorPool.filter((author) => author.type === 'user');
    const author = preferCompany ? pickOne(rng, companyAuthors) : pickOne(rng, userAuthors);

    const hashtags = pickManyUnique(rng, TOPIC_TAGS, randomInt(rng, 2, 4));
    const topic = hashtags[0] || '#Growth';
    const mentionUser = rng() < 0.12 ? pickOne(rng, users) : undefined;
    const content = buildPostContent(rng, topic, mentionUser?.handle);
    const timestamp = createTimestamp(rng, 180);
    const hasMedia = rng() < 0.68;
    const isBoosted = rng() < 0.11;

    const reactions: Record<string, number> = {};
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
      ? `https://picsum.photos/seed/${encodeURIComponent(id)}/1200/900`
      : undefined;

    const mediaItems = hasMedia
      ? [{
        id: `${id}-m1`,
        url: mediaUrl!,
        type: 'image' as const,
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
      seedSource,
      seedBatchId
    });
  }
  return posts;
};

const normalizeHandle = (rawValue: unknown, fallbackName: string, fallbackId: string): string => {
  const candidate = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (candidate.length > 0) {
    return candidate.startsWith('@') ? candidate : `@${candidate}`;
  }
  const slugBase = slugify(fallbackName) || sanitizeBatchId(fallbackId) || 'aura';
  return `@${slugBase.slice(0, 28)}`;
};

const toSeedAdOwnerFromUser = (user: SeedUserDoc, isTargeted: boolean): SeedAdOwner => ({
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

const toSeedAdOwnerFromCompany = (company: SeedCompanyDoc, isTargeted: boolean): SeedAdOwner => ({
  id: company.id,
  type: 'company',
  name: company.name,
  handle: normalizeHandle(company.handle, company.name, company.id),
  avatar: company.avatar,
  avatarType: company.avatarType,
  activeGlow: 'none',
  isTargeted
});

const loadExistingAdOwner = async (
  db: Db,
  ownerType: OwnerType,
  ownerId: string
): Promise<SeedAdOwner | null> => {
  const collection = ownerType === 'company' ? 'companies' : 'users';
  const doc = await db.collection(collection).findOne({ id: ownerId });
  if (!doc) return null;

  const name = ownerType === 'company'
    ? String(doc?.name || ownerId)
    : String(doc?.name || `${doc?.firstName || ''} ${doc?.lastName || ''}`.trim() || ownerId);

  return {
    id: String(doc?.id || ownerId),
    type: ownerType,
    name,
    handle: normalizeHandle(doc?.handle, name, ownerId),
    avatar: typeof doc?.avatar === 'string' ? doc.avatar : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name + ownerId)}`,
    avatarType: doc?.avatarType === 'video' ? 'video' : 'image',
    email: typeof doc?.email === 'string' ? doc.email : undefined,
    activeGlow: typeof doc?.activeGlow === 'string' ? doc.activeGlow : 'none',
    isTargeted: true
  };
};

const mergeAdOwners = (owners: SeedAdOwner[]): SeedAdOwner[] => {
  const byKey = new Map<string, SeedAdOwner>();
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

const resolveAdOwners = async (
  db: Db,
  rng: () => number,
  users: SeedUserDoc[],
  companies: SeedCompanyDoc[],
  targetUserId?: string,
  targetCompanyId?: string
): Promise<{ owners: SeedAdOwner[]; unresolvedTargets: string[] }> => {
  const sampledUsers = pickManyUnique(
    rng,
    users,
    Math.min(users.length, Math.max(4, Math.round(users.length * 0.12)))
  );
  const sampledCompanies = pickManyUnique(
    rng,
    companies,
    Math.min(companies.length, Math.max(2, Math.round(companies.length * 0.22)))
  );

  const owners: SeedAdOwner[] = [
    ...sampledUsers.map((user) => toSeedAdOwnerFromUser(user, false)),
    ...sampledCompanies.map((company) => toSeedAdOwnerFromCompany(company, false))
  ];
  const unresolvedTargets: string[] = [];

  if (targetUserId) {
    const seededUser = users.find((user) => user.id === targetUserId);
    if (seededUser) {
      owners.push(toSeedAdOwnerFromUser(seededUser, true));
    } else {
      const owner = await loadExistingAdOwner(db, 'user', targetUserId);
      if (owner) owners.push(owner);
      else unresolvedTargets.push(`user:${targetUserId}`);
    }
  }

  if (targetCompanyId) {
    const seededCompany = companies.find((company) => company.id === targetCompanyId);
    if (seededCompany) {
      owners.push(toSeedAdOwnerFromCompany(seededCompany, true));
    } else {
      const owner = await loadExistingAdOwner(db, 'company', targetCompanyId);
      if (owner) owners.push(owner);
      else unresolvedTargets.push(`company:${targetCompanyId}`);
    }
  }

  return {
    owners: mergeAdOwners(owners),
    unresolvedTargets
  };
};

interface SeedAdTotals {
  impressions: number;
  clicks: number;
  engagement: number;
  conversions: number;
  spend: number;
  reach: number;
}

const pickSeedAdStatus = (rng: () => number): SeedAdDoc['status'] => {
  const statusRoll = rng();
  if (statusRoll < 0.72) return 'active';
  if (statusRoll < 0.9) return 'paused';
  return 'expired';
};

const buildSeedAdReactions = (rng: () => number): Record<string, number> => {
  const reactions: Record<string, number> = {};
  pickManyUnique(rng, REACTION_EMOJIS, randomInt(rng, 1, 3)).forEach((emoji) => {
    reactions[emoji] = randomInt(rng, 0, 44);
  });
  return reactions;
};

const buildAdDailyAnalytics = (
  rng: () => number,
  adId: string,
  owner: SeedAdOwner,
  status: SeedAdDoc['status'],
  now: number,
  seedSource: string,
  seedBatchId: string
): { daily: SeedAdAnalyticsDailyDoc[]; totals: SeedAdTotals } => {
  const daily: SeedAdAnalyticsDailyDoc[] = [];
  const totals: SeedAdTotals = {
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
      seedSource,
      seedBatchId
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

const buildSeedAdDocument = (
  rng: () => number,
  adId: string,
  owner: SeedAdOwner,
  now: number,
  seedSource: string,
  seedBatchId: string
): SeedAdDoc => {
  const status = pickSeedAdStatus(rng);
  const createdAt = createTimestamp(rng, 55);
  const expiryDate = status === 'expired'
    ? createdAt + randomInt(rng, 5, 30) * ONE_DAY_MS
    : now + randomInt(rng, 7, 75) * ONE_DAY_MS;
  const campaignWhy = pickOne(rng, AD_CAMPAIGN_WHYS);
  const campaignToken = crypto.createHash('sha1').update(adId).digest('hex').slice(0, 10);
  const leadCapture = rng() < 0.26
    ? {
      type: 'email_capture' as const,
      title: 'Get campaign brief',
      description: 'Drop your email and we will send the full execution brief.',
      submitLabel: 'Send brief',
      successMessage: 'Brief sent. Check your inbox.',
      includeEmail: true
    }
    : { type: 'none' as const };

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
    mediaUrl: `https://picsum.photos/seed/${encodeURIComponent(`${adId}-media`)}/1280/720`,
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
    reactions: buildSeedAdReactions(rng),
    reactionUsers: {},
    hashtags: pickManyUnique(rng, TOPIC_TAGS, randomInt(rng, 2, 4)),
    seedSource,
    seedBatchId
  };
};

const buildSeedAdAnalyticsDocument = (
  rng: () => number,
  adId: string,
  owner: SeedAdOwner,
  now: number,
  totals: SeedAdTotals,
  seedSource: string,
  seedBatchId: string
): SeedAdAnalyticsDoc => {
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
    seedSource,
    seedBatchId
  };
};

const buildAdsAndAnalytics = (
  rng: () => number,
  owners: SeedAdOwner[],
  seedBatchId: string,
  seedSource: string
): {
  ads: SeedAdDoc[];
  adAnalytics: SeedAdAnalyticsDoc[];
  adAnalyticsDaily: SeedAdAnalyticsDailyDoc[];
} => {
  const ads: SeedAdDoc[] = [];
  const adAnalytics: SeedAdAnalyticsDoc[] = [];
  const adAnalyticsDaily: SeedAdAnalyticsDailyDoc[] = [];
  const now = Date.now();
  let adIndex = 1;

  owners.forEach((owner) => {
    const adCount = owner.isTargeted ? randomInt(rng, 6, 9) : randomInt(rng, 1, 3);
    for (let i = 0; i < adCount; i += 1) {
      const adId = `${seedBatchId}-ad-${String(adIndex).padStart(5, '0')}`;
      adIndex += 1;

      const ad = buildSeedAdDocument(rng, adId, owner, now, seedSource, seedBatchId);
      const { daily, totals } = buildAdDailyAnalytics(
        rng,
        adId,
        owner,
        ad.status,
        now,
        seedSource,
        seedBatchId
      );
      const aggregate = buildSeedAdAnalyticsDocument(
        rng,
        adId,
        owner,
        now,
        totals,
        seedSource,
        seedBatchId
      );

      ads.push(ad);
      adAnalytics.push(aggregate);
      adAnalyticsDaily.push(...daily);
    }
  });

  return { ads, adAnalytics, adAnalyticsDaily };
};

const clearExistingSeedData = async (db: Db, seedSource: string, seedBatchId?: string): Promise<void> => {
  const query = seedBatchId
    ? { seedSource, seedBatchId }
    : { seedSource };
  await Promise.all([
    db.collection('adAnalyticsDaily').deleteMany(query),
    db.collection('adAnalytics').deleteMany(query),
    db.collection('ads').deleteMany(query),
    db.collection('posts').deleteMany(query),
    db.collection('comments').deleteMany(query),
    db.collection('company_members').deleteMany(query),
    db.collection('companies').deleteMany(query),
    db.collection('users').deleteMany(query),
    db.collection('seed_batches').deleteMany(seedBatchId ? { seedSource, batchId: seedBatchId } : { seedSource })
  ]);
};

const insertSeedData = async (
  db: Db,
  plan: SeedPlan,
  seedBatchId: string,
  seedSource: string,
  targetUserId?: string,
  targetCompanyId?: string
): Promise<SeedInsertionSummary> => {
  const batchSlug = sanitizeBatchId(seedBatchId).replace(/[^a-z0-9]/g, '').slice(-6) || 'seed';
  const seedNumber = seedFromString(seedBatchId);
  const rng = createRng(seedNumber);

  const companyCount = Math.round(plan.profiles * COMPANY_RATIO);
  const userCount = plan.profiles - companyCount;
  const users = buildUsers(rng, batchSlug, userCount, seedBatchId, seedSource);
  const companies = buildCompanies(rng, batchSlug, companyCount, users, seedBatchId, seedSource);
  buildRelationships(rng, users, companies);
  const companyMembers = buildCompanyMembers(companies, seedBatchId, seedSource);
  const posts = buildPosts(rng, plan.posts, users, companies, seedBatchId, seedSource);
  const { owners: adOwners, unresolvedTargets } = await resolveAdOwners(
    db,
    rng,
    users,
    companies,
    targetUserId,
    targetCompanyId
  );
  const { ads, adAnalytics, adAnalyticsDaily } = buildAdsAndAnalytics(
    rng,
    adOwners,
    seedBatchId,
    seedSource
  );

  await db.collection('users').insertMany(users, { ordered: false });
  await db.collection('companies').insertMany(companies, { ordered: false });
  await db.collection('company_members').insertMany(companyMembers, { ordered: false });
  await db.collection('posts').insertMany(posts, { ordered: false });
  if (ads.length > 0) {
    await db.collection('ads').insertMany(ads, { ordered: false });
  }
  if (adAnalytics.length > 0) {
    await db.collection('adAnalytics').insertMany(adAnalytics, { ordered: false });
  }
  if (adAnalyticsDaily.length > 0) {
    await db.collection('adAnalyticsDaily').insertMany(adAnalyticsDaily, { ordered: false });
  }

  await db.collection('seed_batches').updateOne(
    { seedSource, batchId: seedBatchId },
    {
      $set: {
        batchId: seedBatchId,
        seedSource,
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
    },
    { upsert: true }
  );

  return {
    users: userCount,
    companies: companyCount,
    posts: plan.posts,
    ads: ads.length,
    adOwners: adOwners.length,
    targetedOwners: adOwners.filter((owner) => owner.isTargeted).length,
    unresolvedTargets
  };
};

const resolveDefaults = (options: RunSeedDemoDataOptions = {}): SeedScriptDefaults => ({
  preset: options.preset || 'large',
  clearAllSeeded: options.clearAllSeeded ?? true,
  seedSource: ensureSeedSource(options.seedSource || DEFAULT_SEED_SOURCE),
  batchIdPrefix: sanitizeBatchId(options.batchIdPrefix || 'demo') || 'demo',
  resetCommand: options.resetCommand || 'npm run seed:demo:reset'
});

export const runSeedDemoData = async (options: RunSeedDemoDataOptions = {}): Promise<void> => {
  const defaults = resolveDefaults(options);
  const cli = parseCliOptions(defaults);
  const plan = PRESETS[cli.preset];
  const batchId = cli.batchId || buildDefaultBatchId(defaults.batchIdPrefix, cli.preset);

  ensureSeedingAllowed();

  try {
    await connectDB();
    if (!isDBConnected()) {
      throw new Error('Database connection is unavailable.');
    }
    const db = getDB();

    if (cli.resetOnly) {
      await clearExistingSeedData(db, cli.seedSource, cli.batchId);
      console.log(`✅ Seed reset complete for source "${cli.seedSource}"${cli.batchId ? ` and batch "${cli.batchId}"` : ''}.`);
      return;
    }

    if (cli.clearAllSeeded) {
      await clearExistingSeedData(db, cli.seedSource);
      console.log(`🧹 Cleared existing records for seed source "${cli.seedSource}".`);
    }

    console.log(`🌱 Seeding source "${cli.seedSource}" (preset "${cli.preset}") with ${plan.profiles} profiles and ${plan.posts} posts...`);
    if (cli.targetUserId || cli.targetCompanyId) {
      console.log(`   Target user: ${cli.targetUserId || '(none)'}`);
      console.log(`   Target company: ${cli.targetCompanyId || '(none)'}`);
    }
    const summary = await insertSeedData(
      db,
      plan,
      batchId,
      cli.seedSource,
      cli.targetUserId,
      cli.targetCompanyId
    );

    console.log('✅ Seed completed successfully.');
    console.log(`   Source: ${cli.seedSource}`);
    console.log(`   Batch: ${batchId}`);
    console.log(`   Profiles: ${plan.profiles} (${summary.users} users / ${summary.companies} companies)`);
    console.log(`   Posts: ${summary.posts}`);
    console.log(`   Ads: ${summary.ads} across ${summary.adOwners} owners`);
    if (summary.targetedOwners > 0) {
      console.log(`   Targeted owners seeded: ${summary.targetedOwners}`);
    }
    if (summary.unresolvedTargets.length > 0) {
      console.log(`   Unresolved targets: ${summary.unresolvedTargets.join(', ')}`);
    }
    console.log('');
    console.log('Tip: reset this seed source with:');
    console.log(`  ${defaults.resetCommand} -- --source ${cli.seedSource}`);
    console.log(`  ${defaults.resetCommand} -- --source ${cli.seedSource} --batch ${batchId}`);
  } finally {
    await closeDB();
  }
};

if (require.main === module) {
  runSeedDemoData().catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exitCode = 1;
  });
}
