import { Request, Response } from 'express';
import { getDB } from '../db';

const COMMENTS_COLLECTION = 'comments';
const USERS_COLLECTION = 'users';

export const commentsController = {
  // GET /api/posts/:postId/comments - Get comments for a post
  getCommentsByPost: async (req: Request, res: Response) => {
    try {
      const { postId } = req.params;
      const { page = 1, limit = 50 } = req.query as Record<string, any>;
      const db = getDB();

      const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

      const query = { postId };
      const total = await db.collection(COMMENTS_COLLECTION).countDocuments(query);
      const data = await db.collection(COMMENTS_COLLECTION)
        .find(query)
        .sort({ timestamp: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .toArray();

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
      console.error('Error fetching comments:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch comments', message: 'Internal server error' });
    }
  },

  // GET /api/comments/:id - Get comment by ID
  getCommentById: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const comment = await db.collection(COMMENTS_COLLECTION).findOne({ id });
      if (!comment) {
        return res.status(404).json({ success: false, error: 'Comment not found', message: `Comment with ID ${id} does not exist` });
      }
      res.json({ success: true, data: comment });
    } catch (error) {
      console.error('Error fetching comment:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch comment', message: 'Internal server error' });
    }
  },

  // POST /api/posts/:postId/comments - Create new comment
  createComment: async (req: Request, res: Response) => {
    try {
      const { postId } = req.params;
      const { text, authorId, parentId } = req.body as { text: string; authorId: string; parentId?: string };
      if (!text || !authorId) {
        return res.status(400).json({ success: false, error: 'Missing required fields', message: 'text and authorId are required' });
      }

      const db = getDB();
      const author = await db.collection(USERS_COLLECTION).findOne({ id: authorId });
      const authorEmbed = author ? {
        id: author.id,
        firstName: author.firstName,
        lastName: author.lastName,
        name: author.name,
        handle: author.handle,
        avatar: author.avatar,
        avatarType: author.avatarType || 'image'
      } : {
        id: authorId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authorId}`,
        avatarType: 'image'
      };

      const newComment = {
        id: `comment-${Date.now()}`,
        postId,
        author: authorEmbed,
        text,
        timestamp: Date.now(),
        parentId: parentId || null,
        reactions: {} as Record<string, number>,
        userReactions: [] as string[]
      };

      await db.collection(COMMENTS_COLLECTION).insertOne(newComment);
      res.status(201).json({ success: true, data: newComment, message: 'Comment created successfully' });
    } catch (error) {
      console.error('Error creating comment:', error);
      res.status(500).json({ success: false, error: 'Failed to create comment', message: 'Internal server error' });
    }
  },

  // PUT /api/comments/:id - Update comment (author-only)
  updateComment: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { text } = req.body as { text?: string };
      const db = getDB();

      const existing = await db.collection(COMMENTS_COLLECTION).findOne({ id });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Comment not found', message: `Comment with ID ${id} does not exist` });
      }

      const user = (req as any).user;
      if (!user || user.id !== existing.author.id) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can update this comment' });
      }

      const updates: any = {};
      if (typeof text === 'string') updates.text = text;
      updates.updatedAt = new Date().toISOString();

      await db.collection(COMMENTS_COLLECTION).updateOne({ id }, { $set: updates });
      const updated = await db.collection(COMMENTS_COLLECTION).findOne({ id });
      res.json({ success: true, data: updated, message: 'Comment updated successfully' });
    } catch (error) {
      console.error('Error updating comment:', error);
      res.status(500).json({ success: false, error: 'Failed to update comment', message: 'Internal server error' });
    }
  },

  // DELETE /api/comments/:id - Delete comment (author-only)
  deleteComment: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const existing = await db.collection(COMMENTS_COLLECTION).findOne({ id });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Comment not found', message: `Comment with ID ${id} does not exist` });
      }

      const user = (req as any).user;
      if (!user || user.id !== existing.author.id) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only the author can delete this comment' });
      }

      await db.collection(COMMENTS_COLLECTION).deleteOne({ id });
      res.json({ success: true, message: 'Comment deleted successfully' });
    } catch (error) {
      console.error('Error deleting comment:', error);
      res.status(500).json({ success: false, error: 'Failed to delete comment', message: 'Internal server error' });
    }
  },

  // POST /api/comments/:id/react - Add reaction to comment
  reactToComment: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reaction } = req.body as { reaction: string };

      if (!reaction) {
        return res.status(400).json({ success: false, error: 'Missing reaction' });
      }

      const db = getDB();
      const existing = await db.collection(COMMENTS_COLLECTION).findOne({ id });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Comment not found' });
      }

      const incField: any = {}; incField[`reactions.${reaction}`] = 1;
      await db.collection(COMMENTS_COLLECTION).updateOne({ id }, { $inc: incField });
      const updated = await db.collection(COMMENTS_COLLECTION).findOne({ id });

      res.json({ success: true, data: updated, message: 'Reaction added successfully' });
    } catch (error) {
      console.error('Error adding reaction:', error);
      res.status(500).json({ success: false, error: 'Failed to add reaction', message: 'Internal server error' });
    }
  }
};
