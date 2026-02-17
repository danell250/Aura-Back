import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { getHashtagsFromText } from '../utils/hashtagUtils';
import { createNotificationInDB } from './notificationsController';
import { uploadToS3 } from '../utils/s3Upload';
import { transformUser } from '../utils/userUtils';
import { AD_PLANS } from '../constants/adPlans';
import { MediaItem, MediaItemMetrics } from '../types';
import { resolveIdentityActor } from '../utils/identityUtils';

const POSTS_COLLECTION = 'posts';
const USERS_COLLECTION = 'users';
const COMPANIES_COLLECTION = 'companies';
const AD_SUBSCRIPTIONS_COLLECTION = 'adSubscriptions';

const POST_UPDATE_ALLOWLIST = new Set<string>([
  'content',
  'energy',
  'visibility',
  'timeCapsuleTitle'
]);

const sanitizePostUpdates = (incoming: unknown): Record<string, unknown> => {
  if (!incoming || typeof incoming !== 'object') return {};
  const candidate = incoming as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(candidate)) {
    if (!POST_UPDATE_ALLOWLIST.has(key)) continue;
    sanitized[key] = value;
  }

  if (typeof sanitized.content === 'string') {
    const content = sanitized.content.trim();
    if (content.length === 0 || content.length > 12000) {
      delete sanitized.content;
    } else {
      sanitized.content = content;
    }
  } else {
    delete sanitized.content;
  }

  if (typeof sanitized.energy === 'string') {
    const energy = sanitized.energy.trim();
    sanitized.energy = energy ? energy.slice(0, 120) : '🪐 NEUTRAL';
  } else {
    delete sanitized.energy;
  }

  if (typeof sanitized.visibility !== 'string') {
    delete sanitized.visibility;
  }

  if (typeof sanitized.timeCapsuleTitle === 'string') {
    const title = sanitized.timeCapsuleTitle.trim();
    sanitized.timeCapsuleTitle = title.slice(0, 220);
  } else {
    delete sanitized.timeCapsuleTitle;
  }

  return sanitized;
};

interface PostSseClient {
  id: string;
  res: Response;
}

const postSseClients: PostSseClient[] = [];

const broadcastPostViewUpdate = (payload: { postId: string; viewCount: number }) => {
  if (!postSseClients.length) return;
  const msg = `event: post_view\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of postSseClients) {
    client.res.write(msg);
  }
};

const buildCompanyAuthorMatchExpr = () => ({
  $or: [
    { $eq: ['$author.type', 'company'] },
    { $eq: ['$ownerType', 'company'] },
    { $gt: [{ $size: '$authorCompanyDetails' }, 0] }
  ]
});

interface ViewerAccessContext {
  actorType: 'anonymous' | 'user' | 'company';
  actorId?: string;
  acquaintances: string[];
  subscribedCompanyIds: string[];
  memberCompanyIds: string[];
  ownedCompanyIds: string[];
  accessibleCompanyIds: string[];
}

type ViewerActor = { type: 'user' | 'company'; id: string };

const readHeaderString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
};

const resolveViewerActor = async (req: Request): Promise<ViewerActor | null | undefined> => {
  const authenticatedUserId = (req as any).user?.id as string | undefined;
  if (!authenticatedUserId) return undefined;

  const headerOwnerType = readHeaderString(req.headers['x-identity-type']);
  const headerOwnerId = readHeaderString(req.headers['x-identity-id']);
  const queryOwnerType = typeof req.query.ownerType === 'string' ? req.query.ownerType : undefined;
  const queryOwnerId = typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined;

  const requestedOwnerType = headerOwnerType || queryOwnerType;
  const requestedOwnerId = headerOwnerId || queryOwnerId;
  const hasExplicitIdentity = Boolean(requestedOwnerType || requestedOwnerId);

  if (!hasExplicitIdentity) {
    return { type: 'user', id: authenticatedUserId };
  }

  if (requestedOwnerType === 'company' && !requestedOwnerId) {
    return null;
  }

  const actor = await resolveIdentityActor(
    authenticatedUserId,
    {
      ownerType: requestedOwnerType,
      ownerId: requestedOwnerId,
    },
    req.headers
  );

  if (!actor) return null;
  return actor;
};

const getViewerAccessContext = async (db: any, viewerActor?: ViewerActor): Promise<ViewerAccessContext> => {
  if (!viewerActor) {
    return {
      actorType: 'anonymous',
      actorId: undefined,
      acquaintances: [],
      subscribedCompanyIds: [],
      memberCompanyIds: [],
      ownedCompanyIds: [],
      accessibleCompanyIds: []
    };
  }

  if (viewerActor.type === 'company') {
    return {
      actorType: 'company',
      actorId: viewerActor.id,
      acquaintances: [],
      subscribedCompanyIds: [],
      memberCompanyIds: [viewerActor.id],
      ownedCompanyIds: [viewerActor.id],
      accessibleCompanyIds: [viewerActor.id],
    };
  }

  const viewerUserId = viewerActor.id;
  const [viewer, memberships, ownedCompanies] = await Promise.all([
    db.collection(USERS_COLLECTION).findOne(
      { id: viewerUserId },
      { projection: { acquaintances: 1, subscribedCompanyIds: 1 } }
    ),
    db.collection('company_members')
      .find({ userId: viewerUserId })
      .project({ companyId: 1 })
      .toArray(),
    db.collection('companies')
      .find({ ownerId: viewerUserId })
      .project({ id: 1 })
      .toArray()
  ]);

  const acquaintances = Array.isArray(viewer?.acquaintances) ? viewer.acquaintances : [];
  const subscribedCompanyIds = Array.isArray(viewer?.subscribedCompanyIds) ? viewer.subscribedCompanyIds : [];
  const memberCompanyIds = memberships
    .map((m: any) => m?.companyId)
    .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
  const ownedCompanyIds = ownedCompanies
    .map((c: any) => c?.id)
    .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

  const accessibleCompanyIds = Array.from(new Set([...subscribedCompanyIds, ...memberCompanyIds, ...ownedCompanyIds]));

  return {
    actorType: 'user',
    actorId: viewerUserId,
    acquaintances,
    subscribedCompanyIds,
    memberCompanyIds,
    ownedCompanyIds,
    accessibleCompanyIds
  };
};

const buildVisibilityConditions = (context: ViewerAccessContext): any[] => {
  const conditions: any[] = [
    { visibility: { $exists: false } },
    { visibility: 'public' }
  ];

  if (context.actorType === 'anonymous' || !context.actorId) {
    return conditions;
  }

  const viewerIdentityId = context.actorId;
  const viewerIsCompany = context.actorType === 'company';

  conditions.push(
    { visibility: 'private', 'author.id': viewerIdentityId },
    {
      visibility: 'acquaintances',
      'author.id': viewerIdentityId,
      ...(viewerIsCompany ? { 'author.type': 'company' } : {}),
    },
    { visibility: 'subscribers', 'author.id': viewerIdentityId }
  );

  if (context.memberCompanyIds.length > 0) {
    conditions.push({
      visibility: 'private',
      'author.id': { $in: context.memberCompanyIds }
    });
  }

  if (context.acquaintances.length > 0) {
    conditions.push({
      visibility: 'acquaintances',
      'author.id': { $in: context.acquaintances }
    });
  }

  if (context.accessibleCompanyIds.length > 0) {
    conditions.push({
      visibility: 'subscribers',
      'author.id': { $in: context.accessibleCompanyIds }
    });
    // Backward compatibility for older company posts saved as acquaintances visibility.
    conditions.push({
      visibility: 'acquaintances',
      'author.id': { $in: context.accessibleCompanyIds },
      'author.type': 'company'
    });
  }

  return conditions;
};

const buildAuthorPrivacyConditions = (context: ViewerAccessContext): any[] => {
  const conditions: any[] = [
    { authorType: 'user', 'authorDetails.isPrivate': { $ne: true } },
    { authorType: 'company', 'authorDetails.isPrivate': { $ne: true } }
  ];

  if (context.actorType === 'anonymous' || !context.actorId) {
    return conditions;
  }

  if (context.actorType === 'user') {
    const viewerUserId = context.actorId;
    conditions.push(
      { authorType: 'user', 'author.id': viewerUserId },
      { authorType: 'company', 'authorDetails.ownerId': viewerUserId },
      { authorType: 'company', 'author.id': viewerUserId }
    );
  } else {
    conditions.push({ authorType: 'company', 'author.id': context.actorId });
  }

  if (context.acquaintances.length > 0) {
    conditions.push({
      authorType: 'user',
      'author.id': { $in: context.acquaintances }
    });
  }

  if (context.accessibleCompanyIds.length > 0) {
    conditions.push({
      authorType: 'company',
      'author.id': { $in: context.accessibleCompanyIds }
    });
  }

  return conditions;
};

interface LiveDashboardTotals {
  totalPosts: number;
  totalViews: number;
  boostedPosts: number;
  totalRadiance: number;
}

interface LiveDashboardTopPost {
  id: string;
  preview: string;
  views: number;
  timestamp: number;
  isBoosted: boolean;
  radiance: number;
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formatHourLabel = (hour: number): string => {
  const normalized = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 12;
  const meridiem = normalized >= 12 ? 'PM' : 'AM';
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${hour12}:00 ${meridiem}`;
};

