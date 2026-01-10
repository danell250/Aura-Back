import { Request, Response } from 'express';
import { Message } from '../models/Message';

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

      // Get latest message for each conversation
      const conversations = await Message.aggregate([
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
      ]);

      res.json({
        success: true,
        data: conversations
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

      const messages = await Message.find({
        $or: [
          { senderId: currentUserId, receiverId: userId },
          { senderId: userId, receiverId: currentUserId }
        ]
      })
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

      // Mark messages as read
      await Message.updateMany(
        {
          senderId: userId,
          receiverId: currentUserId,
          isRead: false
        },
        { isRead: true }
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

      const message = new Message({
        senderId,
        receiverId,
        text,
        messageType,
        mediaUrl,
        replyTo
      });

      await message.save();

      res.status(201).json({
        success: true,
        data: message
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

      const message = await Message.findById(messageId);
      
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

      message.text = text;
      message.isEdited = true;
      message.editedAt = new Date();
      
      await message.save();

      res.json({
        success: true,
        data: message
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

      const message = await Message.findById(messageId);
      
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

      await Message.findByIdAndDelete(messageId);

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

      await Message.updateMany(
        {
          senderId,
          receiverId,
          isRead: false
        },
        { isRead: true }
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
  }
};