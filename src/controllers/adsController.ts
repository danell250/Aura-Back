import { Request, Response } from 'express';
import { getDB } from '../db';
import { getHashtagsFromText, filterByHashtags } from '../utils/hashtagUtils';
import { AD_PLANS } from '../constants/adPlans';
import { ensureCurrentPeriod } from './adSubscriptionsController';




export const adsController = {
  // GET /api/ads - Get all ads
  getAllAds: async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 10, placement, status, ownerId, hashtags } = req.query;
      const currentUserId = (req as any).user?.id;
      const db = getDB();
      
      const query: any = {};
      
      // Filter by placement if specified
      if (placement) {
        query.placement = placement;
      }
      
      // Filter by status if specified
      if (status) {
        query.status = status;
      }
      
      // Filter by owner if specified
      if (ownerId) {
        query.ownerId = ownerId;
      }
      
      // Filter by hashtags if specified
      if (hashtags) {
        const searchTags = Array.isArray(hashtags) ? hashtags : [hashtags];
        query.hashtags = { $in: searchTags };
      }
      
      // Filter out expired ads
      const now = Date.now();
      query.$or = [
        { expiryDate: { $exists: false } },
        { expiryDate: { $gt: now } }
      ];
      
      const skip = (Number(page) - 1) * Number(limit);
      const ads = await db.collection('ads').aggregate([
        { $match: query },
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
            }
          }
        },
        { $sort: { totalReactions: -1, timestamp: -1 } },
        { $skip: skip },
        { $limit: Number(limit) }
      ]).toArray();
      
      // Add userReactions for current user
      if (currentUserId) {
        ads.forEach((ad: any) => {
          if (ad.reactionUsers) {
            ad.userReactions = Object.keys(ad.reactionUsers).filter(emoji => 
              Array.isArray(ad.reactionUsers[emoji]) && ad.reactionUsers[emoji].includes(currentUserId)
            );
          } else {
            ad.userReactions = [];
          }
        });
      }
      
      const total = await db.collection('ads').countDocuments(query);
      
      res.json({
        success: true,
        data: ads,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching ads:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch ads' });
    }
  },

  // POST /api/ads - Create a new ad
  createAd: async (req: Request, res: Response) => {
    try {
      const db = getDB();
      const currentUser = (req as any).user;
      const adData = req.body;
      
      if (!currentUser || !currentUser.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const userId = currentUser.id;

      // Ensure required fields
      if (!adData.headline) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      if (adData.ownerId && adData.ownerId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Owner mismatch',
          message: 'ownerId must match the authenticated user'
        });
      }

      const isSpecialUser =
        adData.ownerEmail &&
        adData.ownerEmail.toLowerCase() === 'danelloosthuizen3@gmail.com';

      let reservedSubscriptionId: string | null = null;
      let subscription: any | null = null;
      const now = Date.now();

      // Check subscription limits and enforce at ACTION TIME
      if (!isSpecialUser) {
        // Fetch active subscription for the user
        subscription = await db.collection('adSubscriptions').findOne({
          userId,
          status: 'active',
          $or: [
            { endDate: { $exists: false } },
            { endDate: { $gt: now } }
          ]
        });

        // If no active subscription, allow creation only if they have credits? 
        // OR strictly enforce plan.
        // Based on "pkg-starter" being $39, we should require a subscription.
        if (!subscription) {
           return res.status(403).json({
             success: false,
             error: 'No active ad plan found. Please purchase a plan to create signals.'
           });
        }

        // --- NEW LOGIC START ---
        // Ensure subscription period is up to date (resets adsUsed if new month)
        subscription = await ensureCurrentPeriod(db, subscription);
        
        // Hard monthly limit
        if (subscription.adsUsed >= subscription.adLimit) {
           const resetDate = subscription.periodEnd 
             ? new Date(subscription.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
             : 'next billing cycle';

           return res.status(409).json({
             success: false,
             code: 'AD_LIMIT_REACHED',
             error: 'AD_LIMIT_REACHED',
             message: `You’ve used all ${subscription.adLimit} ads for this month.`,
             adLimit: subscription.adLimit,
             adsUsed: subscription.adsUsed,
             periodEnd: subscription.periodEnd
           });
        }
        // --- NEW LOGIC END ---
      }

      const newAd = {
        ...adData,
        ownerId: userId,
        ownerActiveGlow: currentUser.activeGlow, // Enforce from trusted user object
        id: adData.id || `ad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        reactions: {},
        reactionUsers: {},
        hashtags: getHashtagsFromText(adData.description || '')
      };

      try {
        await db.collection('ads').insertOne(newAd);

        // Increment usage (atomic)
        if (!isSpecialUser && subscription) {
          await db.collection('adSubscriptions').updateOne(
            { id: subscription.id },
            { $inc: { adsUsed: 1 }, $set: { updatedAt: Date.now() } }
          );
        }

        await db.collection('adAnalytics').insertOne({
        adId: newAd.id,
        ownerId: newAd.ownerId,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        reach: 0,
        engagement: 0,
        conversions: 0,
        spend: 0,
        lastUpdated: Date.now()
        });
      } catch (error) {
        console.error('Error during ad creation transaction:', error);
        // If ad was created but subsequent steps failed, we might want to clean up
        // But for now, we just throw to ensure the client gets an error
        throw error;
      }

      res.status(201).json({
        success: true,
        data: newAd,
        message: 'Ad created successfully'
      });
    } catch (error) {
      console.error('Error creating ad:', error);
      res.status(500).json({ success: false, error: 'Failed to create ad' });
    }
  },

  // POST /api/ads/:id/react - React to an ad
  reactToAd: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reaction, userId } = req.body;
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const reactionUsers = ad.reactionUsers || {};
      const reactions = ad.reactions || {};
      
      // Initialize if needed
      if (!reactionUsers[reaction]) reactionUsers[reaction] = [];
      if (!reactions[reaction]) reactions[reaction] = 0;

      // Toggle reaction
      const userIndex = reactionUsers[reaction].indexOf(userId);
      if (userIndex > -1) {
        // Remove reaction
        reactionUsers[reaction].splice(userIndex, 1);
        reactions[reaction] = Math.max(0, reactions[reaction] - 1);
        if (reactions[reaction] === 0) delete reactions[reaction];
      } else {
        // Add reaction
        reactionUsers[reaction].push(userId);
        reactions[reaction]++;
      }

      await db.collection('ads').updateOne(
        { id },
        { 
          $set: { 
            reactions,
            reactionUsers
          } 
        }
      );

      // Calculate userReactions
      const userReactions = Object.keys(reactionUsers).filter(emoji => 
        reactionUsers[emoji].includes(userId)
      );

      res.json({
        success: true,
        data: {
          reactions,
          userReactions
        }
      });
    } catch (error) {
      console.error('Error reacting to ad:', error);
      res.status(500).json({ success: false, error: 'Failed to react to ad' });
    }
  },

  // GET /api/ads/:id - Get ad by ID
  getAdById: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const ad = await db.collection('ads').findOne({ id });
      
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }
      
      res.json({ success: true, data: ad });
    } catch (error) {
      console.error('Error fetching ad:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch ad' });
    }
  },

  // PUT /api/ads/:id - Update ad
  updateAd: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const db = getDB();
      
      // Don't allow updating id or ownerId
      delete updates.id;
      delete updates.ownerId;
      // Don't allow updating status via updateAd (must use updateAdStatus)
      delete updates.status;

      if (typeof updates.description === 'string') {
        updates.hashtags = getHashtagsFromText(updates.description || '');
      }
      
      const result = await db.collection('ads').findOneAndUpdate(
        { id },
        { $set: updates },
        { returnDocument: 'after' }
      );
      
      if (!result) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }
      
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error updating ad:', error);
      res.status(500).json({ success: false, error: 'Failed to update ad' });
    }
  },

  // DELETE /api/ads/:id - Delete ad
  deleteAd: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const currentUser = (req as any).user;

      if (!currentUser || !currentUser.id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          message: 'Please log in to delete ads'
        });
      }

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const isAdmin = currentUser.role === 'admin' || currentUser.isAdmin === true;
      if (!isAdmin && ad.ownerId !== currentUser.id) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'You can only delete your own ads'
        });
      }
      
      const result = await db.collection('ads').deleteOne({ id });
      
      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }
      
      res.json({ success: true, message: 'Ad deleted successfully' });
    } catch (error) {
      console.error('Error deleting ad:', error);
      res.status(500).json({ success: false, error: 'Failed to delete ad' });
    }
  },

  // PUT /api/ads/:id/status - Update ad status
  updateAdStatus: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const db = getDB();
      const currentUser = (req as any).user;

      if (!currentUser || !currentUser.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const isAdmin = currentUser.role === 'admin' || currentUser.isAdmin === true;
      if (!isAdmin && ad.ownerId !== currentUser.id) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      
      // Enforce limits if activating
      if (status === 'active' && ad.status !== 'active') {
        // Get active subscription
        const now = Date.now();
        let subscription = await db.collection('adSubscriptions').findOne({
          userId: currentUser.id,
          status: 'active',
          $or: [
            { endDate: { $exists: false } },
            { endDate: { $gt: now } }
          ]
        });

        if (subscription) {
           // Ensure period is current before checking limits
           subscription = await ensureCurrentPeriod(db, subscription);
        }

        // Note: Ad limit is enforced at creation time (Monthly Quota).
        // We do NOT check simultaneous active ads here.

        // Check impression limit
        if (subscription && subscription.impressionsUsed >= subscription.impressionLimit) {
           return res.status(403).json({
             success: false,
             error: `Monthly impression limit reached (${subscription.impressionLimit}). Upgrade or wait for renewal.`,
             limit: subscription.impressionLimit,
             current: subscription.impressionsUsed
           });
        }
      }

      const result = await db.collection('ads').findOneAndUpdate(
        { id },
        { $set: { status } },
        { returnDocument: 'after' }
      );
      
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error updating ad status:', error);
      res.status(500).json({ success: false, error: 'Failed to update ad status' });
    }
  },

  getAdAnalytics: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const currentUser = (req as any).user;
      const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
      if (!isAdmin && (!currentUser || currentUser.id !== ad.ownerId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'You do not have access to this ad analytics'
        });
      }

      const analytics = await db.collection('adAnalytics').findOne({ adId: id });

      // Check user subscription level
      const now = Date.now();
      const subscription = await db.collection('adSubscriptions').findOne({
        userId: currentUser.id, // Viewer is owner (checked above)
        status: 'active',
        $or: [{ endDate: { $exists: false } }, { endDate: { $gt: now } }]
      });

      const packageId = subscription ? subscription.packageId : 'pkg-starter';
      const isBasic = packageId === 'pkg-starter';
      const isPro = packageId === 'pkg-pro';
      const isEnterprise = packageId === 'pkg-enterprise';

      const impressions = analytics?.impressions ?? 0;
      const clicks = analytics?.clicks ?? 0;
      const engagement = analytics?.engagement ?? 0;
      const conversions = analytics?.conversions ?? 0;
      const spend = analytics?.spend ?? 0;
      const reach = analytics?.reach ?? impressions;
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const lastUpdated = analytics?.lastUpdated ?? Date.now();

      const data: any = {
        adId: id,
        impressions,
        clicks,
        ctr,
        reach,
        engagement,
        conversions,
        spend,
        lastUpdated
      };

      if (!isBasic) {
        // data.engagement = engagement; // Always include for consistency
        // data.spend = spend; // Always include for consistency
      }

      if (isEnterprise) {
        // Mock deep analytics for now
        data.audience = {
          sentiment: 'positive',
          demographics: { '18-24': 30, '25-34': 45 }
        };
      }

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error fetching ad analytics:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch ad analytics' });
    }
  },

  getUserAdPerformance: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const db = getDB();

      const currentUser = (req as any).user;
      const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
      if (!isAdmin && (!currentUser || currentUser.id !== userId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'You can only view analytics for your own ads'
        });
      }

      const ads = await db.collection('ads').find({ ownerId: userId }).toArray();
      if (!ads || ads.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const adIds = ads.map((ad: any) => ad.id);
      const analyticsDocs = await db
        .collection('adAnalytics')
        .find({ adId: { $in: adIds } })
        .toArray();

      // Check user subscription level
      const now = Date.now();
      const subscription = await db.collection('adSubscriptions').findOne({
        userId,
        status: 'active',
        $or: [{ endDate: { $exists: false } }, { endDate: { $gt: now } }]
      });

      const packageId = subscription ? subscription.packageId : 'pkg-starter';

      const analyticsMap = new Map<string, any>();
      analyticsDocs.forEach(doc => {
        analyticsMap.set(doc.adId, doc);
      });

      const data = ads.map((ad: any) => {
        const analytics = analyticsMap.get(ad.id);
        const impressions = analytics?.impressions ?? 0;
        const clicks = analytics?.clicks ?? 0;
        const engagement = analytics?.engagement ?? 0;
        const conversions = analytics?.conversions ?? 0;
        const spend = analytics?.spend ?? 0;
        const reach = analytics?.reach ?? impressions;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const lastUpdated = analytics?.lastUpdated ?? ad.timestamp;

        return {
          adId: ad.id,
          adName: ad.headline,
          status: ad.status,
          impressions,
          clicks,
          ctr,
          engagement,
          spend,
          reach,
          conversions,
          lastUpdated,
          roi: spend > 0 ? (engagement + clicks) / spend : 0,
          createdAt: ad.timestamp
        };
      });

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error fetching user ad performance:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch user ad performance' });
    }
  },

  getCampaignPerformance: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const db = getDB();

      const currentUser = (req as any).user;
      const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
      if (!isAdmin && (!currentUser || currentUser.id !== userId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'You can only view campaign analytics for your own ads'
        });
      }

      const ads = await db.collection('ads').find({ ownerId: userId }).toArray();
      if (!ads || ads.length === 0) {
        return res.json({
          success: true,
          data: {
            totalImpressions: 0,
            totalClicks: 0,
            totalReach: 0,
            totalEngagement: 0,
            totalSpend: 0,
            averageCTR: 0,
            activeAds: 0,
            performanceScore: 0,
            trendData: []
          }
        });
      }

      // Check user subscription level
      const now = Date.now();
      const subscription = await db.collection('adSubscriptions').findOne({
        userId,
        status: 'active',
        $or: [{ endDate: { $exists: false } }, { endDate: { $gt: now } }]
      });

      const packageId = subscription ? subscription.packageId : 'pkg-starter';
      const isBasic = packageId === 'pkg-starter';
      // const isPro = packageId === 'pkg-pro';
      // const isEnterprise = packageId === 'pkg-enterprise';

      let totalImpressions = 0;
      let totalClicks = 0;
      let totalEngagement = 0;
      let totalSpend = 0;
      let totalConversions = 0;
      let activeAds = 0;
      let totalReach = 0;

      const adIds = ads.map((ad: any) => ad.id);
      const analyticsDocs = await db
        .collection('adAnalytics')
        .find({ adId: { $in: adIds } })
        .toArray();

      const analyticsMap = new Map<string, any>();
      analyticsDocs.forEach(doc => {
        analyticsMap.set(doc.adId, doc);
      });

      ads.forEach((ad: any) => {
        if (ad.status === 'active') activeAds++;
        
        const analytics = analyticsMap.get(ad.id);
        if (analytics) {
          totalImpressions += (analytics.impressions ?? 0);
          totalClicks += (analytics.clicks ?? 0);
          
          // Include all metrics regardless of plan for now to ensure data visibility
          // We can enforce strict plan limits later if needed
          totalEngagement += (analytics.engagement ?? 0);
          totalSpend += (analytics.spend ?? 0);
          totalConversions += (analytics.conversions ?? 0);
          
          totalReach += (analytics.reach ?? analytics.impressions ?? 0);
        }
      });

      const averageCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      
      // Calculate a performance score (0-100)
      // Weighted: 30% CTR, 30% Engagement Rate, 40% active/fresh factor
      const ctrScore = Math.min(100, (averageCTR / 2) * 100); // 2% CTR = 100 score
      let performanceScore = 0;

      if (isBasic) {
        // For basic plan, weight: 50% CTR, 50% active/fresh
        performanceScore = Math.round((ctrScore * 0.5) + (Math.min(100, activeAds * 20) * 0.5));
      } else {
        const engRate = totalImpressions > 0 ? totalEngagement / totalImpressions : 0;
        const engScore = Math.min(100, (engRate / 0.05) * 100); // 5% engagement = 100 score
        performanceScore = Math.round((ctrScore * 0.3) + (engScore * 0.3) + (Math.min(100, activeAds * 20) * 0.4));
      }

      const daysToNextExpiry = subscription?.endDate 
        ? Math.ceil((subscription.endDate - now) / (1000 * 60 * 60 * 24))
        : null;

      const build7DayTrend = (analyticsDocs: any[]) => {
        const days = 7;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (days - 1));

        const buckets = new Map<string, { date: string; impressions: number; clicks: number; engagement: number; spend: number }>();

        for (let i = 0; i < days; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          buckets.set(key, {
            date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            impressions: 0,
            clicks: 0,
            engagement: 0,
            spend: 0
          });
        }

        for (const doc of analyticsDocs) {
          const ts = doc.lastUpdated || Date.now();
          const d = new Date(ts);
          d.setHours(0, 0, 0, 0);
          const key = d.toISOString().slice(0, 10);
          const b = buckets.get(key);
          if (!b) continue;

          b.impressions += doc.impressions || 0;
          b.clicks += doc.clicks || 0;
          
          // Include all metrics regardless of plan
          b.engagement += doc.engagement || 0;
          b.spend += doc.spend || 0;
        }

        return Array.from(buckets.values());
      };

      const trendData = build7DayTrend(analyticsDocs);

      const data: any = {
        totalImpressions,
        totalClicks,
        totalReach,
        totalEngagement,
        totalSpend,
        totalConversions,
        averageCTR,
        activeAds,
        daysToNextExpiry,
        performanceScore,
        trendData
      };

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error fetching campaign performance:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch campaign performance' });
    }
  },

  trackImpression: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      
      // 1. Get Ad to find owner
      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
          // If ad missing, we can't attribute cost, but we should still track impression?
          // No, if ad is gone, we shouldn't be serving it.
          return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      // 2. Determine Cost Per Impression (CPI)
      let cpi = 0;
      
      // Look up active subscription for the ad owner
      const now = Date.now();
      const subscription = await db.collection('adSubscriptions').findOne({
          userId: ad.ownerId,
          status: 'active',
          $or: [{ endDate: { $exists: false } }, { endDate: { $gt: now } }]
      });

      if (subscription && subscription.packageId) {
          const plan = AD_PLANS[subscription.packageId as keyof typeof AD_PLANS];
          if (plan && plan.impressionLimit > 0) {
              cpi = plan.numericPrice / plan.impressionLimit;
          }
      }

      await db.collection('adAnalytics').updateOne(
        { adId: id },
        { 
          $inc: { 
            impressions: 1, 
            reach: 1, 
            spend: cpi 
          }, 
          $set: { lastUpdated: Date.now() } 
        }, 
        { upsert: true }
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking impression:', error);
      res.status(500).json({ success: false, error: 'Failed to track impression' });
    }
  },

  trackClick: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      
      const analytics = await db.collection('adAnalytics').findOne({ adId: id });
      const impressions = analytics?.impressions || 1; // Prevent div/0
      const currentClicks = analytics?.clicks || 0;
      
      await db.collection('adAnalytics').updateOne(
        { adId: id },
        { 
          $inc: { clicks: 1 }, 
          $set: { 
            lastUpdated: Date.now(), 
            ctr: ((currentClicks + 1) / impressions) * 100 
          } 
        }, 
        { upsert: true }
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking click:', error);
      res.status(500).json({ success: false, error: 'Failed to track click' });
    }
  },

  trackEngagement: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      
      await db.collection('adAnalytics').updateOne(
        { adId: id },
        { 
          $inc: { engagement: 1 }, 
          $set: { lastUpdated: Date.now() } 
        }, 
        { upsert: true }
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking engagement:', error);
      res.status(500).json({ success: false, error: 'Failed to track engagement' });
    }
  },

  trackConversion: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      
      // A conversion is a high-value action. We might want to track metadata (e.g. value, type)
      // For now, we just increment the counter.
      await db.collection('adAnalytics').updateOne(
        { adId: id },
        { 
          $inc: { conversions: 1 }, 
          $set: { lastUpdated: Date.now() } 
        }, 
        { upsert: true }
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking conversion:', error);
      res.status(500).json({ success: false, error: 'Failed to track conversion' });
    }
  }
};
