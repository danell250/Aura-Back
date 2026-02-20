import crypto from 'crypto';
import { Db } from 'mongodb';
import { closeDB, connectDB, getDB, isDBConnected } from '../db';
import { AD_PLANS } from '../constants/adPlans';

interface CliOptions {
  companyId: string;
  source: string;
  batchId: string;
  dryRun: boolean;
  subscribers: number;
  posts: number;
  likesPerPost: number;
  commentsPerPost: number;
  ads: number;
  lookbackDays: number;
}

interface UserProfileLite {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  handle: string;
  avatar: string;
  avatarType: 'image' | 'video';
  activeGlow?: string;
  email?: string;
}

interface CompanyProfileLite {
  id: string;
  name: string;
  handle: string;
  ownerId?: string;
  avatar: string;
  avatarType: 'image' | 'video';
  subscribers: string[];
}

interface PostLite {
  id: string;
  reactions?: Record<string, number>;
  reactionUsers?: Record<string, string[]>;
  commentCount?: number;
  radiance?: number;
  timestamp?: number;
}

interface AdLite {
  id: string;
}

interface ProvisionSummary {
  participantsCreated: number;
  subscribersAdded: number;
  postsCreated: number;
  likesApplied: number;
  commentsInserted: number;
  adsCreated: number;
  analyticsCreated: number;
  analyticsDailyUpserts: number;
  companySubscriptionCreated: boolean;
  companySubscriptionUpdated: boolean;
}

interface ParticipantPoolResult {
  userPool: UserProfileLite[];
  userPoolIds: string[];
  participantsCreated: number;
}

interface SubscriberProvisionResult {
  subscribersAdded: number;
}

interface PostEngagementResult {
  postsCreated: number;
  likesApplied: number;
  commentsInserted: number;
}

interface AdProvisionResult {
  adsCreated: number;
  analyticsCreated: number;
  analyticsDailyUpserts: number;
  activeAdsCount: number;
}

interface SubscriptionProvisionResult {
  companySubscriptionCreated: boolean;
  companySubscriptionUpdated: boolean;
}

const DEFAULT_SOURCE = 'company-engagement-provisioning';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const COMMENT_TEXTS = [
  'Great campaign direction. This is clear and practical.',
  'Strong positioning here. The messaging is on point.',
  'This looks polished and high quality. Nicely done.',
  'Love the structure. Easy to follow and compelling.',
  'Solid execution. The CTA placement works well.',
  'Clear value proposition. This should convert well.',
  'Very relevant for operators right now.',
  'High signal post. Appreciate the detail.'
];
const POST_OPENERS = [
  'Performance update from this week:',
  'Quick field note from our team:',
  'Campaign insight worth sharing:',
  'Operator takeaway from live tests:',
  'Execution pattern that keeps working:'
];
const POST_OUTCOMES = [
  'Higher conversion quality with cleaner qualification.',
  'Faster creative turnaround with fewer revision loops.',
  'Improved CTR from sharper messaging and placement.',
  'More inbound interest from better offer framing.',
  'Better pipeline consistency without increasing spend.'
];
const POST_HASHTAGS = ['#Growth', '#Marketing', '#Campaigns', '#Performance', '#B2B', '#Brand'];
const AD_HEADLINES = [
  'Scale Qualified Pipeline With Better Creative',
  'Launch High-Signal Campaigns Faster',
  'Turn Attention Into Measurable Outcomes',
  'Improve Conversion Quality This Quarter',
  'Get Better Performance From Existing Reach'
];
const AD_DESCRIPTIONS = [
  'A practical campaign system for teams that care about outcomes, not vanity metrics.',
  'High-clarity messaging, focused targeting, and execution that compounds week over week.',
  'Built for fast iteration with measurable impact across impressions, clicks, and conversions.',
  'An operator-first approach to ad creative, positioning, and performance analytics.'
];
const AD_CTA = ['Book Demo', 'View Strategy', 'Get Playbook', 'See Case Study', 'Start Now'];

