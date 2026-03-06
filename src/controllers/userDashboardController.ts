import { Request, Response } from 'express';
import { getDB } from '../db';
import { listJobMarketDemand } from '../services/jobMarketDemandService';
import { buildPersonalizedJobMarketDemandQuery } from '../services/jobMarketDemandPersonalizationService';

interface UserDashboardTotals {
  totalPosts: number;
  totalViews: number;
  boostedPosts: number;
  totalRadiance: number;
}

interface UserDashboardTopPost {
  id: string;
  preview: string;
  views: number;
  timestamp: number;
  isBoosted: boolean;
  radiance: number;
}

interface UserDashboardProfileViewer {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  avatarType: 'image' | 'video';
}

const dashboardDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formatDashboardHour = (hour: number): string => {
  const normalized = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 12;
  const meridiem = normalized >= 12 ? 'PM' : 'AM';
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${hour12}:00 ${meridiem}`;
};

const deriveDashboardTiming = (topPosts: UserDashboardTopPost[]): { bestTimeToPost: string; peakActivity: string } => {
  if (!topPosts.length) {
    return {
      bestTimeToPost: 'Wednesday 6:00 PM',
      peakActivity: 'Weekends',
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
    bestTimeToPost: `${dashboardDayNames[bestDay]} ${formatDashboardHour(bestHour)}`,
    peakActivity: bestDay === 0 || bestDay === 6 ? 'Weekends' : `${dashboardDayNames[bestDay]}s`,
  };
};

const deriveDashboardReachVelocity = (avgViews: number): string => {
  if (avgViews >= 1000) return 'Very High';
  if (avgViews >= 300) return 'High';
  if (avgViews >= 100) return 'Rising';
  if (avgViews > 0) return 'Growing';
  return 'Low';
};

const buildDashboardNeuralInsights = (
  totals: UserDashboardTotals,
  topPosts: UserDashboardTopPost[],
  adImpressions: number,
  adClicks: number,
  country?: string,
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
    Math.min(100, Math.round(20 + ctrValue * 12 + engagementRateValue * 5 + boostRatio * 20)),
  );
  const timing = deriveDashboardTiming(topPosts);
  const topLocations = country && country.trim() ? [country.trim()] : ['Global'];

  return {
    engagementHealth: `${engagementHealthScore}%`,
    reachVelocity: deriveDashboardReachVelocity(avgViewsPerPost),
    audienceBehavior: {
      retention: retentionScore >= 80 ? 'High' : retentionScore >= 55 ? 'Moderate' : 'Emerging',
      engagementRate: `${engagementRateValue.toFixed(1)}%`,
      topLocations,
    },
    timingOptimization: timing,
    conversionInsights: {
      clickThroughRate: `${ctrValue.toFixed(1)}%`,
      conversionScore,
    },
  };
};

export const userDashboardController = {
  getMyDashboard: async (req: Request, res: Response) => {
    try {
      const db = getDB();
      const currentUser = (req as any).user;
      if (!currentUser?.id) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const authorId = currentUser.id;
      const personalPostMatch = {
        'author.id': authorId,
        $or: [
          { 'author.type': 'user' },
          { 'author.type': { $exists: false } },
        ],
      };

      const [agg] = await db.collection('posts').aggregate([
        { $match: personalPostMatch },
        {
          $group: {
            _id: null,
            totalPosts: { $sum: 1 },
            totalViews: { $sum: { $ifNull: ['$viewCount', 0] } },
            boostedPosts: { $sum: { $cond: [{ $eq: ['$isBoosted', true] }, 1, 0] } },
            totalRadiance: { $sum: { $ifNull: ['$radiance', 0] } },
          },
        },
      ]).toArray();

      const topPosts = await db.collection('posts')
        .find(personalPostMatch)
        .project({ id: 1, content: 1, viewCount: 1, timestamp: 1, isBoosted: 1, radiance: 1 })
        .sort({ viewCount: -1 })
        .limit(5)
        .toArray();

      const [user, activeSub, adAgg] = await Promise.all([
        db.collection('users').findOne(
          { id: authorId },
          {
            projection: {
              auraCredits: 1,
              auraCreditsSpent: 1,
              country: 1,
              profileViews: 1,
              title: 1,
              preferredRoles: 1,
              preferredLocations: 1,
              preferredWorkModels: 1,
            },
          },
        ),
        db.collection('adSubscriptions').findOne({
          userId: authorId,
          status: 'active',
          $or: [
            { endDate: { $exists: false } },
            { endDate: { $gt: Date.now() } },
          ],
        }),
        db.collection('adAnalytics').aggregate([
          {
            $match: {
              $or: [
                { ownerId: authorId, ownerType: 'user' },
                { ownerId: authorId, ownerType: { $exists: false } },
                { userId: authorId },
              ],
            },
          },
          {
            $group: {
              _id: null,
              totalImpressions: { $sum: { $ifNull: ['$impressions', 0] } },
              totalClicks: { $sum: { $ifNull: ['$clicks', 0] } },
            },
          },
        ]).toArray().then((rows) => rows[0] || null),
      ]);

      const profileViewIds = Array.from(
        new Set(
          (Array.isArray(user?.profileViews) ? user.profileViews : [])
            .map((id: unknown) => String(id || '').trim())
            .filter((id: string) => id.length > 0),
        ),
      );

      let profileViewers: UserDashboardProfileViewer[] = [];
      if (profileViewIds.length > 0) {
        const viewerDocs = await db.collection('users')
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
            avatarType: viewer?.avatarType === 'video' ? 'video' : 'image',
          };
        });
      }

      let analyticsLevel = 'none';
      if (activeSub) {
        if (activeSub.packageId === 'pkg-enterprise') analyticsLevel = 'deep';
        else if (activeSub.packageId === 'pkg-pro') analyticsLevel = 'creator';
        else if (activeSub.packageId === 'pkg-starter') analyticsLevel = 'basic';
      }

      const totals: UserDashboardTotals = {
        totalPosts: agg?.totalPosts ?? 0,
        totalViews: agg?.totalViews ?? 0,
        boostedPosts: agg?.boostedPosts ?? 0,
        totalRadiance: agg?.totalRadiance ?? 0,
      };

      const mappedTopPosts: UserDashboardTopPost[] = topPosts.map((post: any) => ({
        id: post.id,
        preview: (post.content || '').slice(0, 120),
        views: post.viewCount ?? 0,
        timestamp: post.timestamp,
        isBoosted: !!post.isBoosted,
        radiance: post.radiance ?? 0,
      }));

      const neuralInsights = buildDashboardNeuralInsights(
        totals,
        mappedTopPosts,
        adAgg?.totalImpressions ?? 0,
        adAgg?.totalClicks ?? 0,
        user?.country,
      );

      const marketDemand = await listJobMarketDemand({
        db,
        query: buildPersonalizedJobMarketDemandQuery(user, 3),
        personalized: true,
      });

      return res.json({
        success: true,
        data: {
          totals,
          credits: {
            balance: user?.auraCredits ?? 0,
            spent: user?.auraCreditsSpent ?? 0,
          },
          profileViews: profileViewIds,
          profileViewers,
          topPosts: mappedTopPosts,
          neuralInsights,
          marketDemand,
        },
        planLevel: analyticsLevel,
      });
    } catch (error) {
      console.error('getMyDashboard error', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch dashboard data' });
    }
  },
};
