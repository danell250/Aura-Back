import { Request, Response } from 'express';
import { getMessagesCollection, IMessage } from '../models/Message';
import { ObjectId } from 'mongodb';
import { isDBConnected, getDB } from '../db';

export const messagesController = {
  // GET /api/messages/conversations - Get all conversations for a user
  getConversations: async (req: Request, res: Response) => {
    try {
      const { userId } = req.query;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      // Check if database is connected
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [], // Return empty array when DB is not connected
          message: 'Database not connected, using fallback'
        });
      }

      const messagesCollection = getMessagesCollection();
      const db = getDB();

      // Get latest message for each conversation
      const conversations = await messagesCollection.aggregate([
        {
          $match: {
            $or: [
              { senderId: userId },
              { receiverId: userId }
            ]
          }
        },
        {
          $addFields: {
            conversationWith: {
              $cond: {
                if: { $eq: ['$senderId', userId] },
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
                      { $eq: ['$receiverId', userId] },
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
          $sort: { 'lastMessage.timestamp': -1 }
        }
      ]).toArray();

      const user = await db.collection('users').findOne({ id: userId });
      const archivedChats: string[] = (user?.archivedChats as string[]) || [];

      const conversationsWithArchive = conversations.map(conv => ({
        ...conv,
        isArchived: archivedChats.includes(conv._id as string),
      }));

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
      const { userId } = req.params;
      const { currentUserId, page = 1, limit = 50 } = req.query;
      
      if (!currentUserId) {
        return res.status(400).json({
          success: false,
          message: 'Current user ID is required'
        });
      }

      // Check if database is connected
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [], // Return empty array when DB is not connected
          message: 'Database not connected, using fallback'
        });
      }

      const messagesCollection = getMessagesCollection();

      const messages = await messagesCollection.find({
        $or: [
          { senderId: currentUserId, receiverId: userId },
          { senderId: userId, receiverId: currentUserId }
        ]
      })
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .toArray();

      // Mark messages as read
      await messagesCollection.updateMany(
        {
          senderId: userId,
          receiverId: currentUserId,
          isRead: false
        },
        { $set: { isRead: true } }
      );

      res.json({
        success: true,
        data: messages.reverse() // Return in chronological order
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
      const { senderId, receiverId, text, messageType = 'text', mediaUrl, replyTo } = req.body;
      
      if (!senderId || !receiverId || !text) {
        return res.status(400).json({
          success: false,
          message: 'Sender ID, receiver ID, and text are required'
        });
      }

      // Check if database is connected
      if (!isDBConnected()) {
        // Return a mock message when DB is not connected
        const mockMessage: IMessage = {
          _id: new ObjectId(),
          senderId,
          receiverId,
          text,
          timestamp: new Date(),
          isRead: false,
          messageType,
          mediaUrl,
          replyTo,
          isEdited: false
        };

        return res.status(201).json({
          success: true,
          data: mockMessage,
          message: 'Database not connected, message not persisted'
        });
      }

      const messagesCollection = getMessagesCollection();

      const message: IMessage = {
        senderId,
        receiverId,
        text,
        timestamp: new Date(),
        isRead: false,
        messageType,
        mediaUrl,
        replyTo,
        isEdited: false
      };

      const result = await messagesCollection.insertOne(message);
      const insertedMessage = await messagesCollection.findOne({ _id: result.insertedId });

      res.status(201).json({
        success: true,
        data: insertedMessage
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
      const { messageId } = req.params;
      const { text, userId } = req.body;
      
      if (!text || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Text and user ID are required'
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
      const { messageId } = req.params;
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
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

  // PUT /api/messages/mark-read - Mark messages as read
  markAsRead: async (req: Request, res: Response) => {
    try {
      const { senderId, receiverId } = req.body;
      
      if (!senderId || !receiverId) {
        return res.status(400).json({
          success: false,
          message: 'Sender ID and receiver ID are required'
        });
      }

      const messagesCollection = getMessagesCollection();

      await messagesCollection.updateMany(
        {
          senderId,
          receiverId,
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
      const { userId, otherUserId, archived } = req.body;

      if (!userId || !otherUserId || typeof archived !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'userId, otherUserId and archived flag are required'
        });
      }

      if (!isDBConnected()) {
        return res.json({
          success: true,
          message: 'Database not connected, archive state not persisted (dev fallback)'
        });
      }

      const db = getDB();
      const update = archived
        ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } }
        : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } };

      await db.collection('users').updateOne(
        { id: userId },
        update
      );

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