const sanitizeToken = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-_]/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const parseNumber = (value: string | undefined, fallback: number, min: number, max: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const parseFlagValue = (args: string[], flag: string): string | undefined => {
  const directIndex = args.findIndex((arg) => arg === flag);
  if (directIndex !== -1) {
    const next = args[directIndex + 1];
    return next && !next.startsWith('--') ? next : undefined;
  }
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : undefined;
};

const parseCliOptions = (): CliOptions => {
  const args = process.argv.slice(2);
  const companyIdRaw = (parseFlagValue(args, '--company-id') || parseFlagValue(args, '--company') || '').trim();
  if (!companyIdRaw) {
    throw new Error('Missing required --company-id value.');
  }

  const source = sanitizeToken(parseFlagValue(args, '--source') || DEFAULT_SOURCE) || DEFAULT_SOURCE;
  const batchId = sanitizeToken(parseFlagValue(args, '--batch') || `${source}-${Date.now()}`) || `${source}-${Date.now()}`;

  return {
    companyId: companyIdRaw.slice(0, 128),
    source,
    batchId,
    dryRun: args.includes('--dry-run'),
    subscribers: parseNumber(parseFlagValue(args, '--subscribers'), 140, 10, 20000),
    posts: parseNumber(parseFlagValue(args, '--posts'), 10, 1, 100),
    likesPerPost: parseNumber(parseFlagValue(args, '--likes-per-post'), 30, 1, 500),
    commentsPerPost: parseNumber(parseFlagValue(args, '--comments-per-post'), 8, 0, 100),
    ads: parseNumber(parseFlagValue(args, '--ads'), 8, 1, 100),
    lookbackDays: parseNumber(parseFlagValue(args, '--lookback-days'), 120, 7, 1000)
  };
};

const randomInt = (min: number, max: number): number => {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const pickOne = <T,>(values: T[]): T => {
  if (values.length === 0) {
    throw new Error('pickOne requires at least one value.');
  }
  return values[randomInt(0, values.length - 1)];
};

const pickManyUnique = <T,>(values: T[], desired: number): T[] => {
  if (desired <= 0) return [];
  if (values.length <= desired) return [...values];
  const pool = [...values];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, desired);
};

const uniqueIds = (values: string[]): string[] => Array.from(new Set(values.filter((value) => value && value.trim().length > 0)));

const ensureHandle = (rawValue: unknown, fallback: string): string => {
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    return rawValue.trim().startsWith('@') ? rawValue.trim() : `@${rawValue.trim()}`;
  }
  const compact = fallback.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 22) || 'aura';
  return `@${compact}`;
};

const buildUserLite = (doc: any): UserProfileLite => {
  const firstName = typeof doc?.firstName === 'string' && doc.firstName.trim().length > 0 ? doc.firstName.trim() : 'User';
  const lastName = typeof doc?.lastName === 'string' ? doc.lastName.trim() : '';
  const name = typeof doc?.name === 'string' && doc.name.trim().length > 0
    ? doc.name.trim()
    : `${firstName} ${lastName}`.trim();
  const id = typeof doc?.id === 'string' ? doc.id : String(doc?._id || '');

  return {
    id,
    firstName,
    lastName,
    name: name || firstName,
    handle: ensureHandle(doc?.handle, name || id),
    avatar: typeof doc?.avatar === 'string' && doc.avatar.trim().length > 0
      ? doc.avatar
      : `https://robohash.org/${encodeURIComponent(id)}?set=set4&size=256x256`,
    avatarType: doc?.avatarType === 'video' ? 'video' : 'image',
    activeGlow: typeof doc?.activeGlow === 'string' ? doc.activeGlow : 'none',
    email: typeof doc?.email === 'string' ? doc.email : undefined
  };
};

const buildCompanyLite = (doc: any, companyId: string): CompanyProfileLite => {
  const name = typeof doc?.name === 'string' && doc.name.trim().length > 0 ? doc.name.trim() : `Company ${companyId}`;
  return {
    id: companyId,
    name,
    handle: ensureHandle(doc?.handle, name),
    ownerId: typeof doc?.ownerId === 'string' ? doc.ownerId : undefined,
    avatar: typeof doc?.avatar === 'string' && doc.avatar.trim().length > 0
      ? doc.avatar
      : `https://robohash.org/${encodeURIComponent(companyId)}?set=set2&size=256x256`,
    avatarType: doc?.avatarType === 'video' ? 'video' : 'image',
    subscribers: Array.isArray(doc?.subscribers) ? uniqueIds(doc.subscribers.map((item: unknown) => String(item))) : []
  };
};

