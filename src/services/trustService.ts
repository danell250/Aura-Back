import { getDB } from '../db';
import { User } from '../types';
import { transformUser } from '../utils/userUtils';

interface TrustBreakdown {
  profileCompleteness: number;
  activityLevel: number;
  responseRate: number;
  positiveInteractions: number;
  accountAge: number;
  negativeFlags: number;
  total: number;
  level: TrustLevel;
}

type TrustLevel = 'verified' | 'trusted' | 'neutral' | 'caution' | 'unverified';

interface SerendipityMatch {
  user: any;
  compatibilityScore: number;
  trustScore: number;
  trustLevel: TrustLevel;
  mutualConnections: number;
  sharedHashtags: string[];
  industryMatch: boolean;
  profileCompleteness: {
    currentUser: number;
    candidate: number;
  };
  activityLevel: {
    currentUser: number;
    candidate: number;
  };
}

function clampScore(score: number): number {
  if (Number.isNaN(score) || !Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getAccountAgeDays(user: any): number {
  if (!user.createdAt) return 0;
  const created = new Date(user.createdAt).getTime();
  if (!created) return 0;
  const diffMs = Date.now() - created;
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
}

function calculateProfileCompleteness(user: any): number {
  const fields: (keyof User | string)[] = [
    'firstName',
    'lastName',
    'name',
    'handle',
    'avatar',
    'bio',
    'email',
    'dob',
    'phone'
  ];
  const filled = fields.reduce((acc, key) => {
    const value = (user as any)[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return acc + 1;
    }
    return acc;
  }, 0);
  const ratio = fields.length === 0 ? 0 : filled / fields.length;
  return clampScore(ratio * 25);
}

function calculateActivityLevel(postsCount: number): number {
  if (!postsCount || postsCount <= 0) return 0;
  const score = Math.min(postsCount, 50) / 50;
  return clampScore(score * 20);
}

const getMessageParty = (
  message: any,
  side: 'sender' | 'receiver'
): { type: 'user' | 'company'; id: string } | null => {
  const ownerTypeKey = side === 'sender' ? 'senderOwnerType' : 'receiverOwnerType';
  const ownerIdKey = side === 'sender' ? 'senderOwnerId' : 'receiverOwnerId';
  const legacyIdKey = side === 'sender' ? 'senderId' : 'receiverId';

  const ownerType = message?.[ownerTypeKey];
  const ownerId = message?.[ownerIdKey];
  if (
    (ownerType === 'user' || ownerType === 'company') &&
    typeof ownerId === 'string' &&
    ownerId.trim().length > 0
  ) {
    return { type: ownerType, id: ownerId };
  }

  const legacyId = message?.[legacyIdKey];
  if (typeof legacyId === 'string' && legacyId.trim().length > 0) {
    return { type: 'user', id: legacyId };
  }

  return null;
};

const getMessageTimestampMs = (message: any): number => {
  if (typeof message?.timestamp === 'number') return message.timestamp;
  const parsed = Date.parse(message?.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export function calculateResponseRate(messages: any[], userId: string): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  const incomingBySender = new Map<string, number[]>();
  const outgoingByReceiver = new Map<string, number[]>();

  for (const message of messages) {
    const sender = getMessageParty(message, 'sender');
    const receiver = getMessageParty(message, 'receiver');
    const timestamp = getMessageTimestampMs(message);
    if (!sender || !receiver || !timestamp) continue;

    // Incoming personal user->user message to current user.
    if (receiver.type === 'user' && receiver.id === userId && sender.type === 'user' && sender.id !== userId) {
      const incoming = incomingBySender.get(sender.id) || [];
      incoming.push(timestamp);
      incomingBySender.set(sender.id, incoming);
      continue;
    }

    // Outgoing personal user->user message from current user.
    if (sender.type === 'user' && sender.id === userId && receiver.type === 'user' && receiver.id !== userId) {
      const outgoing = outgoingByReceiver.get(receiver.id) || [];
      outgoing.push(timestamp);
      outgoingByReceiver.set(receiver.id, outgoing);
    }
  }

  let incomingMessagesTotal = 0;
  let respondedMessages = 0;

  for (const [senderId, incoming] of incomingBySender) {
    if (!incoming.length) continue;
    const outgoing = outgoingByReceiver.get(senderId) || [];
    const incomingWindow = incoming.length > 200 ? incoming.slice(-200) : [...incoming];
    const outgoingWindow = outgoing.length > 200 ? outgoing.slice(-200) : [...outgoing];
    incomingMessagesTotal += incomingWindow.length;

    if (!outgoingWindow.length) continue;

    let outgoingIndex = 0;
    for (const incomingTurnStart of incomingWindow) {
      while (outgoingIndex < outgoingWindow.length && outgoingWindow[outgoingIndex] <= incomingTurnStart) {
        outgoingIndex += 1;
      }

      if (outgoingIndex < outgoingWindow.length) {
        respondedMessages += 1;
        outgoingIndex += 1;
      }
    }
  }

  if (incomingMessagesTotal === 0) return 0;
  const ratio = respondedMessages / incomingMessagesTotal;
  return clampScore(ratio * 20);
}

function calculatePositiveInteractions(posts: any[]): number {
  if (!Array.isArray(posts) || posts.length === 0) return 0;
  let radianceSum = 0;
  let commentsReceived = 0;

  for (const post of posts) {
    if (typeof post.radiance === 'number') {
      radianceSum += post.radiance;
    }
    if (Array.isArray(post.comments)) {
      commentsReceived += post.comments.length;
    } else if (typeof post.commentCount === 'number') {
      commentsReceived += post.commentCount;
    }
  }

  const radianceScore = Math.min(radianceSum, 500) / 500;
  const commentsScore = Math.min(commentsReceived, 200) / 200;
  const combined = radianceScore * 0.6 + commentsScore * 0.4;
  return clampScore(combined * 20);
}

function calculateAccountAgeScore(user: any): number {
  const days = getAccountAgeDays(user);
  if (days <= 0) return 0;
  const score = Math.min(days, 365) / 365;
  return clampScore(score * 15);
}

function calculateNegativeFlags(user: any): number {
  let penalty = 0;

  const blockedByOthers = Array.isArray(user.blockedBy) ? user.blockedBy.length : 0;
  if (blockedByOthers > 0) {
    penalty -= Math.min(blockedByOthers * 3, 15);
  }

  const missingFields: (keyof User | string)[] = ['name', 'avatar', 'bio'];
  for (const key of missingFields) {
    const value = (user as any)[key];
    if (!value || (typeof value === 'string' && value.trim().length === 0)) {
      penalty -= 3;
    }
  }

  if (penalty < -20) {
    penalty = -20;
  }

  return penalty;
}

function getTrustLevel(score: number): TrustLevel {
  if (score >= 85) return 'verified';
  if (score >= 65) return 'trusted';
  if (score >= 45) return 'neutral';
  if (score >= 25) return 'caution';
  return 'unverified';
}

function getUserTrustScore(user: any): number {
  const value = typeof user.trustScore === 'number' ? user.trustScore : 0;
  return clampScore(value);
}

function calculateMutualConnections(user: any, targetUser: any): number {
  const userAcquaintances = new Set<string>(Array.isArray(user.acquaintances) ? user.acquaintances : []);
  const targetAcquaintances: string[] = Array.isArray(targetUser.acquaintances) ? targetUser.acquaintances : [];
  let count = 0;
  for (const id of targetAcquaintances) {
    if (userAcquaintances.has(id)) {
      count += 1;
    }
  }
  return count;
}

function buildHashtagSet(posts: any[]): Set<string> {
  const tags = new Set<string>();
  for (const post of posts) {
    if (Array.isArray(post.hashtags)) {
      for (const tag of post.hashtags) {
        if (typeof tag === 'string' && tag.trim().length > 0) {
          tags.add(tag.toLowerCase());
        }
      }
    }
  }
  return tags;
}

const buildPersonalPostFilter = (authorId: string) => ({
  'author.id': authorId,
  $or: [
    { 'author.type': 'user' },
    { 'author.type': { $exists: false } },
  ],
});

function calculateHashtagOverlapScore(baseTags: Set<string>, candidateTags: Set<string>): { score: number; shared: string[] } {
  if (!baseTags.size || !candidateTags.size) {
    return { score: 0, shared: [] };
  }
  const shared: string[] = [];
  baseTags.forEach(tag => {
    if (candidateTags.has(tag)) {
      shared.push(tag);
    }
  });
  const unionSize = baseTags.size + candidateTags.size - shared.length;
  if (unionSize <= 0) {
    return { score: 0, shared: [] };
  }
  const jaccard = shared.length / unionSize;
  const score = clampScore(jaccard * 15);
  return { score, shared };
}

function getIndustrySignalStub(_currentUser: any, _candidate: any): { score: number; match: boolean } {
  // Industry-based matching is intentionally disabled until company-membership scoring lands.
  return { score: 0, match: false };
}

export async function calculateUserTrust(
  userId: string,
  options: { persist?: boolean } = {}
): Promise<TrustBreakdown | null> {
  const db = getDB();
  const user = await db.collection('users').findOne({ id: userId });
  if (!user) return null;

  const posts = await db.collection('posts').find(buildPersonalPostFilter(userId)).toArray();

  const messagesCursor = db.collection('messages').find({
    $or: [
      {
        senderOwnerType: 'user',
        senderOwnerId: userId,
        receiverOwnerType: 'user',
      },
      {
        receiverOwnerType: 'user',
        receiverOwnerId: userId,
        senderOwnerType: 'user',
      },
      {
        senderId: userId,
        senderOwnerType: { $exists: false },
        receiverOwnerType: { $exists: false },
      },
      {
        receiverId: userId,
        senderOwnerType: { $exists: false },
        receiverOwnerType: { $exists: false },
      },
    ]
  }).sort({ timestamp: 1 });
  const messages = await messagesCursor.toArray();

  const profileCompleteness = calculateProfileCompleteness(user);
  const activityLevel = calculateActivityLevel(posts.length);
  const responseRate = calculateResponseRate(messages, userId);
  const positiveInteractions = calculatePositiveInteractions(posts);
  const accountAge = calculateAccountAgeScore(user);
  const negativeFlags = calculateNegativeFlags(user);

  const totalRaw =
    profileCompleteness +
    activityLevel +
    responseRate +
    positiveInteractions +
    accountAge +
    negativeFlags;

  const total = clampScore(totalRaw);
  const level = getTrustLevel(total);

  if (options.persist !== false) {
    await db.collection('users').updateOne(
      { id: userId },
      {
        $set: {
          trustScore: total,
          updatedAt: new Date().toISOString()
        }
      }
    );
  }

  return {
    profileCompleteness,
    activityLevel,
    responseRate,
    positiveInteractions,
    accountAge,
    negativeFlags,
    total,
    level
  };
}

export async function getSerendipityMatchesForUser(userId: string, limit: number = 20): Promise<SerendipityMatch[] | null> {
  const db = getDB();
  const currentUser = await db.collection('users').findOne({ id: userId });
  if (!currentUser) {
    return null;
  }

  const privacyFilter = {
    $or: [
      { 'privacySettings.showInSearch': { $ne: false } },
      { 'privacySettings.showInSearch': { $exists: false } }
    ]
  };

  const candidates = await db
    .collection('users')
    .find({
      id: { $ne: userId },
      ...privacyFilter
    })
    .limit(200)
    .toArray();

  const currentUserPosts = await db
    .collection('posts')
    .find(buildPersonalPostFilter(userId))
    .project({ hashtags: 1 })
    .toArray();

  const currentTags = buildHashtagSet(currentUserPosts);
  const currentActivity = calculateActivityLevel(currentUserPosts.length);
  const currentProfileCompleteness = calculateProfileCompleteness(currentUser);
  const currentTrust = getUserTrustScore(currentUser);
  const currentAcquaintances: string[] = Array.isArray(currentUser.acquaintances) ? currentUser.acquaintances : [];
  const currentBlockedUsers: string[] = Array.isArray(currentUser.blockedUsers) ? currentUser.blockedUsers : [];
  const currentBlockedBy: string[] = Array.isArray(currentUser.blockedBy) ? currentUser.blockedBy : [];
  const serendipitySkips: any[] = Array.isArray((currentUser as any).serendipitySkips)
    ? (currentUser as any).serendipitySkips
    : [];
  const skipCooldownMs = 7 * 24 * 60 * 60 * 1000;
  const skipCutoff = Date.now() - skipCooldownMs;

  const filteredCandidates = candidates.filter(candidate => {
    if (!candidate || !candidate.id) return false;
    const candidateId = candidate.id as string;
    if (candidateId === userId) return false;
    const candidateAcquaintances: string[] = Array.isArray(candidate.acquaintances) ? candidate.acquaintances : [];
    const candidateBlockedUsers: string[] = Array.isArray(candidate.blockedUsers) ? candidate.blockedUsers : [];
    const candidateBlockedBy: string[] = Array.isArray(candidate.blockedBy) ? candidate.blockedBy : [];
    if (currentAcquaintances.includes(candidateId)) return false;
    if (candidateAcquaintances.includes(userId)) return false;
    if (currentBlockedUsers.includes(candidateId)) return false;
    if (currentBlockedBy.includes(candidateId)) return false;
    if (candidateBlockedUsers.includes(userId)) return false;
    if (candidateBlockedBy.includes(userId)) return false;
    const skipEntry = serendipitySkips.find(s => s && s.targetUserId === candidateId);
    if (skipEntry) {
      const lastTime = new Date(skipEntry.lastSkippedAt).getTime();
      if (!Number.isNaN(lastTime) && lastTime > skipCutoff) {
        return false;
      }
    }
    return true;
  });

  const limitedCandidates = filteredCandidates.slice(0, 50);
  const candidateIds = limitedCandidates.map((candidate) => candidate.id).filter((id): id is string => typeof id === 'string');
  const candidatePostsById = new Map<string, any[]>();

  if (candidateIds.length > 0) {
    const candidatePosts = await db
      .collection('posts')
      .find({
        'author.id': { $in: candidateIds },
        $or: [{ 'author.type': 'user' }, { 'author.type': { $exists: false } }],
      })
      .project({ hashtags: 1, 'author.id': 1 })
      .toArray();

    for (const post of candidatePosts) {
      const authorId = post?.author?.id;
      if (typeof authorId !== 'string') continue;
      const existing = candidatePostsById.get(authorId) || [];
      existing.push(post);
      candidatePostsById.set(authorId, existing);
    }
  }

  const matches: SerendipityMatch[] = [];

  limitedCandidates.forEach((candidate) => {
    const candidatePosts = candidatePostsById.get(candidate.id) || [];
    const candidateTags = buildHashtagSet(candidatePosts);
    const hashtagResult = calculateHashtagOverlapScore(currentTags, candidateTags);
    const candidateActivity = calculateActivityLevel(candidatePosts.length);
    const candidateProfileCompleteness = calculateProfileCompleteness(candidate);
    const candidateTrust = getUserTrustScore(candidate);
    const mutualConnections = calculateMutualConnections(currentUser, candidate);
    const industryResult = getIndustrySignalStub(currentUser, candidate);

    const trustAverage = (currentTrust + candidateTrust) / 2;
    const trustComponent = clampScore((trustAverage / 100) * 35);

    const activityAverage = (currentActivity + candidateActivity) / 2;
    const activityComponent = clampScore((activityAverage / 20) * 8);

    const profileAverage = (currentProfileCompleteness + candidateProfileCompleteness) / 2;
    const profileComponent = clampScore((profileAverage / 25) * 7);

    const mutualNormalized = Math.min(mutualConnections, 5) / 5;
    const mutualComponent = clampScore(mutualNormalized * 20);

    const total =
      trustComponent +
      industryResult.score +
      hashtagResult.score +
      mutualComponent +
      activityComponent +
      profileComponent;

    const compatibilityScore = clampScore(total);
    const trustLevel = getTrustLevel(candidateTrust);

    matches.push({
      user: candidate,
      compatibilityScore,
      trustScore: candidateTrust,
      trustLevel,
      mutualConnections,
      sharedHashtags: hashtagResult.shared,
      industryMatch: industryResult.match,
      profileCompleteness: {
        currentUser: currentProfileCompleteness,
        candidate: candidateProfileCompleteness
      },
      activityLevel: {
        currentUser: currentActivity,
        candidate: candidateActivity
      }
    });
  });

  matches.sort((a, b) => b.compatibilityScore - a.compatibilityScore);

  const max = Math.max(1, Math.min(limit, 100));
  return matches.slice(0, max);
}

export async function recalculateAllTrustScores(): Promise<void> {
  const db = getDB();
  const usersCollection = db.collection('users');
  await Promise.allSettled([
    usersCollection.createIndex({ lastActiveAt: 1 }, { name: 'idx_users_last_active_at' }),
    usersCollection.createIndex({ updatedAt: 1 }, { name: 'idx_users_updated_at' }),
    usersCollection.createIndex({ createdAt: 1 }, { name: 'idx_users_created_at' }),
    usersCollection.createIndex({ lastLoginAt: 1 }, { name: 'idx_users_last_login_at' }),
    db.collection('posts').createIndex({ 'author.id': 1 }, { name: 'idx_posts_author_id' }),
    db
      .collection('messages')
      .createIndex(
        { senderOwnerType: 1, senderOwnerId: 1, receiverOwnerType: 1, receiverOwnerId: 1, timestamp: 1 },
        { name: 'idx_messages_sender_receiver_owner' }
      ),
    db
      .collection('messages')
      .createIndex(
        { receiverOwnerType: 1, receiverOwnerId: 1, senderOwnerType: 1, senderOwnerId: 1, timestamp: 1 },
        { name: 'idx_messages_receiver_sender_owner' }
      ),
    db.collection('messages').createIndex({ senderId: 1, receiverId: 1, timestamp: 1 }, { name: 'idx_messages_legacy' }),
  ]);
  const activeUserCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const activeUsersFilter = {
    $or: [
      { lastActiveAt: { $gte: activeUserCutoff } },
      { updatedAt: { $gte: activeUserCutoff } },
      { createdAt: { $gte: activeUserCutoff } },
      { lastLoginAt: { $gte: activeUserCutoff } },
    ],
  };
  const hasActiveTargets = (await usersCollection.countDocuments(activeUsersFilter, { limit: 1 })) > 0;
  const cursor = usersCollection
    .find(hasActiveTargets ? activeUsersFilter : {}, { projection: { id: 1 } })
    .batchSize(100);
  const batchSize = 10;
  const interBatchDelayMs = 25;
  let batch: string[] = [];

  const processBatch = async (userIds: string[]) => {
    const updates: Array<{ updateOne: { filter: { id: string }; update: { $set: { trustScore: number; updatedAt: string } } } }> = [];
    for (const userId of userIds) {
      try {
        const trust = await calculateUserTrust(userId, { persist: false });
        if (!trust) continue;

        updates.push({
          updateOne: {
            filter: { id: userId },
            update: {
              $set: {
                trustScore: trust.total,
                updatedAt: new Date().toISOString(),
              },
            },
          },
        });
      } catch (error) {
        console.error('Error recalculating trust for user', userId, error);
      }
    }

    if (updates.length > 0) {
      await usersCollection.bulkWrite(updates, { ordered: false });
    }
  };

  for await (const u of cursor as any) {
    if (!u?.id) continue;
    batch.push(u.id);
    if (batch.length >= batchSize) {
      await processBatch(batch);
      batch = [];
      await new Promise((resolve) => setTimeout(resolve, interBatchDelayMs));
    }
  }

  if (batch.length > 0) {
    await processBatch(batch);
  }
}

export function getTrustLevelForScore(score: number): TrustLevel {
  return getTrustLevel(score);
}