const deriveTimingHints = (topPosts: LiveDashboardTopPost[]): { bestTimeToPost: string; peakActivity: string } => {
  if (!topPosts.length) {
    return {
      bestTimeToPost: 'Wednesday 6:00 PM',
      peakActivity: 'Weekends'
    };
  }

  const dayWeights = new Array<number>(7).fill(0);
  const hourWeights = new Array<number>(24).fill(0);

  for (const post of topPosts) {
    const date = new Date(post.timestamp || Date.now());
    const weight = Math.max(1, post.views || 1);
    dayWeights[date.getDay()] += weight;
    hourWeights[date.getHours()] += weight;
  }

  const bestDay = dayWeights.indexOf(Math.max(...dayWeights));
  const bestHour = hourWeights.indexOf(Math.max(...hourWeights));

  return {
    bestTimeToPost: `${dayNames[bestDay]} ${formatHourLabel(bestHour)}`,
    peakActivity: bestDay === 0 || bestDay === 6 ? 'Weekends' : `${dayNames[bestDay]}s`
  };
};

const deriveReachVelocity = (avgViews: number): string => {
  if (avgViews >= 1000) return 'Very High';
  if (avgViews >= 300) return 'High';
  if (avgViews >= 100) return 'Rising';
  if (avgViews > 0) return 'Growing';
  return 'Low';
};

const buildLiveNeuralInsights = (
  totals: LiveDashboardTotals,
  topPosts: LiveDashboardTopPost[],
  adImpressions: number,
  adClicks: number,
  country?: string
) => {
  const totalViews = Math.max(0, totals.totalViews || 0);
  const totalPosts = Math.max(0, totals.totalPosts || 0);
  const boostedPosts = Math.max(0, totals.boostedPosts || 0);
  const totalRadiance = Math.max(0, totals.totalRadiance || 0);

  const boostRatio = totalPosts > 0 ? boostedPosts / totalPosts : 0;
  const avgViewsPerPost = totalPosts > 0 ? totalViews / totalPosts : 0;
  const engagementRateValue = totalViews > 0 ? (totalRadiance / totalViews) * 100 : 0;
  const retentionScore = Math.max(20, Math.min(95, Math.round(40 + boostRatio * 30 + Math.min(25, avgViewsPerPost / 40))));
  const engagementHealthScore = Math.max(1, Math.min(99, Math.round(30 + engagementRateValue * 20 + boostRatio * 25)));
  const ctrValue = adImpressions > 0 ? (adClicks / adImpressions) * 100 : 0;
  const conversionScore = Math.max(
    0,
    Math.min(100, Math.round(20 + ctrValue * 12 + engagementRateValue * 5 + boostRatio * 20))
  );
  const timing = deriveTimingHints(topPosts);
  const topLocations = country && country.trim() ? [country.trim()] : ['Global'];

  return {
    engagementHealth: `${engagementHealthScore}%`,
    reachVelocity: deriveReachVelocity(avgViewsPerPost),
    audienceBehavior: {
      retention: retentionScore >= 80 ? 'High' : retentionScore >= 55 ? 'Moderate' : 'Emerging',
      engagementRate: `${engagementRateValue.toFixed(1)}%`,
      topLocations
    },
    timingOptimization: timing,
    conversionInsights: {
      clickThroughRate: `${ctrValue.toFixed(1)}%`,
      conversionScore
    }
  };
};

const buildAuthorPostMatch = (authorId: string, authorType: 'user' | 'company') => {
  if (authorType === 'company') {
    return {
      'author.id': authorId,
      $or: [
        { 'author.type': 'company' },
        { ownerType: 'company' },
        { $and: [{ 'author.type': { $exists: false } }, { ownerType: 'company' }] }
      ]
    };
  }

  return {
    'author.id': authorId,
    $or: [
      { 'author.type': 'user' },
      { 'author.type': { $exists: false } },
    ],
  };
};

const buildAuthorAdAnalyticsMatch = (authorId: string, authorType: 'user' | 'company') => {
  if (authorType === 'company') {
    return {
      $or: [
        { ownerId: authorId, ownerType: 'company' },
        { userId: authorId, ownerType: 'company' }
      ]
    };
  }

  return {
    $or: [
      { ownerId: authorId, ownerType: 'user' },
      { ownerId: authorId, ownerType: { $exists: false } },
      { userId: authorId }
    ]
  };
};

export const getAuthorInsightsSnapshot = async (
  authorId: string,
  authorType: 'user' | 'company' = 'user'
): Promise<{
  totals: LiveDashboardTotals;
  credits: { balance: number; spent: number };
  profileViews: string[];
  profileViewers: Array<{
    id: string;
    name: string;
    handle: string;
    avatar: string;
    avatarType: 'image' | 'video';
  }>;
  topPosts: LiveDashboardTopPost[];
  neuralInsights: ReturnType<typeof buildLiveNeuralInsights>;
} | null> => {
  if (!authorId) return null;

  const db = getDB();
  const authorPostMatch = buildAuthorPostMatch(authorId, authorType);
  const authorCollection = authorType === 'company' ? COMPANIES_COLLECTION : USERS_COLLECTION;

  const [aggRows, topPosts, owner, adAgg] = await Promise.all([
    db.collection(POSTS_COLLECTION).aggregate([
      { $match: authorPostMatch },
      {
        $group: {
          _id: null,
          totalPosts: { $sum: 1 },
          totalViews: { $sum: { $ifNull: ['$viewCount', 0] } },
          boostedPosts: { $sum: { $cond: [{ $eq: ['$isBoosted', true] }, 1, 0] } },
          totalRadiance: { $sum: { $ifNull: ['$radiance', 0] } }
        }
      }
    ]).toArray(),
    db.collection(POSTS_COLLECTION)
      .find(authorPostMatch)
      .project({ id: 1, content: 1, viewCount: 1, timestamp: 1, isBoosted: 1, radiance: 1 })
      .sort({ viewCount: -1 })
      .limit(5)
      .toArray(),
    db.collection(authorCollection).findOne(
      { id: authorId },
      { projection: { auraCredits: 1, auraCreditsSpent: 1, country: 1, location: 1, profileViews: 1 } }
    ),
    db.collection('adAnalytics').aggregate([
      { $match: buildAuthorAdAnalyticsMatch(authorId, authorType) },
      {
        $group: {
          _id: null,
          totalImpressions: { $sum: { $ifNull: ['$impressions', 0] } },
          totalClicks: { $sum: { $ifNull: ['$clicks', 0] } }
        }
      }
    ]).toArray().then(rows => rows[0] || null)
  ]);

  const agg = aggRows[0];
  const totals: LiveDashboardTotals = {
    totalPosts: agg?.totalPosts ?? 0,
    totalViews: agg?.totalViews ?? 0,
    boostedPosts: agg?.boostedPosts ?? 0,
    totalRadiance: agg?.totalRadiance ?? 0
  };

  const mappedTopPosts: LiveDashboardTopPost[] = topPosts.map((p: any) => ({
    id: p.id,
    preview: (p.content || '').slice(0, 120),
    views: p.viewCount ?? 0,
    timestamp: p.timestamp,
    isBoosted: !!p.isBoosted,
    radiance: p.radiance ?? 0
  }));

  const neuralInsights = buildLiveNeuralInsights(
    totals,
    mappedTopPosts,
    adAgg?.totalImpressions ?? 0,
    adAgg?.totalClicks ?? 0,
    owner?.country || owner?.location
  );

  const profileViewIds = Array.from(
    new Set(
      (Array.isArray(owner?.profileViews) ? owner.profileViews : [])
        .map((id: unknown) => String(id || '').trim())
        .filter((id: string) => id.length > 0)
    )
  );

  let profileViewers: Array<{
    id: string;
    name: string;
    handle: string;
    avatar: string;
    avatarType: 'image' | 'video';
  }> = [];

  if (profileViewIds.length > 0) {
    const viewerDocs = await db.collection(USERS_COLLECTION)
      .find({ id: { $in: profileViewIds } })
      .project({ id: 1, name: 1, handle: 1, avatar: 1, avatarType: 1 })
      .toArray();

    const viewerById = new Map<string, any>();
    for (const viewer of viewerDocs) {
      if (viewer?.id) {
        viewerById.set(String(viewer.id), viewer);
      }
    }

    profileViewers = profileViewIds.map((viewerId) => {
      const viewer = viewerById.get(viewerId);
      return {
        id: viewerId,
        name: viewer?.name || 'Aura member',
        handle: viewer?.handle || '@aura',
        avatar: viewer?.avatar || '',
        avatarType: viewer?.avatarType === 'video' ? 'video' : 'image'
      };
    });
  }

  return {
    totals,
    credits: {
      balance: owner?.auraCredits ?? 0,
      spent: owner?.auraCreditsSpent ?? 0
    },
    profileViews: profileViewIds,
    profileViewers,
    topPosts: mappedTopPosts,
    neuralInsights
  };
};

export const emitAuthorInsightsUpdate = async (
  app: any,
  authorId: string,
  authorType: 'user' | 'company' = 'user'
) => {
  try {
    if (!authorId) return;
    const io = app?.get && app.get('io');
    if (!io || typeof io.to !== 'function') {
      console.warn('⚠️ Cannot emit analytics update: Socket.IO (io) not found on app');
      return;
    }

    const snapshot = await getAuthorInsightsSnapshot(authorId, authorType);
    if (!snapshot) return;

    const room = authorType === 'company' ? `company_${authorId}` : authorId;
    const payload = authorType === 'company'
      ? { companyId: authorId, stats: snapshot }
      : { userId: authorId, stats: snapshot };

    console.log(
      `📡 Emitting live analytics update to ${authorType}: ${authorId} (Total views: ${snapshot.totals.totalViews ?? 0})`
    );

    const result = io.to(room).emit('analytics_update', payload);

    if (!result) {
      console.warn(`⚠️ Socket emission to room ${room} returned false`);
    }
  } catch (err) {
    console.error('emitAuthorInsightsUpdate error', err);
  }
};