const buildParticipantUsers = (count: number, source: string, batchId: string): UserProfileLite[] => {
  const firstNames = ['Ava', 'Liam', 'Mia', 'Noah', 'Nora', 'Ethan', 'Luca', 'Amelia', 'Leo', 'Aria'];
  const lastNames = ['Nguyen', 'Patel', 'Smith', 'Khumalo', 'Dlamini', 'Botha', 'Jacobs', 'Meyer', 'Naidoo', 'Petersen'];
  const nowIso = new Date().toISOString();
  const created: UserProfileLite[] = [];

  for (let i = 0; i < count; i += 1) {
    const firstName = pickOne(firstNames);
    const lastName = pickOne(lastNames);
    // Keep participant IDs stable and lexicographically sortable across runs.
    const id = `${batchId}-participant-${String(i + 1).padStart(5, '0')}`;
    const name = `${firstName} ${lastName}`;
    const handleCore = `${firstName}${lastName}${String(i + 1)}`.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 22);
    created.push({
      id,
      firstName,
      lastName,
      name,
      handle: `@${handleCore}`,
      avatar: `https://robohash.org/${encodeURIComponent(id)}?set=set4&size=256x256`,
      avatarType: 'image',
      activeGlow: pickOne(['none', 'emerald', 'cyan', 'amber']),
      email: `${handleCore}@sim.aura.local`
    });
  }

  return created;
};

const insertParticipantUsers = async (
  db: Db,
  users: UserProfileLite[],
  source: string,
  batchId: string
): Promise<void> => {
  if (users.length === 0) return;
  const nowIso = new Date().toISOString();
  await db.collection('users').insertMany(users.map((user) => ({
    id: user.id,
    type: 'user',
    firstName: user.firstName,
    lastName: user.lastName,
    name: user.name,
    handle: user.handle,
    email: user.email,
    avatar: user.avatar,
    avatarType: user.avatarType,
    coverImage: `https://picsum.photos/1600/520?random=${encodeURIComponent(`${user.id}-cover`)}`,
    coverType: 'image',
    bio: 'Simulation participant profile.',
    country: 'United States',
    companyName: '',
    website: '',
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
    isVerified: false,
    userMode: 'creator',
    trustScore: randomInt(40, 80),
    auraCredits: randomInt(0, 100),
    auraCreditsSpent: randomInt(0, 40),
    activeGlow: user.activeGlow || 'none',
    refreshTokens: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    lastLogin: nowIso,
    dataSource: source,
    dataBatchId: batchId
  })), { ordered: false });
};

const buildCompanyPosts = (
  company: CompanyProfileLite,
  count: number,
  source: string,
  batchId: string,
  lookbackDays: number
): any[] => {
  const now = Date.now();
  const posts: any[] = [];
  for (let i = 0; i < count; i += 1) {
    const postId = `${batchId}-company-post-${String(i + 1).padStart(4, '0')}`;
    const content = `${pickOne(POST_OPENERS)}\n\n${pickOne(POST_OUTCOMES)}\n\nTeam: ${company.name}`;
    const hashtags = pickManyUnique(POST_HASHTAGS, randomInt(2, 4));
    posts.push({
      id: postId,
      type: 'post',
      author: {
        id: company.id,
        firstName: company.name,
        lastName: '',
        name: company.name,
        handle: company.handle,
        avatar: company.avatar,
        avatarType: company.avatarType,
        activeGlow: 'none',
        type: 'company'
      },
      authorId: company.id,
      ownerId: company.id,
      ownerType: 'company',
      content,
      taggedUserIds: [],
      hashtags,
      energy: pickOne(['⚡ High Energy', '💡 Deep Dive', '🌿 Calm']),
      radiance: randomInt(20, 120),
      timestamp: now - randomInt(0, lookbackDays * ONE_DAY_MS),
      visibility: 'public',
      reactions: {},
      reactionUsers: {},
      userReactions: [],
      comments: [],
      commentCount: 0,
      isBoosted: Math.random() < 0.2,
      viewCount: randomInt(200, 9000),
      dataSource: source,
      dataBatchId: batchId
    });
  }
  return posts;
};

