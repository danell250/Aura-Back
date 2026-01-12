import { Request, Response } from 'express';

// Mock data - in production this would come from database
const mockNotifications = [
  {
    id: 'notif-1',
    userId: '1',
    type: 'like',
    fromUser: {
      id: '2',
      firstName: 'Sarah',
      lastName: 'Williams',
      name: 'Sarah Williams',
      handle: '@sarahwilliams',
      avatar: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRTNFNUU3Ii8+Cjx0ZXh0IHg9Ijc1IiB5PSI3NSIgZm9udC1zaXplPSI0MCIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iIzk4QjNDRCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPlNNPC90ZXh0Pgo8L3N2Zz4='
    },
    message: 'liked your post',
    timestamp: Date.now() - 3600000,
    isRead: false,
    postId: 'post-1'
  }
];

// Helper function to create a notification in the database
export const createNotificationInDB = async (userId: string, type: string, fromUserId: string, message: string, postId?: string, connectionId?: string) => {
  // In production, this would save to the database
  // For now, we'll add to the mock array
  
  // In production, fetch fromUser from database
  const { getDB } = require('../db');
  const db = getDB();
  const fromUserDoc = await db.collection('users').findOne({ id: fromUserId });
  
  const fromUser = fromUserDoc ? {
    id: fromUserDoc.id,
    firstName: fromUserDoc.firstName || '',
    lastName: fromUserDoc.lastName || '',
    name: fromUserDoc.name,
    handle: fromUserDoc.handle,
    avatar: fromUserDoc.avatar
  } : {
    id: fromUserId,
    firstName: 'User',
    lastName: '',
    name: 'User',
    handle: '@user',
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`
  };
  
  const newNotification = {
    id: `notif-${type}-${Date.now()}-${Math.random()}`,
    userId,
    type,
    fromUser,
    message,
    timestamp: Date.now(),
    isRead: false,
    postId: postId || '',
    connectionId: connectionId || undefined
  };
  
  // In production, save to database
  mockNotifications.push(newNotification);
  
  // Also update the user's notification array in the database
  try {
    const userDoc = await db.collection('users').findOne({ id: userId });
    if (userDoc) {
      const updatedNotifications = [newNotification, ...(userDoc.notifications || [])];
      await db.collection('users').updateOne(
        { id: userId },
        { 
          $set: { 
            notifications: updatedNotifications,
            updatedAt: new Date().toISOString()
          }
        }
      );
    }
  } catch (error) {
    console.error('Error updating user notifications:', error);
  }
  
  return newNotification;
};

export const notificationsController = {
  // GET /api/users/:userId/notifications - Get notifications for a user
  getNotificationsByUser: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 20, unreadOnly } = req.query;
      
      let filteredNotifications = mockNotifications.filter(notif => notif.userId === userId);
      
      // Filter unread only if specified
      if (unreadOnly === 'true') {
        filteredNotifications = filteredNotifications.filter(notif => !notif.isRead);
      }
      
      // Sort by timestamp (newest first)
      filteredNotifications.sort((a, b) => b.timestamp - a.timestamp);
      
      // Pagination
      const startIndex = (Number(page) - 1) * Number(limit);
      const endIndex = startIndex + Number(limit);
      const paginatedNotifications = filteredNotifications.slice(startIndex, endIndex);
      
      res.json({
        success: true,
        data: paginatedNotifications,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: filteredNotifications.length,
          pages: Math.ceil(filteredNotifications.length / Number(limit))
        },
        unreadCount: mockNotifications.filter(n => n.userId === userId && !n.isRead).length
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch notifications',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/notifications - Create new notification
  createNotification: async (req: Request, res: Response) => {
    try {
      const { userId, type, fromUserId, message, postId, connectionId } = req.body;
      
      // Validate required fields
      if (!userId || !type || !fromUserId || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'userId, type, fromUserId, and message are required'
        });
      }

      // In production, fetch fromUser from database
      const fromUser = {
        id: fromUserId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`
      };

      const newNotification = {
        id: `notif-${Date.now()}`,
        userId,
        type,
        fromUser,
        message,
        timestamp: Date.now(),
        isRead: false,
        postId: postId || undefined,
        connectionId: connectionId || undefined
      };

      // In production, save to database
      mockNotifications.push(newNotification);

      res.status(201).json({
        success: true,
        data: newNotification,
        message: 'Notification created successfully'
      });
    } catch (error) {
      console.error('Error creating notification:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create notification',
        message: 'Internal server error'
      });
    }
  },

  // PUT /api/notifications/:id/read - Mark notification as read
  markAsRead: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const notificationIndex = mockNotifications.findIndex(n => n.id === id);
      if (notificationIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Notification not found',
          message: `Notification with ID ${id} does not exist`
        });
      }

      // Mark as read
      mockNotifications[notificationIndex].isRead = true;

      res.json({
        success: true,
        data: mockNotifications[notificationIndex],
        message: 'Notification marked as read'
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark notification as read',
        message: 'Internal server error'
      });
    }
  },

  // PUT /api/users/:userId/notifications/read-all - Mark all notifications as read
  markAllAsRead: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      
      // Mark all user's notifications as read
      mockNotifications.forEach(notif => {
        if (notif.userId === userId) {
          notif.isRead = true;
        }
      });

      res.json({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark all notifications as read',
        message: 'Internal server error'
      });
    }
  },

  // DELETE /api/notifications/:id - Delete notification
  deleteNotification: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const notificationIndex = mockNotifications.findIndex(n => n.id === id);
      if (notificationIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Notification not found',
          message: `Notification with ID ${id} does not exist`
        });
      }

      // Remove notification
      mockNotifications.splice(notificationIndex, 1);

      res.json({
        success: true,
        message: 'Notification deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete notification',
        message: 'Internal server error'
      });
    }
  }
};