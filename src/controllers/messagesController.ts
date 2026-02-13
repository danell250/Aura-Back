import { Request, Response } from 'express';
import { getMessagesCollection, IMessage } from '../models/Message';
import { ObjectId } from 'mongodb';
import { getDB, isDBConnected } from '../db';
import { transformUser } from '../utils/userUtils';

const canActAsEntity = async (authUserId: string, entityId: string): Promise<boolean> => {
  if (authUserId === entityId) return true;

  const db = getDB();
  const membership = await db.collection('company_members').findOne({ companyId: entityId, userId: authUserId });
  if (membership) return true;

  const company = await db.collection('companies').findOne({ id: entityId, ownerId: authUserId });
  return !!company;
};

export const messagesController = {
  // GET /api/messages/conversations - Get all conversations for a user
  getConversations: async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).user?.id as string | undefined;
      if (!authUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { userId, ownerType = 'user' } = req.query;
      const resolvedOwnerId = String(userId || authUserId);
      const resolvedOwnerType = String(ownerType || 'user');

      if (resolvedOwnerType !== 'user' && resolvedOwnerType !== 'company') {
        return res.status(400).json({
          success: false,
          message: 'Invalid ownerType'
        });
      }

      if (!(await canActAsEntity(authUserId, resolvedOwnerId))) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden'
        });
      }

      if (!resolvedOwnerId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: []
        });
      }

      const messagesCollection = getMessagesCollection();
      const db = getDB();

      // Get latest message for each conversation
      const conversations = await messagesCollection.aggregate([
        {
          $match: {
            $or: [
              { senderId: resolvedOwnerId },
              { receiverId: resolvedOwnerId }
            ]
          }
        },
        {
          $addFields: {
            conversationWith: {
              $cond: {
                if: { $eq: ['$senderId', resolvedOwnerId] },
                then: '$receiverId',
                else: '$senderId'
              }
            }
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $group: {
            _id: '$conversationWith',
            lastMessage: { $first: '$$ROOT' },
            unreadCount: {
              $sum: {
                $cond: {
                  if: {
                    $and: [
                      { $eq: ['$receiverId', resolvedOwnerId] },
                      { $eq: ['$isRead', false] }
                    ]
                  },
                  then: 1,
                  else: 0
                }
              }
            }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: 'id',
            as: 'otherUser'
          }
        },
        {
          $lookup: {
            from: 'companies',
            localField: '_id',
            foreignField: 'id',
            as: 'otherCompany'
          }
        },
        {
          $addFields: {
            otherEntity: {
              $cond: {
                if: { $gt: [{ $size: '$otherUser' }, 0] },
                then: { $arrayElemAt: ['$otherUser', 0] },
                else: { $arrayElemAt: ['$otherCompany', 0] }
              }
            }
          }
        },
        {
          $unwind: {
            path: '$otherEntity',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $sort: { 'lastMessage.timestamp': -1 }
        }
      ]).toArray();

      const collectionName = resolvedOwnerType === 'company' ? 'companies' : 'users';
      const doc = await db.collection(collectionName).findOne({ id: resolvedOwnerId });
      const archivedChats: string[] = (doc?.archivedChats as string[]) || [];

      const conversationsWithArchive = conversations.map(conv => {
        const otherUser = conv.otherEntity ? transformUser(conv.otherEntity) : null;
        return {
          ...conv,
          otherUser,
          isArchived: archivedChats.includes(conv._id as string),
        };
      });

      res.json({
        success: true,
        data: conversationsWithArchive
      });
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch conversations'
      });
    }
  },

  // GET /api/messages/:userId - Get messages between current user and another user
  getMessages: async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).user?.id as string | undefined;
      if (!authUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { userId } = req.params;
      const { currentUserId, page = 1, limit = 50 } = req.query;
      const resolvedCurrentUserId = String(currentUserId || authUserId);
      
      if (!resolvedCurrentUserId) {
        return res.status(400).json({
          success: false,
          message: 'Current user ID is required'
        });
      }

      if (!(await canActAsEntity(authUserId, resolvedCurrentUserId))) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden'
        });
      }

      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: []
        });
      }

      const messagesCollection = getMessagesCollection();

      const messages = await messagesCollection.find({
        $or: [
          { senderId: resolvedCurrentUserId, receiverId: userId },
          { senderId: userId, receiverId: resolvedCurrentUserId }
        ]
      })
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .toArray();

      const mappedMessages = messages.map((message: any) => ({
        ...message,
        id: message.id || (message._id ? String(message._id) : undefined),
      }));

      // Mark messages as read
      await messagesCollection.updateMany(
        {
          senderId: userId,
          receiverId: resolvedCurrentUserId,
          isRead: false
        },
        { $set: { isRead: true } }
      );

      res.json({
        success: true,
        data: mappedMessages.reverse()
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch messages'
      });
    }
  },

  // POST /api/messages - Send a new message
  sendMessage: async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).user?.id as string | undefined;
      if (!authUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { 
        senderId, 
        receiverId, 
        text, 
        messageType = 'text', 
        mediaUrl, 
        mediaKey,
        mediaMimeType,
        mediaSize,
        replyTo 
      } = req.body;
      
      if (!senderId || !receiverId || !text) {
        return res.status(400).json({
          success: false,
          message: 'Sender ID, receiver ID, and text are required'
        });
      }

      if (!(await canActAsEntity(authUserId, senderId))) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden'
        });
      }

      if (!isDBConnected()) {
        return res.status(503).json({
          success: false,
          message: 'Messaging service is temporarily unavailable'
        });
      }

      const messagesCollection = getMessagesCollection();
      const db = getDB();

      const message: IMessage = {
        senderId,
        receiverId,
        text,
        timestamp: new Date(),
        isRead: false,
        messageType,
        mediaUrl,
        mediaKey,
        mediaMimeType,
        mediaSize,
        replyTo,
        isEdited: false
      };

      const result = await messagesCollection.insertOne(message);
      const insertedMessage = await messagesCollection.findOne({ _id: result.insertedId });

      const responseMessage = insertedMessage
        ? {
            ...insertedMessage,
            id: (insertedMessage as any)._id ? String((insertedMessage as any)._id) : undefined,
          }
        : null;

      await db.collection('users').updateOne(
        { id: receiverId },
        { $pull: { archivedChats: senderId }, $set: { updatedAt: new Date().toISOString() } }
      );
      
      // Also try companies collection in case receiver is a company
      await db.collection('companies').updateOne(
        { id: receiverId },
        { $pull: { archivedChats: senderId }, $set: { updatedAt: new Date().toISOString() } }
      );

      res.status(201).json({
        success: true,
        data: responseMessage
      });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send message'
      });
    }
  },

  // PUT /api/messages/:messageId - Edit a message
  editMessage: async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).user?.id as string | undefined;
      if (!authUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { messageId } = req.params;
      const { text, userId } = req.body;
      
      if (!text || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Text and user ID are required'
        });
      }

      if (!(await canActAsEntity(authUserId, userId))) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden'
        });
      }

      if (!isDBConnected()) {
        return res.status(503).json({
          success: false,
          message: 'Messaging service is temporarily unavailable'
        });
      }

      const messagesCollection = getMessagesCollection();
      const message = await messagesCollection.findOne({ _id: new ObjectId(messageId) });
      
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      if (message.senderId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own messages'
        });
      }

      const result = await messagesCollection.findOneAndUpdate(
        { _id: new ObjectId(messageId) },
        { 
          $set: { 
            text, 
            isEdited: true, 
            editedAt: new Date() 
          } 
        },
        { returnDocument: 'after' }
      );

      if (!result) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update message'
        });
      }

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error editing message:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to edit message'
      });
    }
  },

  // DELETE /api/messages/:messageId - Delete a message
  deleteMessage: async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).user?.id as string | undefined;
      if (!authUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { messageId } = req.params;
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      if (!(await canActAsEntity(authUserId, userId))) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden'
        });
      }

      if (!isDBConnected()) {
        return res.status(503).json({
          success: false,
          message: 'Messaging service is temporarily unavailable'
        });
      }

      const messagesCollection = getMessagesCollection();
      const message = await messagesCollection.findOne({ _id: new ObjectId(messageId) });
      
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      if (message.senderId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own messages'
        });
      }

      await messagesCollection.deleteOne({ _id: new ObjectId(messageId) });

      res.json({
        success: true,
        message: 'Message deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete message'
      });
    }
  },

  // DELETE /api/messages/conversation - Delete all messages in a conversation
  deleteConversation: async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).user?.id as string | undefined;
      if (!authUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { userId, otherUserId } = req.body;

      if (!userId || !otherUserId) {
        return res.status(400).json({
          success: false,
          message: 'userId and otherUserId are required'
        });
      }

      if (!(await canActAsEntity(authUserId, userId))) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden'
        });
      }

      if (!isDBConnected()) {
        return res.status(503).json({
          success: false,
          message: 'Messaging service is temporarily unavailable'
        });
      }

      const messagesCollection = getMessagesCollection();

      await messagesCollection.deleteMany({
        $or: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId }
        ]
      });

      res.json({
        success: true,
        message: 'Conversation deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete conversation'
      });
    }
  },

  markAsRead: async (req: Request, res: Response) => {
    try {
      const { senderId, receiverId, userId, otherUserId, currentUserId } = req.body;
      const authUser = (req as any).user as any | undefined;

      const bodySenderId = senderId || otherUserId;
      const bodyReceiverId = receiverId || currentUserId || userId;

      const querySenderId = (req.query.senderId as string) || (req.query.otherUserId as string);
      const queryReceiverId =
        (req.query.receiverId as string) ||
        (req.query.currentUserId as string) ||
        (req.query.userId as string);

      const resolvedReceiverId = bodyReceiverId || queryReceiverId || authUser?.id;
      const resolvedSenderId = bodySenderId || querySenderId;

      if (!resolvedSenderId || !resolvedReceiverId) {
        return res.json({
          success: true,
          message: 'No messages to mark as read'
        });
      }

      if (!authUser?.id || !(await canActAsEntity(authUser.id, resolvedReceiverId))) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden'
        });
      }

      if (!isDBConnected()) {
        return res.status(503).json({
          success: false,
          message: 'Messaging service is temporarily unavailable'
        });
      }

      const messagesCollection = getMessagesCollection();

      await messagesCollection.updateMany(
        {
          senderId: resolvedSenderId,
          receiverId: resolvedReceiverId,
          isRead: false
        },
        { $set: { isRead: true } }
      );

      res.json({
        success: true,
        message: 'Messages marked as read'
      });
    } catch (error) {
      console.error('Error marking messages as read:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark messages as read'
      });
    }
  },

  archiveConversation: async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).user?.id as string | undefined;
      if (!authUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { userId, otherUserId, archived } = req.body;

      if (!userId || !otherUserId || typeof archived !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'userId, otherUserId and archived flag are required'
        });
      }

      if (!(await canActAsEntity(authUserId, userId))) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden'
        });
      }

      const db = getDB();
      const update = archived
        ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } }
        : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } };

      // Update in both collections to be safe, or we could pass ownerType from frontend
      await Promise.all([
        db.collection('users').updateOne({ id: userId }, update),
        db.collection('companies').updateOne({ id: userId }, update)
      ]);

      res.json({
        success: true,
        message: archived ? 'Conversation archived successfully' : 'Conversation unarchived successfully'
      });
    } catch (error) {
      console.error('Error archiving conversation:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update archive state for conversation'
      });
    }
  }
};