const buildAdDocs = (
  company: CompanyProfileLite,
  count: number,
  source: string,
  batchId: string
): any[] => {
  const now = Date.now();
  const ads: any[] = [];
  for (let i = 0; i < count; i += 1) {
    const adId = `${batchId}-company-ad-${String(i + 1).padStart(4, '0')}`;
    ads.push({
      id: adId,
      ownerId: company.id,
      ownerType: 'company',
      ownerName: company.name,
      ownerAvatar: company.avatar,
      ownerAvatarType: company.avatarType,
      ownerActiveGlow: 'none',
      headline: pickOne(AD_HEADLINES),
      description: pickOne(AD_DESCRIPTIONS),
      mediaUrl: `https://picsum.photos/1200/900?random=${encodeURIComponent(adId)}`,
      mediaType: 'image',
      ctaText: pickOne(AD_CTA),
      ctaLink: `https://aura.local/company/${encodeURIComponent(company.id)}`,
      ctaPositionX: 50,
      ctaPositionY: 84,
      campaignWhy: pickOne([
        'safe_clicks_conversions',
        'lead_capture_no_exit',
        'email_growth',
        'book_more_calls',
        'gate_high_intent_downloads'
      ]),
      leadCapture: { type: 'none' },
      placement: pickOne(['feed', 'sidebar', 'story', 'search']),
      isSponsored: true,
      status: 'active',
      expiryDate: now + randomInt(20, 90) * ONE_DAY_MS,
      timestamp: now - randomInt(0, 60 * ONE_DAY_MS),
      reactions: {},
      reactionUsers: {},
      hashtags: pickManyUnique(POST_HASHTAGS, randomInt(1, 3)),
      dataSource: source,
      dataBatchId: batchId
    });
  }
  return ads;
};

const buildAdAnalyticsDocs = (ads: AdLite[], companyId: string, source: string, batchId: string): any[] => ads.map((ad) => {
  const impressions = randomInt(2000, 70000);
  const clicks = randomInt(80, Math.max(100, Math.floor(impressions * 0.08)));
  const engagement = randomInt(clicks, Math.max(clicks, Math.floor(impressions * 0.2)));
  const conversions = randomInt(5, Math.max(8, Math.floor(clicks * 0.4)));
  return {
    adId: ad.id,
    ownerId: companyId,
    ownerType: 'company',
    impressions,
    clicks,
    ctr: Number(((clicks / Math.max(1, impressions)) * 100).toFixed(2)),
    reach: randomInt(Math.floor(impressions * 0.5), impressions),
    engagement,
    conversions,
    spend: Number((impressions * (0.004 + Math.random() * 0.02)).toFixed(2)),
    lastUpdated: Date.now(),
    dataSource: source,
    dataBatchId: batchId
  };
});

const buildAdAnalyticsDailyOps = (ads: AdLite[], companyId: string, source: string, batchId: string): Array<Record<string, unknown>> => {
  const ops: Array<Record<string, unknown>> = [];
  const now = Date.now();
  const days = 14;
  ads.forEach((ad) => {
    for (let day = days - 1; day >= 0; day -= 1) {
      const date = new Date(now - day * ONE_DAY_MS);
      date.setUTCHours(0, 0, 0, 0);
      const dateKey = date.toISOString().slice(0, 10);
      const impressions = randomInt(120, 2200);
      const clicks = randomInt(4, Math.max(6, Math.floor(impressions * 0.07)));
      const engagement = randomInt(clicks, Math.max(clicks, Math.floor(impressions * 0.2)));
      const conversions = randomInt(0, Math.max(2, Math.floor(clicks * 0.3)));
      ops.push({
        updateOne: {
          filter: { adId: ad.id, dateKey },
          update: {
            $setOnInsert: {
              adId: ad.id,
              ownerId: companyId,
              ownerType: 'company',
              dateKey,
              impressions,
              clicks,
              engagement,
              conversions,
              spend: Number((impressions * (0.004 + Math.random() * 0.02)).toFixed(2)),
              uniqueReach: randomInt(Math.floor(impressions * 0.5), impressions),
              createdAt: date.getTime(),
              updatedAt: date.getTime() + randomInt(1000, 8 * 60 * 60 * 1000),
              dataSource: source,
              dataBatchId: batchId
            }
          },
          upsert: true
        }
      });
    }
  });
  return ops;
};

