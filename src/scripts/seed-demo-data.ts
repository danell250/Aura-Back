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

  return {
    preset,
    resetOnly,
    clearAllSeeded,
    seedSource,
    batchId: batchId && batchId.trim().length > 0 ? ensureBatchId(batchId.trim()) : undefined
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

const clearExistingSeedData = async (db: Db, seedSource: string, seedBatchId?: string): Promise<void> => {
  const query = seedBatchId
    ? { seedSource, seedBatchId }
    : { seedSource };
  await Promise.all([
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
  seedSource: string
): Promise<void> => {
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

  await db.collection('users').insertMany(users, { ordered: false });
  await db.collection('companies').insertMany(companies, { ordered: false });
  await db.collection('company_members').insertMany(companyMembers, { ordered: false });
  await db.collection('posts').insertMany(posts, { ordered: false });

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
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
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
    await insertSeedData(db, plan, batchId, cli.seedSource);

    console.log('✅ Seed completed successfully.');
    console.log(`   Source: ${cli.seedSource}`);
    console.log(`   Batch: ${batchId}`);
    console.log(`   Profiles: ${plan.profiles}`);
    console.log(`   Posts: ${plan.posts}`);
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
