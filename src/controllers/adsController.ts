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
      
      const newAd = {
        ...adData,
        id: adData.id || `ad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        reactions: {},
        reactionUsers: {},
        hashtags: getHashtagsFromText(adData.description || '')
      };
      
      await db.collection('ads').insertOne(newAd);
      
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
  }
};