const prepareParticipantPool = async (
  db: Db,
  companyId: string,
  options: CliOptions
): Promise<ParticipantPoolResult> => {
  const requiredPoolSize = Math.max(options.subscribers, options.likesPerPost * 2, options.commentsPerPost * 2, 40);
  const sampledUsersRaw = await db.collection('users').aggregate([
    { $match: { id: { $exists: true, $type: 'string', $ne: companyId }, legacyArchived: { $ne: true } } },
    { $project: { id: 1, firstName: 1, lastName: 1, name: 1, handle: 1, avatar: 1, avatarType: 1, activeGlow: 1, email: 1 } },
    { $sample: { size: requiredPoolSize } }
  ]).toArray();
  const sampledUsers = sampledUsersRaw.map((user) => buildUserLite(user));

  const missingPool = Math.max(0, options.subscribers - sampledUsers.length);
  const simulationParticipants = buildParticipantUsers(missingPool, options.source, options.batchId);
  if (!options.dryRun && simulationParticipants.length > 0) {
    await insertParticipantUsers(db, simulationParticipants, options.source, options.batchId);
  }

  const userPool = [...sampledUsers, ...simulationParticipants];
  const userPoolIds = uniqueIds(userPool.map((user) => user.id));

  return {
    userPool,
    userPoolIds,
    participantsCreated: simulationParticipants.length
  };
};

const provisionCompanySubscribers = async (
  db: Db,
  company: CompanyProfileLite,
  userPoolIds: string[],
  desiredAdditions: number,
  dryRun: boolean
): Promise<SubscriberProvisionResult> => {
  const existingSubscribers = uniqueIds(company.subscribers);
  const subscriberCandidates = userPoolIds.filter((id) => !existingSubscribers.includes(id));
  const subscriberSelections = pickManyUnique(subscriberCandidates, Math.max(0, desiredAdditions));
  const mergedSubscribers = uniqueIds([...existingSubscribers, ...subscriberSelections]);

  if (!dryRun) {
    await db.collection('companies').updateOne(
      { id: company.id },
      {
        $set: {
          subscribers: mergedSubscribers,
          subscriberCount: mergedSubscribers.length,
          updatedAt: new Date()
        }
      }
    );

    if (subscriberSelections.length > 0) {
      await db.collection('users').updateMany(
        { id: { $in: subscriberSelections } },
        {
          $addToSet: { subscribedCompanyIds: company.id } as any,
          $set: { updatedAt: new Date().toISOString() } as any
        }
      );
    }
  }

  return { subscribersAdded: subscriberSelections.length };
};

interface TargetPostsResult {
  targetPosts: PostLite[];
  postsCreated: number;
}

interface PostReactionResult {
  likesApplied: number;
}

interface PostCommentResult {
  commentsInserted: number;
}

interface TargetAdsResult {
  targetAds: AdLite[];
  adsCreated: number;
}

interface AdAnalyticsSummaryResult {
  analyticsCreated: number;
}

interface AdAnalyticsDailyResult {
  analyticsDailyUpserts: number;
}

const buildTargetPosts = async (
  db: Db,
  company: CompanyProfileLite,
  options: CliOptions
): Promise<TargetPostsResult> => {
  const existingPostsRaw = await db.collection('posts')
    .find({ ownerId: company.id, ownerType: 'company' })
    .sort({ timestamp: -1 })
    .limit(options.posts)
    .toArray();
  const existingPosts: PostLite[] = existingPostsRaw.map((post) => ({
    id: String(post.id),
    reactions: (post.reactions || {}) as Record<string, number>,
    reactionUsers: (post.reactionUsers || {}) as Record<string, string[]>,
    commentCount: typeof post.commentCount === 'number' ? post.commentCount : 0,
    radiance: typeof post.radiance === 'number' ? post.radiance : 0,
    timestamp: typeof post.timestamp === 'number' ? post.timestamp : Date.now()
  }));

  const neededPosts = Math.max(0, options.posts - existingPosts.length);
  const createdPosts = buildCompanyPosts(company, neededPosts, options.source, options.batchId, options.lookbackDays);
  if (!options.dryRun && createdPosts.length > 0) {
    await db.collection('posts').insertMany(createdPosts, { ordered: false });
  }

  const targetPosts: PostLite[] = [
    ...existingPosts,
    ...createdPosts.map((post) => ({
      id: post.id,
      reactions: post.reactions,
      reactionUsers: post.reactionUsers,
      commentCount: post.commentCount,
      radiance: post.radiance,
      timestamp: post.timestamp
    }))
  ].slice(0, options.posts);

  return {
    targetPosts,
    postsCreated: createdPosts.length
  };
};

