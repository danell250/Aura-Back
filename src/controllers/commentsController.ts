import { Request, Response } from 'express';
import { getDB } from '../db';
import { createNotificationInDB } from './notificationsController';
import { transformUser } from '../utils/userUtils';
import { emitAuthorInsightsUpdate } from './postsController';
import { normalizeTaggedIdentityIds, resolveMentionedIdentityIds } from '../utils/mentionUtils';

const COMMENTS_COLLECTION = 'comments';
const USERS_COLLECTION = 'users';

export const commentsController = {
  // GET /api/posts/:postId/comments - Get comments for a post
  getCommentsByPost: async (req: Request, res: Response) => {
    try {
      const { postId } = req.params;
      const { page = 1, limit = 50 } = req.query as Record<string, any>;
      const db = getDB();
      const currentUserId = (req as any).user?.id;

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

      // Extract unique author IDs to fetch latest profile data
      const authorIds = [...new Set(data.map((c: any) => c.author?.id).filter(Boolean))];

      // Fetch latest user details to ensure avatars/names are up-to-date
      const authors = await db.collection(USERS_COLLECTION)
        .find({ id: { $in: authorIds } })
        .project({
          id: 1, firstName: 1, lastName: 1, name: 1, handle: 1,
          avatar: 1, avatarKey: 1, avatarType: 1, isVerified: 1
        })
        .toArray();

      const authorMap = new Map(authors.map((u: any) => [u.id, u]));

      // Post-process to update author info and add userReactions
      data.forEach((comment: any) => {
        // Update author with latest data if available
        if (comment.author?.id && authorMap.has(comment.author.id)) {
          const latestAuthor = authorMap.get(comment.author.id);
          comment.author = transformUser(latestAuthor);
        } else if (comment.author) {
          comment.author = transformUser(comment.author);
        }
      });

      if (currentUserId) {
        data.forEach((comment: any) => {
          if (comment.reactionUsers) {
            comment.userReactions = Object.keys(comment.reactionUsers).filter(emoji =>
              Array.isArray(comment.reactionUsers[emoji]) && comment.reactionUsers[emoji].includes(currentUserId)
            );
          } else {
            comment.userReactions = [];
          }
        });
      }

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

      // Fetch latest author info
      if (comment.author?.id) {
        const latestAuthor = await db.collection(USERS_COLLECTION).findOne({ id: comment.author.id });
        if (latestAuthor) {
          comment.author = transformUser(latestAuthor);
        } else {
          comment.author = transformUser(comment.author);
        }
      }

      res.json({ success: true, data: comment });
    } catch (error) {
      console.error('Error fetching comment:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch comment', message: 'Internal server error' });
    }
  },

  createComment: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req as any).user?.id as string | undefined;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }

      const { postId } = req.params;
      const { text, parentId, taggedUserIds, tempId } = req.body as { text: string; parentId?: string; taggedUserIds?: string[], tempId?: string };
      if (!text) {
        return res.status(400).json({ success: false, error: 'Missing required fields', message: 'text is required' });
      }

      const db = getDB();
      const author = await db.collection(USERS_COLLECTION).findOne({ id: authenticatedUserId });
      const authorEmbed = author ? {
        id: author.id,
        firstName: author.firstName,
        lastName: author.lastName,
        name: author.name,
        handle: author.handle,
        avatar: author.avatar,
        avatarKey: author.avatarKey,
        avatarType: author.avatarType || 'image',
        activeGlow: author.activeGlow
      } : {
        id: authenticatedUserId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authenticatedUserId}`,
        avatarType: 'image',
        activeGlow: undefined
      };

      const explicitTagList = normalizeTaggedIdentityIds(taggedUserIds);
      const resolvedMentionIds =
        explicitTagList.length > 0 || typeof text !== 'string' || !text.includes('@')
          ? []
          : await resolveMentionedIdentityIds(db, text, 8);
      const tagList = Array.from(new Set([...explicitTagList, ...resolvedMentionIds]));

      const newComment = {
        id: `comment-${Date.now()}`,
        postId,
        author: authorEmbed,
        text,
        timestamp: Date.now(),
        parentId: parentId || null,
        reactions: {} as Record<string, number>,
        reactionUsers: {} as Record<string, string[]>,
        userReactions: [] as string[],
        taggedUserIds: tagList
      };

      await db.collection(COMMENTS_COLLECTION).insertOne(newComment);

      try {
        const post = await db.collection('posts').findOne({ id: postId });
        if (post && post.author && post.author.id && post.author.id !== authenticatedUserId) {
          await createNotificationInDB(
            post.author.id,
            'comment',
            authenticatedUserId,
            'commented on your post',
            postId
          );
        }

        if (tagList.length > 0) {
          const uniqueTagIds = Array.from(new Set(tagList)).filter(id => id && id !== authorEmbed.id);
          await Promise.all(
            uniqueTagIds.map(id =>
              createNotificationInDB(
                id,
                'mention',
                authorEmbed.id,
                'mentioned you in a comment',
                postId
              ).catch(err => {
                console.error('Error creating comment mention notification:', err);
              })
            )
          );
        }

        if (post && post.author && post.author.id) {
          emitAuthorInsightsUpdate(
            req.app,
            post.author.id,
            post.author?.type === 'company' ? 'company' : 'user'
          );
        }
      } catch (e) {
        console.error('Error creating comment notification:', e);
      }

      if (newComment.author) {
        newComment.author = transformUser(newComment.author);
      }

      // Emit real-time event for new comment
      const io = req.app.get('io');
      if (io) {
        io.emit('comment_added', {
          postId,
          comment: newComment,
          tempId // Pass back the temporary ID for optimistic update reconciliation
        });

        // Also emit post update to ensure counts are synced
        // We don't send the whole post, just the ID and updated count/metadata if needed
        // But since we have comment_added, frontend can increment count locally.
        // However, let's also emit a lightweight post_updated for safety if we want
      }

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

      const io = req.app.get('io');
      if (io) {
        io.emit('comment_updated', {
          postId: existing.postId,
          comment: updated
        });
      }

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

      // Trigger live insights update for the post author
      try {
        const post = await db.collection('posts').findOne({ id: existing.postId });
        if (post && post.author && post.author.id) {
          emitAuthorInsightsUpdate(
            req.app,
            post.author.id,
            post.author?.type === 'company' ? 'company' : 'user'
          );
        }
      } catch (e) {
        console.error('Error triggering insights update on comment delete:', e);
      }

      const io = req.app.get('io');
      if (io) {
        io.emit('comment_deleted', {
          commentId: id,
          postId: existing.postId
        });
      }

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
      const { reaction, action: forceAction } = req.body as { reaction: string, action?: 'add' | 'remove' };
      const userId = (req as any).user?.id as string | undefined;

      if (!reaction) {
        return res.status(400).json({ success: false, error: 'Missing reaction' });
      }
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User ID required' });
      }
      const actorUserId = userId;

      const db = getDB();
      const comment = await db.collection(COMMENTS_COLLECTION).findOne({ id });
      if (!comment) {
        return res.status(404).json({ success: false, error: 'Comment not found' });
      }

      // Check if user already reacted with this emoji
      const currentReactionUsers = comment.reactionUsers || {};
      const usersForEmoji = currentReactionUsers[reaction] || [];
      const hasReacted = usersForEmoji.includes(actorUserId);
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
          await db.collection(COMMENTS_COLLECTION).updateOne(
            { id },
            {
              $pull: { [`reactionUsers.${reaction}`]: actorUserId } as any,
              $inc: { [`reactions.${reaction}`]: -1 }
            } as any
          );
        } else {
          // Add reaction
          await db.collection(COMMENTS_COLLECTION).updateOne(
            { id },
            {
              $addToSet: { [`reactionUsers.${reaction}`]: actorUserId } as any,
              $inc: { [`reactions.${reaction}`]: 1 }
            } as any
          );
        }
      }

      // Fetch updated comment to return consistent state
      const updatedCommentDoc = await db.collection(COMMENTS_COLLECTION).findOne({ id });
      if (!updatedCommentDoc) {
        return res.status(500).json({ success: false, error: 'Failed to update reaction' });
      }
      const updatedComment = updatedCommentDoc as any;

      if (updatedComment.author) {
        updatedComment.author = transformUser(updatedComment.author);
      }

      if (updatedComment.reactionUsers) {
        updatedComment.userReactions = Object.keys(updatedComment.reactionUsers).filter(emoji =>
          Array.isArray(updatedComment.reactionUsers[emoji]) && updatedComment.reactionUsers[emoji].includes(actorUserId)
        );
      } else {
        updatedComment.userReactions = [];
      }

      const io = req.app.get('io');
      if (io) {
        io.emit('comment_reaction_updated', {
          commentId: id,
          postId: updatedComment.postId,
          reactions: updatedComment.reactions,
          reactionUsers: updatedComment.reactionUsers
        });

        // Trigger live insights update for the post author
        try {
          const post = await db.collection('posts').findOne({ id: updatedComment.postId });
          if (post && post.author && post.author.id) {
            emitAuthorInsightsUpdate(
              req.app,
              post.author.id,
              post.author?.type === 'company' ? 'company' : 'user'
            );
          }
        } catch (e) {
          console.error('Error triggering insights update on comment reaction:', e);
        }
      }

      res.json({ success: true, data: updatedComment, message: `Reaction ${action} successfully` });
    } catch (error) {
      console.error('Error adding reaction:', error);
      res.status(500).json({ success: false, error: 'Failed to add reaction', message: 'Internal server error' });
    }
  }
};
