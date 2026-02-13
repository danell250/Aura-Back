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

function calculateResponseRate(messages: any[], userId: string): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  let responded = 0;
  let totalRelevant = 0;

  for (const msg of messages) {
    const senderId = msg.senderId;
    const receiverId = msg.receiverId;
    const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Date.parse(msg.timestamp);

    if (!senderId || !receiverId || !timestamp) continue;

    if (receiverId === userId) {
      totalRelevant += 1;
      const thread = messages.filter(
        m =>
          ((m.senderId === senderId && m.receiverId === receiverId) ||
            (m.senderId === receiverId && m.receiverId === senderId)) &&
          typeof m.timestamp !== 'undefined'
      );
      const replies = thread.filter(
        m =>
          m.senderId === userId &&
          (typeof m.timestamp === 'number'
            ? m.timestamp
            : Date.parse(m.timestamp)) > timestamp
      );
      if (replies.length > 0) {
        responded += 1;
      }
    }
  }

  if (totalRelevant === 0) return 0;
  const ratio = responded / totalRelevant;
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

function calculateIndustryMatchScore(currentUser: any, candidate: any): { score: number; match: boolean } {
  // Industry-based matching for users is deprecated as industry is no longer stored on User objects.
  // Future implementation will use company memberships.
  return { score: 0, match: false };
}

export async function calculateUserTrust(userId: string): Promise<TrustBreakdown | null> {
  const db = getDB();
  const user = await db.collection('users').findOne({ id: userId });
  if (!user) return null;

  const posts = await db.collection('posts').find({ 'author.id': userId }).toArray();

  const messagesCursor = db.collection('messages').find({
    $or: [{ senderId: userId }, { receiverId: userId }]
  });
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

  await db.collection('users').updateOne(
    { id: userId },
    {
      $set: {
        trustScore: total,
        updatedAt: new Date().toISOString()
      }
    }
  );

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
    .find({ 'author.id': userId })
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

  const candidatePostsList = await Promise.all(
    limitedCandidates.map(candidate =>
      db
        .collection('posts')
        .find({ 'author.id': candidate.id })
        .project({ hashtags: 1 })
        .toArray()
    )
  );

  const matches: SerendipityMatch[] = [];

  limitedCandidates.forEach((candidate, index) => {
    const candidatePosts = candidatePostsList[index] || [];
    const candidateTags = buildHashtagSet(candidatePosts);
    const hashtagResult = calculateHashtagOverlapScore(currentTags, candidateTags);
    const candidateActivity = calculateActivityLevel(candidatePosts.length);
    const candidateProfileCompleteness = calculateProfileCompleteness(candidate);
    const candidateTrust = getUserTrustScore(candidate);
    const mutualConnections = calculateMutualConnections(currentUser, candidate);
    const industryResult = calculateIndustryMatchScore(currentUser, candidate);

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
  const users = await db.collection('users').find({}).project({ id: 1 }).toArray();
  for (const u of users) {
    if (!u.id) continue;
    try {
      await calculateUserTrust(u.id);
    } catch (err) {
      console.error('Error recalculating trust for user', u.id, err);
    }
  }
}

export function getTrustLevelForScore(score: number): TrustLevel {
  return getTrustLevel(score);
}