const applyPostReactions = async (
  db: Db,
  targetPosts: PostLite[],
  userPoolIds: string[],
  options: CliOptions
): Promise<PostReactionResult> => {
  let likesApplied = 0;
  const postReactionUpdates: Array<Record<string, unknown>> = [];
  targetPosts.forEach((post) => {
    const baseLikes = randomInt(Math.max(1, Math.floor(options.likesPerPost * 0.7)), Math.max(2, Math.ceil(options.likesPerPost * 1.3)));
    const likerIds = pickManyUnique(userPoolIds, baseLikes);
    const currentHeart = Array.isArray(post.reactionUsers?.['❤️']) ? post.reactionUsers?.['❤️'] : [];
    const mergedHeart = uniqueIds([...currentHeart, ...likerIds]);
    likesApplied += mergedHeart.length;

    const nextReactions = { ...(post.reactions || {}), '❤️': mergedHeart.length };
    const nextReactionUsers = { ...(post.reactionUsers || {}), '❤️': mergedHeart };
    const nextRadiance = Math.max(Number(post.radiance || 0), mergedHeart.length * 2 + randomInt(10, 90));

    postReactionUpdates.push({
      updateOne: {
        filter: { id: post.id },
        update: {
          $set: {
            reactions: nextReactions,
            reactionUsers: nextReactionUsers,
            radiance: nextRadiance
          }
        }
      }
    });
  });

  if (!options.dryRun && postReactionUpdates.length > 0) {
    await db.collection('posts').bulkWrite(postReactionUpdates as any, { ordered: false });
  }

  return { likesApplied };
};

const applyPostComments = async (
  db: Db,
  targetPosts: PostLite[],
  userPool: UserProfileLite[],
  options: CliOptions
): Promise<PostCommentResult> => {
  let commentsInserted = 0;
  const commentDocs: any[] = [];
  const postCommentOps: Array<Record<string, unknown>> = [];
  targetPosts.forEach((post) => {
    const count = randomInt(Math.max(0, Math.floor(options.commentsPerPost * 0.6)), Math.max(0, Math.ceil(options.commentsPerPost * 1.4)));
    if (count <= 0) return;
    const commenters = pickManyUnique(userPool, count);
    commenters.forEach((commenter, index) => {
      commentsInserted += 1;
      commentDocs.push({
        id: `comment-${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${index}`,
        postId: post.id,
        author: {
          id: commenter.id,
          firstName: commenter.firstName,
          lastName: commenter.lastName,
          name: commenter.name,
          handle: commenter.handle,
          avatar: commenter.avatar,
          avatarType: commenter.avatarType,
          activeGlow: commenter.activeGlow || 'none'
        },
        text: pickOne(COMMENT_TEXTS),
        timestamp: Math.max(Number(post.timestamp || Date.now()), Date.now() - randomInt(0, 30 * ONE_DAY_MS)),
        parentId: null,
        reactions: {},
        reactionUsers: {},
        userReactions: [],
        taggedUserIds: []
      });
    });

    postCommentOps.push({
      updateOne: {
        filter: { id: post.id },
        update: {
          $inc: { commentCount: count },
          $set: { updatedAt: Date.now() }
        }
      }
    });
  });

  if (!options.dryRun) {
    if (commentDocs.length > 0) {
      await db.collection('comments').insertMany(commentDocs, { ordered: false });
    }
    if (postCommentOps.length > 0) {
      await db.collection('posts').bulkWrite(postCommentOps as any, { ordered: false });
    }
  }

  return { commentsInserted };
};

const provisionPostsAndEngagement = async (
  db: Db,
  company: CompanyProfileLite,
  userPool: UserProfileLite[],
  userPoolIds: string[],
  options: CliOptions
): Promise<PostEngagementResult> => {
  const targetPostsResult = await buildTargetPosts(db, company, options);
  const reactionsResult = await applyPostReactions(db, targetPostsResult.targetPosts, userPoolIds, options);
  const commentsResult = await applyPostComments(db, targetPostsResult.targetPosts, userPool, options);

  return {
    postsCreated: targetPostsResult.postsCreated,
    likesApplied: reactionsResult.likesApplied,
    commentsInserted: commentsResult.commentsInserted
  };
};

