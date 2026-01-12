import { Request, Response } from 'express';
import { getHashtagsFromText, getTrendingHashtags, filterByHashtags } from '../utils/hashtagUtils';
import { createNotificationInDB } from './notificationsController';

// Mock data - in production this would come from database
const mockPosts: any[] = [
  {
    id: 'post-1',
    author: {
      id: '1',
      firstName: 'James',
      lastName: 'Mitchell',
      name: 'James Mitchell',
      handle: '@jamesmitchell',
      avatar: 'https://picsum.photos/id/7/150/150'
    },
    content: 'Strategic leadership requires a balance of vision and execution. The most successful leaders don\'t just set direction—they create systems that sustain momentum through uncertainty. #leadership #strategy #execution #vision',
    energy: '💡 Deep Dive',
    radiance: 156,
    timestamp: Date.now() - 3600000,
    reactions: { '👍': 45, '💡': 23, '🚀': 12 },
    userReactions: [],
    comments: [],
    isBoosted: false,
    hashtags: ['leadership', 'strategy', 'execution', 'vision']
  },
  {
    id: 'post-2',
    author: {
      id: '2',
      firstName: 'Sarah',
      lastName: 'Williams',
      name: 'Sarah Williams',
      handle: '@sarahwilliams',
      avatar: 'https://picsum.photos/id/25/150/150'
    },
    content: 'Innovation isn\'t just about technology—it\'s about reimagining how we solve problems. The best innovations often come from questioning assumptions we didn\'t even know we had. #innovation #problemsolving #creativity #mindset',
    energy: '🚀 Breakthrough',
    radiance: 203,
    timestamp: Date.now() - 7200000,
    reactions: { '🚀': 67, '💡': 34, '🔥': 21 },
    userReactions: [],
    comments: [],
    isBoosted: true,
    hashtags: ['innovation', 'problemsolving', 'creativity', 'mindset']
  }
];

