import { Request, Response } from 'express';
import { getDB } from '../db';
import { getHashtagsFromText } from '../utils/hashtagUtils';
import { createNotificationInDB } from './notificationsController';

// MongoDB collection names
const POSTS_COLLECTION = 'posts';
const USERS_COLLECTION = 'users';

export const postsController = {
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

      // Basic search across content, author fields, and hashtags
      const posts = await db.collection(POSTS_COLLECTION)
        .find({
          $or: [
            { content: { $regex: query, $options: 'i' } },
            { 'author.name': { $regex: query, $options: 'i' } },
            { 'author.handle': { $regex: query, $options: 'i' } },
            { hashtags: { $elemMatch: { $regex: query, $options: 'i' } } }
          ]
        })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();

      res.json({ success: true, data: posts });
    } catch (error) {
      console.error('Error searching posts:', error);
      res.status(500).json({ success: false, error: 'Failed to search posts', message: 'Internal server error' });
    }
  },

  // GET /api/posts - Get all posts (with filters & pagination)
  getAllPosts: async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20, userId, energy, hashtags } = req.query as Record<string, any>;
      const db = getDB();

      const query: any = {};
      if (userId) query['author.id'] = userId;
      if (energy) query.energy = energy;
      if (hashtags) {
        const tags = Array.isArray(hashtags) ? hashtags : [hashtags];
        query.hashtags = { $in: tags };
      }

      const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);

      const total = await db.collection(POSTS_COLLECTION).countDocuments(query);
      
      const pipeline = [
        { $match: query },
        { $sort: { timestamp: -1 } },
        { $skip: (pageNum - 1) * limitNum },
        { $limit: limitNum },
        // Lookup comments to get count and preview
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
            // Populate comments with all fetched comments so they load immediately
            // If there are too many, we might want to slice, but for now this solves "immediate load"
            comments: '$fetchedComments' 
          }
        },
        {
          $project: {
            fetchedComments: 0
          }
        }
      ];

      const data = await db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();

      res.json({
        success: true,
        data,
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
      
      const pipeline = [
        { $match: { id } },
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
            comments: '$fetchedComments'
          }
        },
        { $project: { fetchedComments: 0 } }
      ];

      const posts = await db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();
      const post = posts[0];

      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
      }

      res.json({ success: true, data: post });
    } catch (error) {
      console.error('Error fetching post:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch post', message: 'Internal server error' });
    }
  },

  // POST /api/posts - Create new post
  createPost: async (req: Request, res: Response) => {
    try {
      const { content, mediaUrl, mediaType, energy, authorId } = req.body;
      if (!content || !authorId) {
        return res.status(400).json({ success: false, error: 'Missing required fields', message: 'content and authorId are required' });
      }

      const db = getDB();
      // Try to fetch full author from DB
      const author = await db.collection(USERS_COLLECTION).findOne({ id: authorId });
      const authorEmbed = author ? {
        id: author.id,
        firstName: author.firstName,
        lastName: author.lastName,
        name: author.name,
        handle: author.handle,
        avatar: author.avatar,
        avatarType: author.avatarType || 'image',
        activeGlow: author.activeGlow
      } : {
        id: authorId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authorId}`,
        avatarType: 'image',
        activeGlow: 'none'
      };

      const hashtags = getHashtagsFromText(content);
      const newPost = {
        id: `post-${Date.now()}`,
        author: authorEmbed,
        content,
        mediaUrl: mediaUrl || undefined,
        mediaType: mediaType || undefined,
        energy: energy || '🪐 Neutral',
        radiance: 0,
        timestamp: Date.now(),
        reactions: {} as Record<string, number>,
        userReactions: [] as string[], // optional per-user reaction tracking placeholder
        comments: [] as any[],
        isBoosted: false,
        hashtags
      };

      await db.collection(POSTS_COLLECTION).insertOne(newPost);
      res.status(201).json({ success: true, data: newPost, message: 'Post created successfully' });
    } catch (error) {
      console.error('Error creating post:', error);
      res.status(500).json({ success: false, error: 'Failed to create post', message: 'Internal server error' });
    }
  },

  // PUT /api/posts/:id - Update post (author only)
  updatePost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body || {};
      const db = getDB();

      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found', message: `Post with ID ${id} does not exist` });
      }

      // Auth check: only author can update
      const user = (req as any).user;
      if (!user || user.id !== post.author.id) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can update this post' });
      }

      // Prevent changing immutable fields
      delete updates.id; delete updates.author; delete updates.timestamp;

      if (typeof updates.content === 'string') {
        updates.hashtags = getHashtagsFromText(updates.content);
      }

      await db.collection(POSTS_COLLECTION).updateOne(
        { id },
        { $set: { ...updates, updatedAt: new Date().toISOString() } }
      );

      const updatedDoc = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!updatedDoc) {
        return res.status(500).json({ success: false, error: 'Failed to update post' });
      }
      res.json({ success: true, data: updatedDoc, message: 'Post updated successfully' });
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

      const user = (req as any).user;
      if (!user || user.id !== post.author.id) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can delete this post' });
      }

      await db.collection(POSTS_COLLECTION).deleteOne({ id });
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
      const { reaction, userId } = req.body;
      if (!reaction) {
        return res.status(400).json({ success: false, error: 'Missing reaction' });
      }

      const db = getDB();
      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }

      // Increment reaction counter
      const incField: any = {};
      incField[`reactions.${reaction}`] = 1;
      await db.collection(POSTS_COLLECTION).updateOne(
        { id },
        { $inc: incField }
      );

      const updatedAfterReaction = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!updatedAfterReaction) {
        return res.status(500).json({ success: false, error: 'Failed to apply reaction' });
      }

      // Notify author for a special reaction (example: '✨')
      if (reaction === '✨' && post.author.id !== userId) {
        await createNotificationInDB(
          post.author.id,
          'like',
          userId,
          'liked your post',
          id
        ).catch((err: any) => console.error('Error creating like notification:', err));
      }

      res.json({ success: true, data: updatedAfterReaction, message: 'Reaction added successfully' });
    } catch (error) {
      console.error('Error adding reaction:', error);
      res.status(500).json({ success: false, error: 'Failed to add reaction', message: 'Internal server error' });
    }
  },

  // POST /api/posts/:id/boost - Boost post and deduct credits server-side
  boostPost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { userId, credits } = req.body as { userId: string; credits?: number };
      const db = getDB();

      if (!userId) {
        return res.status(400).json({ success: false, error: 'Missing userId' });
      }

      const post = await db.collection(POSTS_COLLECTION).findOne({ id });
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }

      // Determine credits to spend, default to 100 if not provided
      const creditsToSpend = typeof credits === 'number' && credits > 0 ? credits : 100;

      // Fetch user and ensure enough credits
      const user = await db.collection(USERS_COLLECTION).findOne({ id: userId });
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const currentCredits = user.auraCredits || 0;
      if (currentCredits < creditsToSpend) {
        return res.status(400).json({ success: false, error: 'Insufficient credits' });
      }

      // Deduct credits
      const decRes = await db.collection(USERS_COLLECTION).updateOne(
        { id: userId, auraCredits: { $gte: creditsToSpend } },
        { $inc: { auraCredits: -creditsToSpend }, $set: { updatedAt: new Date().toISOString() } }
      );
      if (decRes.matchedCount === 0) {
        return res.status(400).json({ success: false, error: 'Insufficient credits' });
      }

      // Apply boost to post (radiance proportional to credits)
      const incRadiance = creditsToSpend * 2; // keep same multiplier as UI
      try {
        await db.collection(POSTS_COLLECTION).updateOne(
          { id },
          { $set: { isBoosted: true, updatedAt: new Date().toISOString() }, $inc: { radiance: incRadiance } }
        );

        const boostedDoc = await db.collection(POSTS_COLLECTION).findOne({ id });
        if (!boostedDoc) {
          // Rollback credits if somehow no doc
          await db.collection(USERS_COLLECTION).updateOne(
            { id: userId },
            { $inc: { auraCredits: creditsToSpend }, $set: { updatedAt: new Date().toISOString() } }
          );
          return res.status(500).json({ success: false, error: 'Failed to boost post' });
        }

        return res.json({ success: true, data: boostedDoc, message: 'Post boosted successfully' });
      } catch (e) {
        // Rollback user credits if boost failed
        await db.collection(USERS_COLLECTION).updateOne(
          { id: userId },
          { $inc: { auraCredits: creditsToSpend }, $set: { updatedAt: new Date().toISOString() } }
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
      const { userId } = req.body;
      const db = getDB();

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

  // GET /api/posts/hashtags/trending - Get trending hashtags
  getTrendingHashtags: async (req: Request, res: Response) => {
    try {
      const { limit = 10, hours = 24 } = req.query as Record<string, any>;
      const db = getDB();
      const since = Date.now() - (parseInt(String(hours), 10) || 24) * 60 * 60 * 1000;

      const pipeline = [
        { $match: { timestamp: { $gte: since } } },
        { $unwind: '$hashtags' },
        { $group: { _id: { $toLower: '$hashtags' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: Math.min(parseInt(String(limit), 10) || 10, 100) }
      ];

      const tags = await db.collection(POSTS_COLLECTION).aggregate(pipeline).toArray();
      res.json({ success: true, data: tags, message: 'Trending hashtags retrieved successfully' });
    } catch (error) {
      console.error('Error fetching trending hashtags:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch trending hashtags', message: 'Internal server error' });
    }
  }
};