interface TrendingCandidatePost {
  id: string;
  timestamp?: number;
  author?: {
    id?: string;
  };
  reactions?: Record<string, number>;
  commentCount?: number;
  comments?: unknown[];
  viewCount?: number;
  radiance?: number;
  isBoosted?: boolean;
}

const stableHash = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const toFiniteNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value;
};

const computeTrendingBaseScore = (post: TrendingCandidatePost, now: number): number => {
  const reactions = Object.values(post.reactions || {}).reduce((sum, value) => {
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const commentCount = Math.max(
    0,
    toFiniteNumber(post.commentCount) || (Array.isArray(post.comments) ? post.comments.length : 0)
  );
  const viewCount = Math.max(0, toFiniteNumber(post.viewCount));
  const radiance = Math.max(0, toFiniteNumber(post.radiance));
  const boostBonus = post.isBoosted ? 5 : 0;
  const createdAt = toFiniteNumber(post.timestamp) || now;
  const ageHours = Math.max(0, (now - createdAt) / (1000 * 60 * 60));
  const recencyFactor = 1 / (1 + ageHours / 20);
  const freshnessBonus = ageHours <= 2 ? 2.5 : ageHours <= 8 ? 1.25 : ageHours <= 24 ? 0.4 : 0;

  const engagementRaw =
    reactions +
    commentCount * 2.2 +
    Math.sqrt(viewCount) * 0.6 +
    Math.min(40, radiance * 0.35) +
    boostBonus;

  return engagementRaw * recencyFactor + freshnessBonus;
};

const rerankTrendingPostsFair = (
  candidates: TrendingCandidatePost[],
  requiredCount: number
): TrendingCandidatePost[] => {
  if (requiredCount <= 0 || candidates.length <= 1) {
    return candidates.slice(0, Math.max(requiredCount, 0));
  }

  const now = Date.now();
  const remaining = [...candidates];
  const selected: TrendingCandidatePost[] = [];
  const selectedByAuthor = new Map<string, number>();
  const poolByAuthor = new Map<string, number>();

  remaining.forEach((post) => {
    const authorId = post.author?.id || `unknown:${post.id}`;
    poolByAuthor.set(authorId, (poolByAuthor.get(authorId) || 0) + 1);
  });

  // Prevent one author from saturating the top slots while still allowing repeated wins.
  const perAuthorCap = Math.max(2, Math.min(4, Math.ceil(requiredCount / 12)));

  while (remaining.length > 0 && selected.length < requiredCount) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const authorId = candidate.author?.id || `unknown:${candidate.id}`;
      const alreadySelected = selectedByAuthor.get(authorId) || 0;
      const remainingSlots = requiredCount - selected.length;

      if (alreadySelected >= perAuthorCap && remaining.length > remainingSlots) {
        continue;
      }

      const authorPoolCount = poolByAuthor.get(authorId) || 1;
      const diversityPenalty = 1 / (1 + alreadySelected * 0.95);
      const explorationBoost = authorPoolCount <= 1 ? 1.14 : authorPoolCount === 2 ? 1.08 : 1;
      const tieBreaker = (stableHash(candidate.id) % 1000) / 1_000_000;
      const score =
        computeTrendingBaseScore(candidate, now) * diversityPenalty * explorationBoost + tieBreaker;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      bestIndex = 0;
      bestScore = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < remaining.length; i++) {
        const score = computeTrendingBaseScore(remaining[i], now);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
    }

    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    const pickedAuthorId = picked.author?.id || `unknown:${picked.id}`;
    selectedByAuthor.set(pickedAuthorId, (selectedByAuthor.get(pickedAuthorId) || 0) + 1);
  }

  return selected;
};