const buildTargetAds = async (
  db: Db,
  company: CompanyProfileLite,
  options: CliOptions
): Promise<TargetAdsResult> => {
  const existingAdsRaw = await db.collection('ads')
    .find({ ownerId: company.id, ownerType: 'company' })
    .project({ id: 1 })
    .limit(options.ads)
    .toArray();
  const existingAds: AdLite[] = existingAdsRaw
    .map((ad) => ({ id: String(ad.id || '') }))
    .filter((ad) => ad.id.length > 0);
  const adsToCreate = Math.max(0, options.ads - existingAds.length);
  const createdAds = buildAdDocs(company, adsToCreate, options.source, options.batchId);
  if (!options.dryRun && createdAds.length > 0) {
    await db.collection('ads').insertMany(createdAds, { ordered: false });
  }

  return {
    targetAds: [
      ...existingAds,
      ...createdAds.map((ad) => ({ id: ad.id }))
    ].slice(0, options.ads),
    adsCreated: createdAds.length
  };
};

const ensureAdAnalyticsSummary = async (
  db: Db,
  targetAds: AdLite[],
  company: CompanyProfileLite,
  options: CliOptions
): Promise<AdAnalyticsSummaryResult> => {
  const existingAnalytics = await db.collection('adAnalytics')
    .find({ adId: { $in: targetAds.map((ad) => ad.id) } })
    .project({ adId: 1 })
    .toArray();
  const existingAnalyticsIds = new Set(existingAnalytics.map((item: any) => String(item.adId)));
  const analyticsToCreate = targetAds.filter((ad) => !existingAnalyticsIds.has(ad.id));
  const analyticsDocs = buildAdAnalyticsDocs(analyticsToCreate, company.id, options.source, options.batchId);
  if (!options.dryRun && analyticsDocs.length > 0) {
    await db.collection('adAnalytics').insertMany(analyticsDocs, { ordered: false });
  }
  return { analyticsCreated: analyticsDocs.length };
};

const upsertAdAnalyticsDaily = async (
  db: Db,
  targetAds: AdLite[],
  company: CompanyProfileLite,
  options: CliOptions
): Promise<AdAnalyticsDailyResult> => {
  const dailyOps = buildAdAnalyticsDailyOps(targetAds, company.id, options.source, options.batchId);
  if (!options.dryRun && dailyOps.length > 0) {
    await db.collection('adAnalyticsDaily').bulkWrite(dailyOps as any, { ordered: false });
  }
  return { analyticsDailyUpserts: dailyOps.length };
};

const provisionAdsAndAnalytics = async (
  db: Db,
  company: CompanyProfileLite,
  options: CliOptions
): Promise<AdProvisionResult> => {
  const targetAdsResult = await buildTargetAds(db, company, options);
  const analyticsSummaryResult = await ensureAdAnalyticsSummary(db, targetAdsResult.targetAds, company, options);
  const analyticsDailyResult = await upsertAdAnalyticsDaily(db, targetAdsResult.targetAds, company, options);

  return {
    adsCreated: targetAdsResult.adsCreated,
    analyticsCreated: analyticsSummaryResult.analyticsCreated,
    analyticsDailyUpserts: analyticsDailyResult.analyticsDailyUpserts,
    activeAdsCount: targetAdsResult.targetAds.length
  };
};

const ensureCompanyAdSubscription = async (
  db: Db,
  companyId: string,
  activeAdsCount: number,
  options: CliOptions
): Promise<SubscriptionProvisionResult> => {
  const now = Date.now();
  const activeSubscription = await db.collection('adSubscriptions').findOne({
    ownerId: companyId,
    ownerType: 'company',
    status: 'active'
  });

  if (options.dryRun) {
    return {
      companySubscriptionCreated: !activeSubscription,
      companySubscriptionUpdated: Boolean(activeSubscription)
    };
  }

  if (!activeSubscription) {
    const plan = AD_PLANS['pkg-enterprise'];
    const durationDays = typeof plan.durationDays === 'number' ? plan.durationDays : 30;
    const periodStart = now;
    const periodEnd = now + durationDays * ONE_DAY_MS;
    await db.collection('adSubscriptions').insertOne({
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      userId: companyId,
      ownerId: companyId,
      ownerType: 'company',
      packageId: plan.id,
      packageName: plan.name,
      status: 'active',
      startDate: now,
      durationDays,
      endDate: now + 30 * ONE_DAY_MS,
      nextBillingDate: now + 30 * ONE_DAY_MS,
      paypalSubscriptionId: null,
      paypalOrderId: null,
      paymentReferenceKey: `manual-${options.batchId}-${companyId}`,
      periodStart,
      periodEnd,
      adsUsed: Math.min(activeAdsCount, plan.adLimit),
      impressionsUsed: randomInt(500, 5000),
      adLimit: plan.adLimit,
      impressionLimit: plan.impressionLimit,
      createdAt: now,
      updatedAt: now
    });
    return { companySubscriptionCreated: true, companySubscriptionUpdated: false };
  }

  const adLimit = typeof activeSubscription.adLimit === 'number' ? activeSubscription.adLimit : activeAdsCount;
  const nextAdsUsed = Math.min(adLimit, activeAdsCount);
  await db.collection('adSubscriptions').updateOne(
    { id: activeSubscription.id },
    {
      $set: {
        adsUsed: nextAdsUsed,
        updatedAt: now,
        ownerId: companyId,
        ownerType: 'company',
        userId: companyId
      }
    }
  );
  return { companySubscriptionCreated: false, companySubscriptionUpdated: true };
};