export const postsController = {
  // GET /api/posts - Get all posts
  getAllPosts: async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20, userId, energy, hashtags } = req.query;
      
      let filteredPosts = [...mockPosts];
      
      // Filter by user if specified
      if (userId) {
        filteredPosts = filteredPosts.filter(post => post.author.id === userId);
      }
      
      // Filter by energy type if specified
      if (energy) {
        filteredPosts = filteredPosts.filter(post => post.energy === energy);
      }
      
      // Filter by hashtags if specified
      if (hashtags) {
        const searchTags = Array.isArray(hashtags) ? hashtags : [hashtags];
        filteredPosts = filterByHashtags(filteredPosts, searchTags as string[]);
      }
      
      // Sort by timestamp (newest first)
      filteredPosts.sort((a, b) => b.timestamp - a.timestamp);
      
      // Pagination
      const startIndex = (Number(page) - 1) * Number(limit);
      const endIndex = startIndex + Number(limit);
      const paginatedPosts = filteredPosts.slice(startIndex, endIndex);
      
      res.json({
        success: true,
        data: paginatedPosts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: filteredPosts.length,
          pages: Math.ceil(filteredPosts.length / Number(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching posts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch posts',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/posts/:id - Get post by ID
  getPostById: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const post = mockPosts.find(p => p.id === id);
      
      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found',
          message: `Post with ID ${id} does not exist`
        });
      }
      
      res.json({
        success: true,
        data: post
      });
    } catch (error) {
      console.error('Error fetching post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch post',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/posts - Create new post
  createPost: async (req: Request, res: Response) => {
    try {
      const { content, mediaUrl, mediaType, energy, authorId } = req.body;
      
      // Validate required fields
      if (!content || !authorId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'content and authorId are required'
        });
      }

      // Extract hashtags from content
      const hashtags = getHashtagsFromText(content);

      // In production, fetch author from database
      const author = {
        id: authorId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authorId}`
      };

      const newPost = {
        id: `post-${Date.now()}`,
        author,
        content,
        mediaUrl: mediaUrl || undefined,
        mediaType: mediaType || undefined,
        energy: energy || '🪐 Neutral',
        radiance: 0,
        timestamp: Date.now(),
        reactions: {} as Record<string, number>,
        userReactions: [],
        comments: [],
        isBoosted: false,
        hashtags
      };

      // In production, save to database
      mockPosts.unshift(newPost);

      res.status(201).json({
        success: true,
        data: newPost,
        message: 'Post created successfully'
      });
    } catch (error) {
      console.error('Error creating post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create post',
        message: 'Internal server error'
      });
    }
  },

  // PUT /api/posts/:id - Update post
  updatePost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const postIndex = mockPosts.findIndex(p => p.id === id);
      if (postIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Post not found',
          message: `Post with ID ${id} does not exist`
        });
      }

      // Update post
      mockPosts[postIndex] = { ...mockPosts[postIndex], ...updates };

      res.json({
        success: true,
        data: mockPosts[postIndex],
        message: 'Post updated successfully'
      });
    } catch (error) {
      console.error('Error updating post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update post',
        message: 'Internal server error'
      });
    }
  },

  // DELETE /api/posts/:id - Delete post
  deletePost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const postIndex = mockPosts.findIndex(p => p.id === id);
      if (postIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Post not found',
          message: `Post with ID ${id} does not exist`
        });
      }

      // Remove post
      mockPosts.splice(postIndex, 1);

      res.json({
        success: true,
        message: 'Post deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete post',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/posts/:id/react - Add reaction to post
  reactToPost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reaction, userId } = req.body;
      
      const postIndex = mockPosts.findIndex(p => p.id === id);
      if (postIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Post not found'
        });
      }

      // In production, handle reaction logic with database
      const post = mockPosts[postIndex];
      if (!(post.reactions as any)[reaction]) {
        (post.reactions as any)[reaction] = 0;
      }
      (post.reactions as any)[reaction]++;
      
      // Create notification for post author if it's a like reaction and not from the author themselves
      if (reaction === '✨' && post.author.id !== userId) {
        await createNotificationInDB(
          post.author.id,  // recipient user ID
          'like',          // notification type
          userId,          // user who liked the post
          'liked your post', // message
          id               // post ID
        ).catch(err => console.error('Error creating like notification:', err));
      }

      res.json({
        success: true,
        data: post,
        message: 'Reaction added successfully'
      });
    } catch (error) {
      console.error('Error adding reaction:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add reaction',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/posts/:id/boost - Boost post
  boostPost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { userId } = req.body;
      
      const postIndex = mockPosts.findIndex(p => p.id === id);
      if (postIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Post not found'
        });
      }

      // In production, deduct credits and boost post
      mockPosts[postIndex].radiance += 100;
      mockPosts[postIndex].isBoosted = true;

      res.json({
        success: true,
        data: mockPosts[postIndex],
        message: 'Post boosted successfully'
      });
    } catch (error) {
      console.error('Error boosting post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to boost post',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/posts/:id/share - Share a post
  sharePost: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { userId } = req.body;
      
      const postIndex = mockPosts.findIndex(p => p.id === id);
      if (postIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Post not found'
        });
      }

      const post = mockPosts[postIndex];
      
      // Create notification for post author if not shared by the author themselves
      if (post.author.id !== userId) {
        await createNotificationInDB(
          post.author.id,  // recipient user ID
          'share',         // notification type
          userId,         // user who shared the post
          'shared your post', // message
          id              // post ID
        ).catch(err => console.error('Error creating share notification:', err));
      }

      res.json({
        success: true,
        data: post,
        message: 'Post shared successfully'
      });
    } catch (error) {
      console.error('Error sharing post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to share post',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/posts/hashtags/trending - Get trending hashtags
  getTrendingHashtags: async (req: Request, res: Response) => {
    try {
      const { limit = 10, hours = 24 } = req.query;
      
      const trendingTags = getTrendingHashtags(
        mockPosts,
        Number(limit),
        Number(hours)
      );
      
      res.json({
        success: true,
        data: trendingTags,
        message: 'Trending hashtags retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching trending hashtags:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch trending hashtags',
        message: 'Internal server error'
      });
    }
  }
};