import { Request, Response } from 'express';
import { getDB } from '../db';
import { getHashtagsFromText, filterByHashtags } from '../utils/hashtagUtils';

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
      const ads = await db.collection('ads')
        .find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(Number(limit))
        .toArray();
      
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
      const adData = req.body;
      const db = getDB();
      
      // Ensure required fields
      if (!adData.ownerId || !adData.headline) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }
      
      // Check if this is a special user (bypass subscription validation)
      const isSpecialUser = adData.ownerId === '1' || 
        (adData.ownerEmail && adData.ownerEmail.toLowerCase() === 'danelloosthuizen3@gmail.com');
      
      // Check subscription limits if subscriptionId is provided and not special user
      if (adData.subscriptionId && !isSpecialUser) {
        const subscription = await db.collection('adSubscriptions').findOne({ 
          id: adData.subscriptionId 
        });
        
        if (!subscription) {
          return res.status(404).json({ 
            success: false, 
            error: 'Subscription not found' 
          });
        }
        
        if (subscription.status !== 'active') {
          return res.status(400).json({ 
            success: false, 
            error: 'Subscription is not active' 
          });
        }
        
        // Check if subscription has expired
        if (subscription.endDate && Date.now() > subscription.endDate) {
          return res.status(400).json({ 
            success: false, 
            error: 'Subscription has expired' 
          });
        }
        
        // Check if user has reached ad limit
        if (subscription.adsUsed >= subscription.adLimit) {
          return res.status(400).json({ 
            success: false, 
            error: `Ad limit reached. You can create ${subscription.adLimit} ads with this plan.`,
            limit: subscription.adLimit,
            used: subscription.adsUsed
          });
        }
      }
      
      const newAd = {
        ...adData,
        id: adData.id || `ad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        reactions: {},
        reactionUsers: {},
        hashtags: getHashtagsFromText(adData.description || '')
      };
      
      await db.collection('ads').insertOne(newAd);
      
      // Increment ads used count if subscription is linked and not special user
      if (adData.subscriptionId && !isSpecialUser) {
        await db.collection('adSubscriptions').updateOne(
          { id: adData.subscriptionId },
          { 
            $inc: { adsUsed: 1 },
            $set: { updatedAt: Date.now() }
          }
        );
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
      
      const result = await db.collection('ads').findOneAndUpdate(
        { id },
        { $set: { status } },
        { returnDocument: 'after' }
      );
      
      if (!result) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }
      
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

      const analytics = await db.collection('adAnalytics').findOne({ adId: id });

      const impressions = analytics?.impressions || 0;
      const clicks = analytics?.clicks || 0;
      const engagement = analytics?.engagement || 0;
      const conversions = analytics?.conversions || 0;
      const spend = analytics?.spend || 0;
      const reach = analytics?.reach || impressions;
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const lastUpdated = analytics?.lastUpdated || Date.now();

      res.json({
        success: true,
        data: {
          adId: id,
          impressions,
          clicks,
          ctr,
          reach,
          engagement,
          conversions,
          spend,
          lastUpdated
        }
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

      const ads = await db.collection('ads').find({ ownerId: userId }).toArray();
      if (!ads || ads.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const adIds = ads.map((ad: any) => ad.id);
      const analyticsDocs = await db
        .collection('adAnalytics')
        .find({ adId: { $in: adIds } })
        .toArray();

      const analyticsMap = new Map<string, any>();
      analyticsDocs.forEach(doc => {
        analyticsMap.set(doc.adId, doc);
      });

      const metrics = ads.map((ad: any) => {
        const analytics = analyticsMap.get(ad.id) || {};
        const impressions = analytics.impressions || 0;
        const clicks = analytics.clicks || 0;
        const engagement = analytics.engagement || 0;
        const spend = analytics.spend || 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const roi = spend > 0 ? (engagement + clicks) / spend : 0;

        return {
          adId: ad.id,
          adName: ad.headline || ad.title || 'Untitled Ad',
          status: ad.status || 'active',
          impressions,
          clicks,
          ctr,
          engagement,
          spend,
          roi,
          createdAt: ad.timestamp || Date.now()
        };
      });

      res.json({
        success: true,
        data: metrics
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

      const adIds = ads.map((ad: any) => ad.id);
      const analyticsDocs = await db
        .collection('adAnalytics')
        .find({ adId: { $in: adIds } })
        .toArray();

      let totalImpressions = 0;
      let totalClicks = 0;
      let totalEngagement = 0;
      let totalSpend = 0;

      analyticsDocs.forEach(doc => {
        totalImpressions += doc.impressions || 0;
        totalClicks += doc.clicks || 0;
        totalEngagement += doc.engagement || 0;
        totalSpend += doc.spend || 0;
      });

      const totalReach = totalImpressions;
      const averageCTR =
        analyticsDocs.length > 0 && totalImpressions > 0
          ? (totalClicks / totalImpressions) * 100
          : 0;
      const activeAds = ads.filter((ad: any) => ad.status === 'active').length;
      
      // Calculate next expiry
      const now = Date.now();
      const activeAdsList = ads.filter((ad: any) => ad.status === 'active' && ad.expiryDate && ad.expiryDate > now);
      const nextExpiringAd = activeAdsList.sort((a: any, b: any) => (a.expiryDate || 0) - (b.expiryDate || 0))[0];
      const daysToNextExpiry = nextExpiringAd
        ? Math.ceil((nextExpiringAd.expiryDate - now) / (1000 * 60 * 60 * 24))
        : null;

      const performanceScore = Math.min(
        100,
        Math.round(
          (totalClicks * 2 + totalEngagement + totalImpressions * 0.01) /
            (activeAds || 1)
        )
      );

      const trendData: { date: string; impressions: number; clicks: number; engagement: number }[] =
        [];

      res.json({
        success: true,
        data: {
          totalImpressions,
          totalClicks,
          totalReach,
          totalEngagement,
          totalSpend,
          averageCTR,
          activeAds,
          daysToNextExpiry,
          performanceScore,
          trendData
        }
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

      const ad = await db.collection('ads').findOne({ id });

      await db.collection('adAnalytics').updateOne(
        { adId: id },
        {
          $setOnInsert: {
            adId: id,
            ownerId: ad?.ownerId || null,
            spend: 0,
            conversions: 0
          },
          $inc: {
            impressions: 1,
            reach: 1
          },
          $set: {
            lastUpdated: Date.now()
          }
        },
        { upsert: true }
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking ad impression:', error);
      res.status(500).json({ success: false, error: 'Failed to track ad impression' });
    }
  },

  trackClick: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });

      await db.collection('adAnalytics').updateOne(
        { adId: id },
        {
          $setOnInsert: {
            adId: id,
            ownerId: ad?.ownerId || null,
            spend: 0,
            conversions: 0
          },
          $inc: {
            clicks: 1
          },
          $set: {
            lastUpdated: Date.now()
          }
        },
        { upsert: true }
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking ad click:', error);
      res.status(500).json({ success: false, error: 'Failed to track ad click' });
    }
  },

  trackEngagement: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });

      await db.collection('adAnalytics').updateOne(
        { adId: id },
        {
          $setOnInsert: {
            adId: id,
            ownerId: ad?.ownerId || null,
            spend: 0,
            conversions: 0
          },
          $inc: {
            engagement: 1
          },
          $set: {
            lastUpdated: Date.now()
          }
        },
        { upsert: true }
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking ad engagement:', error);
      res.status(500).json({ success: false, error: 'Failed to track ad engagement' });
    }
  }
};