export const postsController = {
  health: async (_req: Request, res: Response) => {
    res.json({
      success: true,
      message: 'Posts routes health check ok',
      timestamp: new Date().toISOString(),
      endpoints: [
        'GET /api/posts',
        'GET /api/posts/:id',
        'POST /api/posts/:id/boost',
        'GET /api/posts/stream'
      ]
    });
  },
  streamEvents: (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx/Render
    (res as any).flushHeaders?.();

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    postSseClients.push({ id, res });

    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    // Keep the stream active through intermediaries (Render/HTTP3/QUIC) to reduce idle disconnects.
    const heartbeat = setInterval(() => {
      try {
        res.write(`: keep-alive ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      const index = postSseClients.findIndex(client => client.id === id);
      if (index !== -1) {
        postSseClients.splice(index, 1);
      }
    });
  },
  // GET /api/posts/search - Search posts
  searchPosts: async (req: Request, res: Response) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Missing search query',
          message: 'Query parameter q is required'
        });
      }

      const db = getDB();
      const query = q.toLowerCase().trim();
      const authenticatedUserId = (req as any).user?.id;
      const viewerActor = await resolveViewerActor(req);
      if (authenticatedUserId && viewerActor === null) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized identity context'
        });
      }

      const viewerAccess = await getViewerAccessContext(db, viewerActor || undefined);
      const visibilityConditions = buildVisibilityConditions(viewerAccess);
      const authorPrivacyConditions = buildAuthorPrivacyConditions(viewerAccess);

      // Basic search across content, author fields, and hashtags with privacy filtering
      const pipeline = [
        {
          $match: {
            $or: [
              { content: { $regex: query, $options: 'i' } },
              { 'author.name': { $regex: query, $options: 'i' } },
              { 'author.handle': { $regex: query, $options: 'i' } },
              { hashtags: { $elemMatch: { $regex: query, $options: 'i' } } }
            ]
          }
        },
        {
          $lookup: {
            from: USERS_COLLECTION,
            localField: 'author.id',
            foreignField: 'id',
            as: 'authorUserDetails'
          }
        },
        {
          $lookup: {
            from: 'companies',
            let: { authorId: '$author.id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$authorId'] },
                      { $ne: ['$legacyArchived', true] }
                    ]
                  }
                }
              }
            ],
            as: 'authorCompanyDetails'
          }
        },
        {
          $addFields: {
            authorDetails: {
              $cond: {
                if: buildCompanyAuthorMatchExpr(),
                then: { $arrayElemAt: ['$authorCompanyDetails', 0] },
                else: { $arrayElemAt: ['$authorUserDetails', 0] }
              },
            },
            authorType: {
              $cond: {
                if: buildCompanyAuthorMatchExpr(),
                then: 'company',
                else: 'user'
              },
            }
          }
        },
        {
          $match: {
            $or: authorPrivacyConditions
          }
        },
        {
          $match: {
            $or: visibilityConditions
          }
        },
        { $sort: { timestamp: -1 } },
        { $limit: 100 },
        {
          $project: {
            authorDetails: 0 // Remove author details from response
          }
        }
      ];

      const posts = await db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();

      const transformedPosts = posts.map((post: any) => {
        if (post.author) {
          post.author = {
            ...transformUser(post.author),
            type: post.authorType || 'user'
          };
        }
        return {
          ...post,
          type: 'post'
        };
      });

      res.json({ success: true, data: transformedPosts });
    } catch (error) {
      console.error('Error searching posts:', error);
      res.status(500).json({ success: false, error: 'Failed to search posts', message: 'Internal server error' });
    }
  },

  // GET /api/posts - Get all posts (with filters & pagination)
  getAllPosts: async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20, userId, energy, hashtags, sort, ownerType } = req.query as Record<string, any>;
      const db = getDB();
      const authenticatedUserId = (req as any).user?.id as string | undefined;
      const viewerActor = await resolveViewerActor(req);
      if (authenticatedUserId && viewerActor === null) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized identity context'
        });
      }
      const viewerIdentityId = viewerActor?.id || authenticatedUserId;

      const query: any = {};
      if (userId) query['author.id'] = userId;
      if (energy) query.energy = energy;
      if (hashtags) {
        const tags = Array.isArray(hashtags) ? hashtags : [hashtags];
        query.hashtags = { $in: tags };
      }

      const normalizedOwnerType = ownerType === 'company' || ownerType === 'user'
        ? ownerType
        : undefined;
      if (normalizedOwnerType === 'company') {
        query.$and = [
          ...(Array.isArray(query.$and) ? query.$and : []),
          {
            $or: [
              { 'author.type': 'company' },
              { ownerType: 'company' }
            ]
          }
        ];
      } else if (normalizedOwnerType === 'user') {
        query.$and = [
          ...(Array.isArray(query.$and) ? query.$and : []),
          {
            $or: [
              { 'author.type': 'user' },
              { ownerType: 'user' },
              { 'author.type': { $exists: false }, ownerType: { $ne: 'company' } }
            ]
          }
        ];
      }

      // Filter out locked Time Capsules (unless viewing own profile)
      const now = Date.now();
      if (!userId || userId !== viewerIdentityId) {
        // For public feed or other users' profiles, hide locked time capsules
        const orConditions: any[] = [
          { isTimeCapsule: { $ne: true } }, // Regular posts
          { isTimeCapsule: true, unlockDate: { $lte: now } } // Unlocked time capsules
        ];

        if (authenticatedUserId) {
          orConditions.push(
            { isTimeCapsule: true, 'author.id': viewerIdentityId }, // Own time capsules for active identity
            { isTimeCapsule: true, invitedUsers: authenticatedUserId } // Invited users remain personal-user scoped
          );
        }

        query.$or = orConditions;
      } else {
        // When viewing own profile, show all posts including locked time capsules
        // No additional filtering needed
      }

      const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
      const viewerAccess = await getViewerAccessContext(db, viewerActor || undefined);
      const visibilityConditions = buildVisibilityConditions(viewerAccess);
      const authorPrivacyConditions = buildAuthorPrivacyConditions(viewerAccess);

      const visibilityMatchStage = {
        $match: {
          $or: visibilityConditions
        }
      };

      const pipeline: any[] = [
        { $match: query },
        ...(!userId || userId !== viewerIdentityId ? [visibilityMatchStage] : []),
        {
          $lookup: {
            from: USERS_COLLECTION,
            localField: 'author.id',
            foreignField: 'id',
            as: 'authorUserDetails'
          }
        },
        {
          $lookup: {
            from: 'companies',
            let: { authorId: '$author.id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$authorId'] },
                      { $ne: ['$legacyArchived', true] }
                    ]
                  }
                }
              }
            ],
            as: 'authorCompanyDetails'
          }
        },
        {
          $addFields: {
            authorDetails: {
              $cond: {
                if: buildCompanyAuthorMatchExpr(),
                then: { $arrayElemAt: ['$authorCompanyDetails', 0] },
                else: { $arrayElemAt: ['$authorUserDetails', 0] }
              },
            },
            authorType: {
              $cond: {
                if: buildCompanyAuthorMatchExpr(),
                then: 'company',
                else: 'user'
              },
            }
          }
        },
        {
          $match: {
            $or: authorPrivacyConditions
          }
        },
        ...(!userId || userId !== viewerIdentityId ? [visibilityMatchStage] : [])
      ];

      // Move privacy filtering match earlier if possible
      // However, authorDetails.isPrivate depends on the lookup
      // So we keep it here but the visibilityMatchStage above will filter out many posts already

      const isTrendingSort = sort === 'trending';
      const startIndex = (pageNum - 1) * limitNum;
      const trendingCandidateLimit = isTrendingSort
        ? Math.min(400, Math.max((startIndex + limitNum) * 6, limitNum * 6, 80))
        : limitNum;

      if (isTrendingSort) {
        pipeline.push(
          {
            $addFields: {
              totalReactions: {
                $sum: {
                  $map: {
                    input: { $objectToArray: { $ifNull: ['$reactions', {}] } },
                    as: 'r',
                    in: '$$r.v'
                  }
                }
              },
              boostScore: {
                $cond: { if: { $eq: ['$isBoosted', true] }, then: 5, else: 0 }
              }
            }
          },
          {
            $lookup: {
              from: 'comments',
              localField: 'id',
              foreignField: 'postId',
              pipeline: [{ $count: 'count' }],
              as: 'commentCountArr'
            }
          },
          {
            $addFields: {
              commentCountVal: { $ifNull: [{ $arrayElemAt: ['$commentCountArr.count', 0] }, 0] },
              viewCountVal: { $ifNull: ['$viewCount', 0] },
              ageHours: {
                $divide: [
                  {
                    $max: [
                      0,
                      {
                        $subtract: [now, { $ifNull: ['$timestamp', now] }]
                      }
                    ]
                  },
                  1000 * 60 * 60
                ]
              }
            }
          },
          {
            $addFields: {
              recencyFactor: { $divide: [1, { $add: [1, { $divide: ['$ageHours', 20] }] }] },
              engagementRaw: {
                $add: [
                  '$boostScore',
                  '$totalReactions',
                  { $multiply: ['$commentCountVal', 2.2] },
                  { $multiply: [{ $sqrt: { $max: [0, '$viewCountVal'] } }, 0.6] },
                  { $min: [40, { $multiply: [{ $ifNull: ['$radiance', 0] }, 0.35] }] }
                ]
              }
            }
          },
          {
            $addFields: {
              engagementScore: {
                $add: [
                  { $multiply: ['$engagementRaw', '$recencyFactor'] },
                  {
                    $cond: [
                      { $lte: ['$ageHours', 2] },
                      2.5,
                      {
                        $cond: [
                          { $lte: ['$ageHours', 8] },
                          1.25,
                          {
                            $cond: [
                              { $lte: ['$ageHours', 24] },
                              0.4,
                              0
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          },
          { $sort: { engagementScore: -1, timestamp: -1 } }
        );
      } else {
        // Default sort: Boosted posts first, then by timestamp (newest)
        pipeline.push(
          {
            $addFields: {
              isBoostedSort: {
                $cond: { if: { $eq: ['$isBoosted', true] }, then: 1, else: 0 }
              }
            }
          },
          { $sort: { isBoostedSort: -1, timestamp: -1 } }
        );
      }

      pipeline.push(
        ...(isTrendingSort
          ? [{ $skip: 0 }, { $limit: trendingCandidateLimit }]
          : [{ $skip: startIndex }, { $limit: limitNum }]),
        {
          $lookup: {
            from: 'comments',
            localField: 'id',
            foreignField: 'postId',
            as: 'fetchedComments'
          }
        },
        {
          $addFields: {
            commentCount: { $size: '$fetchedComments' },
            comments: '$fetchedComments',
            isUnlocked: {
              $cond: {
                if: { $eq: ['$isTimeCapsule', true] },
                then: { $lte: ['$unlockDate', now] },
                else: true
              }
            }
          }
        },
        {
          $project: {
            fetchedComments: 0,
            commentCountArr: 0, // Cleanup temp fields
            commentCountVal: 0,
            totalReactions: 0,
            boostScore: 0,
            ageHours: 0,
            viewCountVal: 0,
            recencyFactor: 0,
            engagementRaw: 0,
            engagementScore: 0
            // authorDetails: 0 // Keep authorDetails to ensure profile info is fresh
          }
        }
      );

      const data = await db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();

      // Get total count with privacy filtering
      const countPipeline: any[] = [
        { $match: query },
        ...(!userId || userId !== viewerIdentityId ? [visibilityMatchStage] : []),
        {
          $lookup: {
            from: USERS_COLLECTION,
            localField: 'author.id',
            foreignField: 'id',
            as: 'authorUserDetails'
          }
        },
        {
          $lookup: {
            from: 'companies',
            let: { authorId: '$author.id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$authorId'] },
                      { $ne: ['$legacyArchived', true] }
                    ]
                  }
                }
              }
            ],
            as: 'authorCompanyDetails'
          }
        },
        {
          $addFields: {
            authorDetails: {
              $cond: {
                if: buildCompanyAuthorMatchExpr(),
                then: { $arrayElemAt: ['$authorCompanyDetails', 0] },
                else: { $arrayElemAt: ['$authorUserDetails', 0] }
              },
            },
            authorType: {
              $cond: {
                if: buildCompanyAuthorMatchExpr(),
                then: 'company',
                else: 'user'
              },
            }
          }
        },
        {
          $match: {
            $or: authorPrivacyConditions
          }
        },
        { $count: 'total' }
      ];

      const countResult = await db.collection(POSTS_COLLECTION).aggregate(countPipeline).toArray();
      const total = countResult[0]?.total || 0;

      // Post-process to add userReactions for the current user
      const transformedData = data.map((post: any) => {
        // Use fresh author details from lookup if available
        if (post.authorDetails && !Array.isArray(post.authorDetails)) {
          post.author = {
            ...transformUser({ ...post.author, ...post.authorDetails }),
            type: post.authorType || 'user'
          };
        } else if (post.authorDetails && post.authorDetails[0]) {
          post.author = {
            ...transformUser({ ...post.author, ...post.authorDetails[0] }),
            type: post.authorType || 'user'
          };
        } else if (post.author) {
          post.author = {
            ...transformUser(post.author),
            type: post.authorType || 'user'
          };
        }
        delete post.authorDetails; // Clean up

        if (authenticatedUserId) {
          if (post.reactionUsers) {
            post.userReactions = Object.keys(post.reactionUsers).filter(emoji =>
              Array.isArray(post.reactionUsers[emoji]) && post.reactionUsers[emoji].includes(authenticatedUserId)
            );
          } else {
            post.userReactions = [];
          }
          // Optional: Remove reactionUsers from response to save bandwidth/privacy
          // delete post.reactionUsers; 
        }
        return {
          ...post,
          type: 'post'
        };
      });

      let responseData = transformedData;
      if (isTrendingSort) {
        const endIndex = startIndex + limitNum;
        const fairRanked = rerankTrendingPostsFair(transformedData as TrendingCandidatePost[], endIndex);
        responseData = fairRanked.slice(startIndex, endIndex) as any[];
      }

      res.json({
        success: true,
        data: responseData,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      console.error('Error fetching posts:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch posts', message: 'Internal server error' });
    }
  },

  // GET /api/posts/:id - Get post by ID
  getPostById: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const authenticatedUserId = (req as any).user?.id as string | undefined;
      const viewerActor = await resolveViewerActor(req);
      if (authenticatedUserId && viewerActor === null) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized identity context'
        });
      }
      const viewerIdentityId = viewerActor?.id || authenticatedUserId;
      const viewerAccess = await getViewerAccessContext(db, viewerActor || undefined);

      const pipeline = [
        { $match: { id } },
        // Lookup author details to check privacy settings
        {
          $lookup: {
            from: USERS_COLLECTION,
            localField: 'author.id',
            foreignField: 'id',
            as: 'authorUserDetails'
          }
        },
        {
          $lookup: {
            from: 'companies',
            let: { authorId: '$author.id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$authorId'] },
                      { $ne: ['$legacyArchived', true] }
                    ]
                  }
                }
              }
            ],
            as: 'authorCompanyDetails'
          }
        },
        {
          $lookup: {
            from: 'comments',
            localField: 'id',
            foreignField: 'postId',
            as: 'fetchedComments'
          }
        },
        {
          $addFields: {
            authorDetails: {
              $cond: {
                if: buildCompanyAuthorMatchExpr(),
                then: { $arrayElemAt: ['$authorCompanyDetails', 0] },
                else: { $arrayElemAt: ['$authorUserDetails', 0] }
              },
            },
            authorType: {
              $cond: {
                if: buildCompanyAuthorMatchExpr(),
                then: 'company',
                else: 'user'
              },
            },
            commentCount: { $size: '$fetchedComments' },
            comments: '$fetchedComments',
            // Calculate if time capsule is unlocked
            isUnlocked: {
              $cond: {
                if: { $eq: ['$isTimeCapsule', true] },
                then: { $lte: ['$unlockDate', Date.now()] },
                else: true
              }
            }
          }
        },
        { $project: { fetchedComments: 0, authorUserDetails: 0, authorCompanyDetails: 0 } }
      ];

      const posts = await db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();
      const post = posts[0];

      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
      }

      // Increment view count if not the author
      if (viewerIdentityId !== post.author.id) {
        await db.collection(POSTS_COLLECTION).updateOne(
          { id },
          {
            $inc: { viewCount: 1 },
            $setOnInsert: { viewCount: 1 }
          }
        );
        post.viewCount = (post.viewCount || 0) + 1;

        // Trigger insights update for author
        if (post.author.id) {
          emitAuthorInsightsUpdate(
            req.app,
            post.author.id,
            post.author?.type === 'company' ? 'company' : 'user'
          );
        }
      }

      // Check privacy settings
      const authorDetails = post.authorDetails;
      const authorType: 'user' | 'company' = post.authorType === 'company' ? 'company' : 'user';

      if (authorDetails?.isPrivate && viewerIdentityId !== post.author.id) {
        if (!viewerIdentityId) {
          return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is private' });
        }

        if (authorType === 'user') {
          if (viewerActor?.type !== 'user' || !viewerAccess.acquaintances.includes(post.author.id)) {
            return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is private' });
          }
        } else {
          const hasCompanyMemberAccess =
            viewerAccess.memberCompanyIds.includes(post.author.id) ||
            viewerAccess.ownedCompanyIds.includes(post.author.id);
          if (!hasCompanyMemberAccess) {
            return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is private' });
          }
        }
      }

      if (post.visibility === 'private' && viewerIdentityId !== post.author.id) {
        if (authorType !== 'company') {
          return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is private' });
        }
        if (!viewerIdentityId) {
          return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is private' });
        }
        const hasCompanyMemberAccess =
          viewerAccess.memberCompanyIds.includes(post.author.id) ||
          viewerAccess.ownedCompanyIds.includes(post.author.id);
        if (!hasCompanyMemberAccess) {
          return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is private' });
        }
      }

      if (post.visibility === 'acquaintances') {
        if (!viewerIdentityId) {
          return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is limited access' });
        }
        if (viewerIdentityId !== post.author.id) {
          // Backward compatibility: older company posts may still use acquaintances visibility.
          if (authorType === 'company') {
            if (!viewerAccess.accessibleCompanyIds.includes(post.author.id)) {
              return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is limited to subscribers' });
            }
          } else if (viewerActor?.type !== 'user' || !viewerAccess.acquaintances.includes(post.author.id)) {
            return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is limited to acquaintances' });
          }
        }
      }

      if (post.visibility === 'subscribers') {
        if (!viewerIdentityId) {
          return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is limited to subscribers' });
        }
        if (viewerIdentityId !== post.author.id && !viewerAccess.accessibleCompanyIds.includes(post.author.id)) {
          return res.status(404).json({ success: false, error: 'Post not found', message: 'This post is limited to subscribers' });
        }
      }

      // Check if this is a locked Time Capsule that the user shouldn't see
      if (post.isTimeCapsule && post.unlockDate && Date.now() < post.unlockDate) {
        // Only allow the author or invited users to see locked time capsules
        const isAuthor = viewerIdentityId && viewerIdentityId === post.author.id;
        const isInvited = authenticatedUserId && Array.isArray(post.invitedUsers) && post.invitedUsers.includes(authenticatedUserId);
        if (!isAuthor && !isInvited) {
          return res.status(404).json({ success: false, error: 'Post not found', message: 'Time Capsule is not yet unlocked' });
        }
      }

      // Post-process to add userReactions for the current user
      if (post.authorDetails) {
        post.author = transformUser({ ...post.author, ...post.authorDetails });
      } else if (post.author) {
        post.author = transformUser(post.author);
      }
      delete post.authorDetails;

      if (authenticatedUserId) {
        if (post.reactionUsers) {
          post.userReactions = Object.keys(post.reactionUsers).filter(emoji =>
            Array.isArray(post.reactionUsers[emoji]) && post.reactionUsers[emoji].includes(authenticatedUserId)
          );
        } else {
          post.userReactions = [];
        }
      }

      // Refresh comment authors for single post
      if (Array.isArray(post.comments) && post.comments.length > 0) {
        const commentAuthorIds = new Set<string>();
        post.comments.forEach((c: any) => {
          if (c.author?.id) commentAuthorIds.add(c.author.id);
        });

        if (commentAuthorIds.size > 0) {
          const commentAuthors = await db.collection(USERS_COLLECTION)
            .find({ id: { $in: Array.from(commentAuthorIds) } })
            .project({
              id: 1, firstName: 1, lastName: 1, name: 1, handle: 1,
              avatar: 1, avatarKey: 1, avatarType: 1, isVerified: 1
            })
            .toArray();

          const commentAuthorMap = new Map(commentAuthors.map((u: any) => [u.id, u]));

          post.comments.forEach((c: any) => {
            if (c.author?.id && commentAuthorMap.has(c.author.id)) {
              const latest = commentAuthorMap.get(c.author.id);
              c.author = transformUser(latest);
            } else if (c.author) {
              c.author = transformUser(c.author);
            }

            if (authenticatedUserId) {
              if (c.reactionUsers) {
                c.userReactions = Object.keys(c.reactionUsers).filter(emoji =>
                  Array.isArray(c.reactionUsers[emoji]) && c.reactionUsers[emoji].includes(authenticatedUserId)
                );
              } else {
                c.userReactions = [];
              }
            }
          });
        }
      }

      res.json({ success: true, data: post });
    } catch (error) {
      console.error('Error fetching post:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch post', message: 'Internal server error' });
    }
  },

  incrementPostViews: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: { id, viewCount: 0 }
        });
      }

      const db = getDB();
      const authenticatedUserId = (req as any).user?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const viewerActor = await resolveViewerActor(req);
      if (!viewerActor) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized identity context'
        });
      }
      const viewerIdentityId = viewerActor.id;

      // Find the post first to check the author
      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
      }

      const authorId = post.author?.id;
      let updatedPost = post;

      // Only increment if viewer is NOT the author
      if (viewerIdentityId !== authorId) {
        const result = await db.collection(POSTS_COLLECTION).findOneAndUpdate(
          { id },
          {
            $inc: { viewCount: 1 },
            $setOnInsert: { viewCount: 1 }
          },
          { returnDocument: 'after' }
        );
        if (result && result.value) {
          updatedPost = result.value;
        }
      }

      const viewCount = updatedPost.viewCount || 0;
      broadcastPostViewUpdate({ postId: id, viewCount });

      try {
        const io = (req.app as any).get('io');
        if (io && typeof io.emit === 'function') {
          io.emit('post_view', { postId: id, viewCount });
        }
      } catch (e) {
      }

      if (authorId) {
        // Trigger live insights update for the author (asynchronously)
        emitAuthorInsightsUpdate(
          req.app,
          authorId,
          post.author?.type === 'company' ? 'company' : 'user'
        ).catch(err => {
          console.error('Failed to emit insights update in incrementPostViews:', err);
        });
      }

      res.json({ success: true, data: { id, viewCount } });
    } catch (error) {
      console.error('Error in incrementPostViews:', error);
      res.json({ success: true, data: { id: (req.params as any).id, viewCount: 0 } });
    }
  },

  // POST /api/posts - Create new post
  createPost: async (req: Request, res: Response) => {
    try {
      const {
        content,
        mediaUrl,
        mediaType,
        mediaKey,
        mediaMimeType,
        mediaSize,
        mediaItems,
        energy,
        authorId: rawAuthorId, // Rename to rawAuthorId as we won't trust it
        taggedUserIds,
        isTimeCapsule,
        unlockDate,
        timeCapsuleType,
        invitedUsers,
        timeCapsuleTitle,
        timezone,
        visibility,
        isSystemPost,
        systemType,
        createdByUserId,
        id // Allow frontend to provide ID (e.g. for S3 key consistency)
      } = req.body;

      const authenticatedUserId = (req as any).user?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType: req.body.ownerType as string,
        ownerId: rawAuthorId as string
      }, req.headers);

      if (!actor) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Unauthorized author identity' });
      }

      const authorId = actor.id;
      const authorType = actor.type;

      // Handle media uploads
      const files = req.files as Express.Multer.File[];
      const uploadedMediaItems: Partial<MediaItem>[] = [];

      if (files && files.length > 0) {
        for (const file of files) {
          const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9.-]/g, '_');
          const path = `${authorId}/${Date.now()}-${sanitize(file.originalname)}`;

          const url = await uploadToS3(
            'media',
            path,
            file.buffer,
            file.mimetype
          );

          const type: 'image' | 'video' | 'document' = file.mimetype.startsWith('video/')
            ? 'video'
            : file.mimetype.startsWith('image/')
              ? 'image'
              : 'document';
          uploadedMediaItems.push({
            url,
            type,
            key: path,
            mimeType: file.mimetype,
            size: file.size,
            title: '',
            description: '',
            caption: '', // Default caption
            id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // Generate ID immediately
          });
        }
      }

      // Merge uploaded items with existing items
      let parsedMediaItems: Partial<MediaItem>[] = [];
      if (typeof mediaItems === 'string') {
        try {
          parsedMediaItems = JSON.parse(mediaItems);
        } catch (e) {
          parsedMediaItems = [];
        }
      } else if (Array.isArray(mediaItems)) {
        parsedMediaItems = mediaItems;
      }

      const mergedItems = [...(parsedMediaItems || []), ...uploadedMediaItems];

      // Enhance media items with metrics and order
      const finalMediaItems: MediaItem[] = mergedItems.map((item, index) => ({
        // Persist optional per-item metadata while preserving old caption-only payloads.
        title: typeof (item as any).title === 'string' ? (item as any).title.trim() : '',
        description: typeof (item as any).description === 'string' ? (item as any).description.trim() : '',
        // Strong rule: use mediaKey as id if available, otherwise create one
        id: item.key || item.id || `mi-${index}-${Date.now()}`,
        url: item.url!,
        type: (
          item.type === 'video' || item.type === 'document' || item.type === 'image'
            ? item.type
            : 'image'
        ) as 'image' | 'video' | 'document',
        key: item.key,
        mimeType: item.mimeType,
        size: item.size,
        caption:
          (typeof (item as any).caption === 'string' ? (item as any).caption.trim() : '') ||
          (typeof (item as any).description === 'string' ? (item as any).description.trim() : '') ||
          (typeof (item as any).title === 'string' ? (item as any).title.trim() : ''),
        order: index,
        metrics: item.metrics || {
          views: 0,
          clicks: 0,
          saves: 0,
          dwellMs: 0
        }
      }));

      // Determine primary mediaUrl/Type if not set
      let finalMediaUrl = mediaUrl;
      let finalMediaType = mediaType;

      if (finalMediaItems.length > 0 && !finalMediaUrl) {
        finalMediaUrl = finalMediaItems[0].url;
        finalMediaType = finalMediaItems[0].type;
      }

      const hasText = typeof content === 'string' && content.trim().length > 0;
      const hasMedia = !!finalMediaUrl || (Array.isArray(finalMediaItems) && finalMediaItems.length > 0);
      if (!hasText && !hasMedia) {
        return res.status(400).json({ success: false, error: 'Missing content or media', message: 'A post must include text or at least one media item' });
      }

      const db = getDB();
      // Try to fetch full author from DB
      const collectionName = authorType === 'company' ? 'companies' : USERS_COLLECTION;
      const authorRaw = await db.collection(collectionName).findOne({ id: authorId });

      const author = authorRaw ? transformUser(authorRaw) : null;

      const authorEmbed = author ? {
        id: author.id,
        firstName: authorType === 'user' ? author.firstName : author.name,
        lastName: authorType === 'user' ? author.lastName : '',
        name: author.name,
        handle: author.handle,
        avatar: author.avatar,
        avatarKey: author.avatarKey,
        avatarType: author.avatarType || 'image',
        activeGlow: author.activeGlow || 'none',
        type: authorType
      } : {
        id: authorId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authorId}`,
        avatarType: 'image',
        activeGlow: 'none',
        type: authorType,
      };

      const safeContent = typeof content === 'string' ? content : '';
      const requestedVisibility = typeof visibility === 'string' ? visibility : 'public';
      const allowedVisibility = new Set(['public', 'private', 'acquaintances', 'subscribers']);
      const clampedVisibility = allowedVisibility.has(requestedVisibility) ? requestedVisibility : 'public';
      const normalizedVisibility =
        authorType === 'company'
          ? (clampedVisibility === 'acquaintances' ? 'subscribers' : clampedVisibility)
          : (clampedVisibility === 'subscribers' ? 'acquaintances' : clampedVisibility);
      const hashtags = getHashtagsFromText(safeContent);
      const tagList: string[] = Array.isArray(taggedUserIds) ? taggedUserIds : [];
      // Use provided ID if available, otherwise generate one
      const postId = id || (isTimeCapsule ? `tc-${Date.now()}` : `post-${Date.now()}`);

      const currentYear = new Date().getFullYear();

      const newPost = {
        id: postId,
        author: authorEmbed,
        authorId: authorEmbed.id,
        ownerId: authorEmbed.id,
        ownerType: authorEmbed.type || authorType,
        content: safeContent,
        mediaUrl: finalMediaUrl || undefined,
        mediaType: finalMediaType || undefined,
        mediaKey: mediaKey || undefined,
        mediaMimeType: mediaMimeType || undefined,
        mediaSize: mediaSize || undefined,
        mediaItems: finalMediaItems || undefined,
        sharedFrom: (req.body as any).sharedFrom || undefined,
        energy: energy || '🪐 Neutral',
        radiance: 0,
        timestamp: Date.now(),
        visibility: normalizedVisibility,
        reactions: {} as Record<string, number>,
        reactionUsers: {} as Record<string, string[]>,
        userReactions: [] as string[],
        comments: [] as any[],
        isBoosted: false,
        viewCount: 0,
        hashtags,
        taggedUserIds: tagList,
        // Time Capsule specific fields
        ...(isTimeCapsule && {
          isTimeCapsule: true,
          unlockDate: unlockDate || null,
          isUnlocked: unlockDate ? Date.now() >= unlockDate : true,
          timeCapsuleType: timeCapsuleType || null,
          invitedUsers: invitedUsers || [],
          timeCapsuleTitle: timeCapsuleTitle || null,
          timezone: timezone || null
        }),
        ...(isSystemPost && {
          isSystemPost: true,
          systemType: systemType || null,
          createdByUserId: createdByUserId || authorEmbed.id
        })
      };

      await db.collection(POSTS_COLLECTION).insertOne(newPost);

      if (tagList.length > 0) {
        await Promise.all(
          tagList
            .filter(id => id && id !== authorEmbed.id)
            .map(id =>
              createNotificationInDB(
                id,
                'link',
                authorEmbed.id,
                'mentioned you in a post',
                postId
              ).catch(err => {
                console.error('Error creating mention notification:', err);
              })
            )
        );
      }

      if (isTimeCapsule && timeCapsuleType === 'group' && Array.isArray(invitedUsers) && invitedUsers.length > 0) {
        await Promise.all(
          invitedUsers
            .filter((userId: string) => userId && userId !== authorEmbed.id)
            .map((userId: string) =>
              createNotificationInDB(
                userId,
                'time_capsule_invite',
                authorEmbed.id,
                `invited you to a Time Capsule${timeCapsuleTitle ? `: "${timeCapsuleTitle}"` : ''}`,
                postId
              ).catch(err => {
                console.error('Error creating time capsule invite notification:', err);
              })
            )
        );
      }

      // Emit real-time event for new post if it's public and visible
      const io = req.app.get('io');
      if (io) {
        const isPublic = normalizedVisibility === 'public';
        const isLockedTimeCapsule = isTimeCapsule && unlockDate && new Date(unlockDate) > new Date();

        if (isPublic && !isLockedTimeCapsule) {
          io.emit('new_post', newPost);
        } else if (normalizedVisibility === 'acquaintances' || normalizedVisibility === 'subscribers') {
          // TODO: Efficiently emit to limited audiences only
          // For now, we don't emit to avoid leaking to public
        }

        // Trigger live insights update for the author
        emitAuthorInsightsUpdate(req.app, authorEmbed.id, authorEmbed.type || 'user');
      }

      res.status(201).json({
        success: true,
        data: {
          ...newPost,
          type: 'post'
        },
        message: 'Post created successfully'
      });
    } catch (error) {
      console.error('Error creating post:', error);
      res.status(500).json({ success: false, error: 'Failed to create post', message: 'Internal server error' });
    }
  },

  // PUT /api/posts/:id - Update post (author only)
  updatePost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = sanitizePostUpdates(req.body);
      const db = getDB();

      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
      }

      // Auth check: only author can update
      const authenticatedUserId = (req as any).user?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerId: post.author.id,
        ownerType: post.author.type
      });

      if (!actor || actor.id !== post.author.id) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can update this post' });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid fields to update',
          message: 'No mutable post fields were provided.'
        });
      }

      if (typeof updates.content === 'string') {
        updates.hashtags = getHashtagsFromText(updates.content);
      }

      if (typeof updates.visibility === 'string') {
        const allowedVisibility = new Set(['public', 'private', 'acquaintances', 'subscribers']);
        const clampedVisibility = allowedVisibility.has(updates.visibility) ? updates.visibility : 'public';
        const authorType = post.author?.type === 'company' ? 'company' : 'user';
        updates.visibility = authorType === 'company'
          ? (clampedVisibility === 'acquaintances' ? 'subscribers' : clampedVisibility)
          : (clampedVisibility === 'subscribers' ? 'acquaintances' : clampedVisibility);
      }

      await db.collection(POSTS_COLLECTION).updateOne(
        { id },
        { $set: { ...updates, updatedAt: new Date().toISOString() } }
      );

      const updatedDoc = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!updatedDoc) {
        return res.status(500).json({ success: false, error: 'Failed to update post' });
      }

      if (updatedDoc.author) {
        updatedDoc.author = {
          ...transformUser(updatedDoc.author),
          type: updatedDoc.author.type || 'user'
        };
      }

      // Trigger live insights update for the author
      emitAuthorInsightsUpdate(
        req.app,
        post.author.id,
        post.author?.type === 'company' ? 'company' : 'user'
      );

      res.json({
        success: true,
        data: {
          ...updatedDoc,
          type: 'post'
        },
        message: 'Post updated successfully'
      });
    } catch (error) {
      console.error('Error updating post:', error);
      res.status(500).json({ success: false, error: 'Failed to update post', message: 'Internal server error' });
    }
  },

  // DELETE /api/posts/:id - Delete post (author only)
  deletePost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
      }

      const authenticatedUserId = (req as any).user?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerId: post.author.id,
        ownerType: post.author.type
      });

      if (!actor || actor.id !== post.author.id) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can delete this post' });
      }

      await db.collection(POSTS_COLLECTION).deleteOne({ id });

      // Trigger live insights update for the author
      emitAuthorInsightsUpdate(
        req.app,
        post.author.id,
        post.author?.type === 'company' ? 'company' : 'user'
      );

      res.json({ success: true, message: 'Post deleted successfully' });
    } catch (error) {
      console.error('Error deleting post:', error);
      res.status(500).json({ success: false, error: 'Failed to delete post', message: 'Internal server error' });
    }
  },

  // POST /api/posts/:id/react - Add reaction to post
  reactToPost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reaction, action: forceAction } = req.body;
      const userId = (req as any).user?.id as string | undefined;

      if (!reaction) {
        return res.status(400).json({ success: false, error: 'Missing reaction' });
      }
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }

      const db = getDB();
      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }

      // Check if user already reacted with this emoji
      const currentReactionUsers = post.reactionUsers || {};
      const usersForEmoji = currentReactionUsers[reaction] || [];
      const hasReacted = usersForEmoji.includes(userId);
      let action = 'added';
      let shouldUpdate = true;

      if (forceAction) {
        if (forceAction === 'add' && hasReacted) shouldUpdate = false;
        if (forceAction === 'remove' && !hasReacted) shouldUpdate = false;
        action = forceAction === 'add' ? 'added' : 'removed';
      } else {
        action = hasReacted ? 'removed' : 'added';
      }

      if (shouldUpdate) {
        if (action === 'removed') {
          // Remove reaction
          await db.collection(POSTS_COLLECTION).updateOne(
            { id },
            ({
              $pull: { [`reactionUsers.${reaction}`]: userId },
              $inc: { [`reactions.${reaction}`]: -1 }
            } as any)
          );
        } else {
          // Add reaction
          await db.collection(POSTS_COLLECTION).updateOne(
            { id },
            {
              $addToSet: { [`reactionUsers.${reaction}`]: userId },
              $inc: { [`reactions.${reaction}`]: 1 }
            }
          );
        }
      }

      // Notify author only if adding a reaction and it's not self-reaction
      if (action === 'added' && post.author.id !== userId) {
        await createNotificationInDB(
          post.author.id,
          'like',
          userId,
          `reacted ${reaction} to your post`,
          id
        ).catch((err: any) => console.error('Error creating reaction notification:', err));
      }

      // Fetch updated post to return consistent state
      const updatedPostDoc = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!updatedPostDoc) {
        return res.status(500).json({ success: false, error: 'Failed to update reaction' });
      }
      const updatedPost = updatedPostDoc as any;
      if (updatedPost.reactionUsers) {
        updatedPost.userReactions = Object.keys(updatedPost.reactionUsers).filter(emoji =>
          Array.isArray(updatedPost.reactionUsers[emoji]) && updatedPost.reactionUsers[emoji].includes(userId)
        );
      } else {
        updatedPost.userReactions = [];
      }

      if (updatedPost.author && updatedPost.author.id) {
        emitAuthorInsightsUpdate(
          req.app,
          updatedPost.author.id,
          updatedPost.author?.type === 'company' ? 'company' : 'user'
        );
      }

      // Broadcast post update to all connected clients for real-time reactions
      const io = req.app.get('io');
      if (io) {
        io.emit('post_updated', updatedPost);
      }

      res.json({ success: true, data: updatedPost, message: `Reaction ${action} successfully` });
    } catch (error) {
      console.error('Error adding reaction:', error);
      res.status(500).json({ success: false, error: 'Failed to add reaction', message: 'Internal server error' });
    }
  },

  // POST /api/posts/:id/boost - Boost post and deduct credits server-side
  boostPost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const authenticatedUserId = (req as any).user?.id as string | undefined;
      const { credits } = req.body as { credits?: number | string };
      const db = getDB();

      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }

      const userId = authenticatedUserId;

      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }

      const parsedCredits = typeof credits === 'string' ? Number(credits) : credits;
      const creditsToSpend = typeof parsedCredits === 'number' && Number.isFinite(parsedCredits) && parsedCredits > 0
        ? Math.max(1, Math.round(parsedCredits))
        : 100;

      const creditUpdateResult: any = await db.collection(USERS_COLLECTION).findOneAndUpdate(
        { id: userId, auraCredits: { $gte: creditsToSpend } },
        {
          $inc: { auraCredits: -creditsToSpend, auraCreditsSpent: creditsToSpend },
          $set: { updatedAt: new Date().toISOString() }
        },
        {
          returnDocument: 'before',
          projection: { auraCredits: 1 }
        }
      );

      const userBeforeDebit = creditUpdateResult && typeof creditUpdateResult === 'object' && 'value' in creditUpdateResult
        ? creditUpdateResult.value
        : creditUpdateResult;
      if (!userBeforeDebit) {
        const existingUser = await db.collection(USERS_COLLECTION).findOne(
          { id: userId },
          { projection: { auraCredits: 1 } }
        );
        if (!existingUser) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.status(400).json({ success: false, error: 'Insufficient credits' });
      }

      const currentCredits = Number(userBeforeDebit.auraCredits || 0);
      const newCredits = currentCredits - creditsToSpend;

      // Apply boost to post (radiance proportional to credits)
      const incRadiance = creditsToSpend * 2; // keep same multiplier as UI
      try {
        await db.collection(POSTS_COLLECTION).updateOne(
          { id },
          { $set: { isBoosted: true, updatedAt: new Date().toISOString() }, $inc: { radiance: incRadiance } }
        );

        const boostedDoc = await db.collection(POSTS_COLLECTION).findOne({ id });
        if (!boostedDoc) {
          await db.collection(USERS_COLLECTION).updateOne(
            { id: userId },
            {
              $inc: { auraCredits: creditsToSpend, auraCreditsSpent: -creditsToSpend },
              $set: { updatedAt: new Date().toISOString() }
            }
          );
          return res.status(500).json({ success: false, error: 'Failed to boost post' });
        }

        try {
          if (post.author.id !== userId) {
            await createNotificationInDB(
              post.author.id,
              'boost_received',
              userId,
              'boosted your post',
              id
            );
          }
        } catch (e) {
          console.error('Error creating boost notification:', e);
        }

        try {
          const appInstance: any = (req as any).app;
          const authorId = boostedDoc.author?.id || post.author.id;
          if (authorId) {
            await emitAuthorInsightsUpdate(
              appInstance,
              authorId,
              boostedDoc.author?.type === 'company' || post.author?.type === 'company' ? 'company' : 'user'
            );
          }
        } catch (e) {
          console.error('Error emitting analytics update after boost:', e);
        }

        return res.json({ success: true, data: boostedDoc, message: 'Post boosted successfully' });
      } catch (e) {
        await db.collection(USERS_COLLECTION).updateOne(
          { id: userId },
          {
            $inc: { auraCredits: creditsToSpend, auraCreditsSpent: -creditsToSpend },
            $set: { updatedAt: new Date().toISOString() }
          }
        );
        throw e;
      }
    } catch (error) {
      console.error('Error boosting post:', error);
      res.status(500).json({ success: false, error: 'Failed to boost post', message: 'Internal server error' });
    }
  },

  // POST /api/posts/:id/share - Share a post
  sharePost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id as string | undefined;
      const db = getDB();

      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }

      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }

      // Optionally increment a share counter on the post
      await db.collection(POSTS_COLLECTION).updateOne(
        { id },
        { $inc: { shares: 1 } }
      );

      if (post.author.id !== userId) {
        await createNotificationInDB(
          post.author.id,
          'share',
          userId,
          'shared your post',
          id
        ).catch((err: any) => console.error('Error creating share notification:', err));
      }

      const updated = await db.collection(POSTS_COLLECTION).findOne({ id });
      res.json({ success: true, data: updated, message: 'Post shared successfully' });
    } catch (error) {
      console.error('Error sharing post:', error);
      res.status(500).json({ success: false, error: 'Failed to share post', message: 'Internal server error' });
    }
  },

  // POST /api/posts/:id/report - Report a post
  reportPost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason, notes } = req.body as { reason: string; notes?: string };
      const db = getDB();
      const reporter = (req as any).user;

      if (!reporter || !reporter.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
      if (!reason) {
        return res.status(400).json({ success: false, error: 'Missing reason' });
      }

      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }

      const reportDoc = {
        id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'post',
        postId: id,
        reporterId: reporter.id,
        reason,
        notes: notes || '',
        createdAt: new Date().toISOString(),
        status: 'open'
      };

      await db.collection('reports').insertOne(reportDoc);

      const toEmail =
        process.env.ADMIN_EMAIL ||
        process.env.SUPPORT_EMAIL ||
        process.env.SENDGRID_FROM_EMAIL ||
        'support@aura.net.za';
      const subject = `Aura Post Report: ${post.author?.name || post.author?.handle || id}`;
      const body = [
        `Reporter: ${reporter.name || reporter.handle || reporter.id} (${reporter.id})`,
        `Post ID: ${id}`,
        `Author: ${post.author?.name || post.author?.handle || post.author?.id}`,
        `Reason: ${reason}`,
        `Notes: ${notes || ''}`,
        `Created At: ${reportDoc.createdAt}`,
        `Report ID: ${reportDoc.id}`,
        `Content: ${(post.content || '').slice(0, 300)}`
      ].join('\n');

      await db.collection('email_outbox').insertOne({
        to: toEmail,
        subject,
        body,
        createdAt: new Date().toISOString(),
        status: 'pending'
      });

      res.json({ success: true, data: reportDoc, message: 'Post reported successfully' });
    } catch (error) {
      console.error('Error reporting post:', error);
      res.status(500).json({ success: false, error: 'Failed to report post', message: 'Internal server error' });
    }
  },

  // GET /api/posts/hashtags/trending - Get trending hashtags
  getTrendingHashtags: async (req: Request, res: Response) => {
    try {
      const { limit = 10, hours = 24 } = req.query as Record<string, any>;
      const db = getDB();
      const limitNum = Math.min(parseInt(String(limit), 10) || 10, 100);

      const getPipeline = (since: number) => [
        { $match: { timestamp: { $gte: since } } },
        { $unwind: '$hashtags' },
        { $group: { _id: { $toLower: '$hashtags' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limitNum }
      ];

      // 1. Try requested time window (default 24h)
      let since = Date.now() - (parseInt(String(hours), 10) || 24) * 60 * 60 * 1000;
      let tags = await db.collection(POSTS_COLLECTION).aggregate(getPipeline(since)).toArray();
      let windowUsed = '24h';

      // 2. If empty, try 7 days
      if (tags.length === 0) {
        since = Date.now() - 7 * 24 * 60 * 60 * 1000;
        tags = await db.collection(POSTS_COLLECTION).aggregate(getPipeline(since)).toArray();
        windowUsed = '7d';
      }

      // 3. If still empty, try 30 days
      if (tags.length === 0) {
        since = Date.now() - 30 * 24 * 60 * 60 * 1000;
        tags = await db.collection(POSTS_COLLECTION).aggregate(getPipeline(since)).toArray();
        windowUsed = '30d';
      }

      // 4. If still empty, try All Time
      if (tags.length === 0) {
        since = 0; // Beginning of time
        tags = await db.collection(POSTS_COLLECTION).aggregate(getPipeline(since)).toArray();
        windowUsed = 'all_time';
      }

      res.json({
        success: true,
        data: tags,
        message: 'Trending hashtags retrieved successfully',
        meta: { windowUsed }
      });
    } catch (error) {
      console.error('Error fetching trending hashtags:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch trending hashtags', message: 'Internal server error' });
    }
  },

  // POST /api/posts/:id/media/:mediaId/metrics - Update media item metrics
  updateMediaMetrics: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      let { mediaId } = req.params;

      // Handle wildcard parameter which might be an array in Express 5
      const normalizedMediaId = Array.isArray(mediaId) ? mediaId.join('/') : mediaId;

      const { metric, value } = req.body; // metric: 'views' | 'clicks' | 'saves' | 'dwellMs'

      if (!['views', 'clicks', 'saves', 'dwellMs'].includes(metric)) {
        return res.status(400).json({ success: false, error: 'Invalid metric' });
      }

      const db = getDB();
      const post = await db.collection(POSTS_COLLECTION).findOne(
        { id },
        { projection: { id: 1, author: 1 } }
      );
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post or media item not found' });
      }

      const updateField = `mediaItems.$[elem].metrics.${metric}`;
      // For dwellMs, we increment by the value provided. For others, we increment by 1.
      const incrementValue = metric === 'dwellMs' ? (Number(value) || 0) : 1;

      // Prepare update object
      const updateDoc: any = {
        $inc: {
          [updateField]: incrementValue
        }
      };

      // Also track post totals
      if (metric === 'views') {
        updateDoc.$inc['metrics.totalViews'] = incrementValue;
        updateDoc.$inc['viewCount'] = incrementValue; // Keep legacy field in sync
      } else if (metric === 'clicks') {
        updateDoc.$inc['metrics.totalClicks'] = incrementValue;
      } else if (metric === 'saves') {
        updateDoc.$inc['metrics.totalSaves'] = incrementValue;
      } else if (metric === 'dwellMs') {
        updateDoc.$inc['metrics.totalDwellMs'] = incrementValue;
      }

      const result = await db.collection(POSTS_COLLECTION).updateOne(
        { id, 'mediaItems.id': normalizedMediaId },
        updateDoc,
        { arrayFilters: [{ "elem.id": normalizedMediaId }] }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, error: 'Post or media item not found' });
      }

      const authorId = post.author?.id;
      if (authorId) {
        emitAuthorInsightsUpdate(
          req.app,
          authorId,
          post.author?.type === 'company' ? 'company' : 'user'
        ).catch((err) => {
          console.error('Failed to emit insights update in updateMediaMetrics:', err);
        });
      }

      res.json({ success: true, message: 'Metrics updated' });
    } catch (error) {
      console.error('Error updating media metrics:', error);
      res.status(500).json({ success: false, error: 'Failed to update metrics' });
    }
  },

  // GET /api/posts/:id/analytics - Get detailed analytics for a post
  getPostAnalytics: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }

      const authenticatedUserId = (req as any).user?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }

      const actor = await resolveIdentityActor(
        authenticatedUserId,
        {
          ownerType: req.query.ownerType as string,
          ownerId: req.query.ownerId as string
        },
        req.headers
      );
      if (!actor) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Unauthorized identity context' });
      }

      const postAuthorId = post.author?.id;
      const postAuthorType: 'user' | 'company' = post.author?.type === 'company' ? 'company' : 'user';
      if (!postAuthorId || actor.id !== postAuthorId || actor.type !== postAuthorType) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'You can only view analytics for your active identity posts' });
      }

      // Calculate totals from media items if not present on post
      const mediaItems = post.mediaItems || [];
      let totalViews = post.metrics?.totalViews || post.viewCount || 0;
      let totalClicks = post.metrics?.totalClicks || 0;
      let totalSaves = post.metrics?.totalSaves || 0;

      // If metrics are missing on post level (legacy), aggregate from items
      if (!post.metrics && mediaItems.length > 0) {
        totalViews = 0; // Reset to recalculate from items if metrics obj missing
        totalClicks = 0;
        totalSaves = 0;
        mediaItems.forEach((item: any) => {
          if (item.metrics) {
            totalViews += item.metrics.views || 0;
            totalClicks += item.metrics.clicks || 0;
            totalSaves += item.metrics.saves || 0;
          }
        });
        // Fallback to viewCount if items have no data yet
        if (totalViews === 0 && post.viewCount) totalViews = post.viewCount;
      }

      const items = mediaItems.map((item: any) => {
        const views = item.metrics?.views || 0;
        const clicks = item.metrics?.clicks || 0;
        const saves = item.metrics?.saves || 0;
        const ctr = views > 0 ? (clicks / views) * 100 : 0;

        return {
          id: item.id,
          order: item.order,
          title: item.title,
          description: item.description,
          caption: item.caption,
          type: item.type,
          url: item.url,
          views,
          clicks,
          saves,
          dwellMs: item.metrics?.dwellMs || 0,
          ctr: parseFloat(ctr.toFixed(1))
        };
      });

      // Find best item based on Engagement Score (Clicks * 10 + Views)
      let bestItemId = null;
      if (items.length > 0) {
        const sorted = [...items].sort((a, b) => {
          const scoreA = (a.clicks * 10) + a.views;
          const scoreB = (b.clicks * 10) + b.views;
          return scoreB - scoreA;
        });
        bestItemId = sorted[0].id;
      }

      res.json({
        success: true,
        data: {
          postId: id,
          totals: {
            views: totalViews,
            clicks: totalClicks,
            saves: totalSaves
          },
          items,
          bestItemId
        }
      });
    } catch (error) {
      console.error('Error fetching post analytics:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
    }
  },

  // GET /api/posts/insights/me - Get identity-scoped post insights
  getMyInsights: async (req: Request, res: Response) => {
    try {
      const db = getDB();
      const authenticatedUserId = (req as any).user?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }

      const actor = await resolveIdentityActor(
        authenticatedUserId,
        {
          ownerType: req.query.ownerType as string,
          ownerId: req.query.ownerId as string
        },
        req.headers
      );
      if (!actor) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Unauthorized identity context' });
      }

      const postFilter = actor.type === 'company'
        ? { 'author.id': actor.id, 'author.type': 'company' }
        : {
          'author.id': actor.id,
          $or: [
            { 'author.type': 'user' },
            { 'author.type': { $exists: false } }
          ]
        };

      const posts = await db.collection(POSTS_COLLECTION)
        .find(postFilter)
        .toArray();

      const totalPosts = posts.length;

      const totalViews = posts.reduce((sum: number, p: any) => sum + (p.viewCount || 0), 0);

      const totalRadiance = posts.reduce((sum: number, p: any) => {
        const reactions = p.reactions || {};
        const reactionCount = Object.values(reactions).reduce((a: any, b: any) => (Number(a) || 0) + (Number(b) || 0), 0);
        return sum + (p.radiance || reactionCount || 0);
      }, 0);

      const boostedPosts = posts.filter((p: any) => p.isBoosted).length;

      const topPosts = posts
        .sort((a: any, b: any) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, 5)
        .map((p: any) => ({
          id: p.id,
          content: (p.content || '').slice(0, 120),
          views: p.viewCount || 0,
          reactions: p.reactions || {}
        }));

      return res.json({
        success: true,
        data: {
          totals: {
            totalPosts,
            totalViews,
            boostedPosts,
            totalRadiance
          },
          credits: {
            balance: 0,
            spent: 0
          },
          topPosts
        }
      });

    } catch (err) {
      console.error("Insights error:", err);
      return res.status(500).json({ success: false, error: "Failed to fetch insights" });
    }
  }
};