const persistBatchTracking = async (
  db: Db,
  options: CliOptions,
  companyId: string,
  summary: ProvisionSummary
): Promise<void> => {
  if (options.dryRun) return;
  await db.collection('data_batches').updateOne(
    { dataSource: options.source, batchId: options.batchId },
    {
      $set: {
        dataSource: options.source,
        batchId: options.batchId,
        scale: 'targeted-company-provisioning',
        companyId,
        subscribersAdded: summary.subscribersAdded,
        postsCreated: summary.postsCreated,
        likesApplied: summary.likesApplied,
        commentsInserted: summary.commentsInserted,
        adsCreated: summary.adsCreated,
        analyticsCreated: summary.analyticsCreated,
        analyticsDailyUpserts: summary.analyticsDailyUpserts,
        participantsCreated: summary.participantsCreated,
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
};

const runProvisioning = async (options: CliOptions): Promise<ProvisionSummary> => {
  await connectDB();
  if (!isDBConnected()) throw new Error('Database connection is unavailable.');
  const db = getDB();

  const companyDoc = await db.collection('companies').findOne({ id: options.companyId });
  if (!companyDoc) {
    throw new Error(`Company "${options.companyId}" was not found.`);
  }
  const company = buildCompanyLite(companyDoc, options.companyId);
  const participantPool = await prepareParticipantPool(db, company.id, options);
  const subscriberProvision = await provisionCompanySubscribers(
    db,
    company,
    participantPool.userPoolIds,
    options.subscribers,
    options.dryRun
  );
 
  const adProvision = await provisionAdsAndAnalytics(db, company, options);
  const subscriptionProvision = await ensureCompanyAdSubscription(db, company.id, adProvision.activeAdsCount, options);

  const summary: ProvisionSummary = {
    participantsCreated: participantPool.participantsCreated,
    subscribersAdded: subscriberProvision.subscribersAdded,
    postsCreated: 0,
    likesApplied: 0,
    commentsInserted: 0,
    adsCreated: 0,
    analyticsCreated: 0,
    analyticsDailyUpserts: 0,
    companySubscriptionCreated: false,
    companySubscriptionUpdated: false
  };

  await persistBatchTracking(db, options, company.id, summary);
  return summary;
};

const main = async (): Promise<void> => {
  const options = parseCliOptions();
  console.log(options.dryRun ? '🔎 Previewing company engagement provisioning...' : '🚀 Provisioning company engagement...');
  console.log(`Company: ${options.companyId}`);
  console.log(`Source: ${options.source}`);
  console.log(`Batch: ${options.batchId}`);

  try {
    const summary = await runProvisioning(options);
    console.log(options.dryRun ? '✅ Preview complete.' : '✅ Provisioning complete.');
    console.log(`Participants created: ${summary.participantsCreated}`);
    console.log(`Subscribers added: ${summary.subscribersAdded}`);
    console.log(`Posts created: ${summary.postsCreated}`);
    console.log(`Likes applied: ${summary.likesApplied}`);
    console.log(`Comments inserted: ${summary.commentsInserted}`);
    console.log(`Ads created: ${summary.adsCreated}`);
    console.log(`Ad analytics created: ${summary.analyticsCreated}`);
    console.log(`Ad analytics daily upserts: ${summary.analyticsDailyUpserts}`);
    console.log(`Company subscription created: ${summary.companySubscriptionCreated ? 'yes' : 'no'}`);
    console.log(`Company subscription updated: ${summary.companySubscriptionUpdated ? 'yes' : 'no'}`);
  } finally {
    await closeDB();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Company engagement provisioning failed:', error);
    process.exitCode = 1;
  });
}
