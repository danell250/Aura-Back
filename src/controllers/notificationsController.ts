import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { transformUser } from '../utils/userUtils';
import { resolveIdentityActor } from '../utils/identityUtils';

export const createNotificationInDB = async (
  userId: string,
  type: string,
  fromUserId: string,
  message: string,
  postId?: string,
  connectionId?: string,
  meta?: any,
  yearKey?: string,
  ownerType: 'user' | 'company' = 'user'
) => {
  let db: any = null;
  if (isDBConnected()) {
    try {
      db = getDB();
    } catch (error) {
      console.error('Error accessing DB for notifications:', error);
    }
  }

  let fromUserDoc: any = null;
  if (db) {
    try {
      fromUserDoc = await db.collection('users').findOne({ id: fromUserId });
    } catch (error) {
      console.error('Error fetching notification fromUser in DB:', error);
    }
  }

  // Determine collection based on ownerType
  const collectionName = ownerType === 'company' ? 'companies' : 'users';

  if (db && yearKey) {
    try {
      const existingDoc = await db.collection(collectionName).findOne({
        id: userId,
        notifications: { $elemMatch: { yearKey, type } }
      });
      if (existingDoc && Array.isArray(existingDoc.notifications)) {
        const existingNotification = existingDoc.notifications.find(
          (n: any) => n.yearKey === yearKey && n.type === type
        );
        if (existingNotification) {
          return existingNotification;
        }
      }
    } catch (error) {
      console.error('Error checking existing notification in DB:', error);
    }
  }

  const fromUser = fromUserDoc ? {
    id: fromUserDoc.id,
    firstName: fromUserDoc.firstName || '',
    lastName: fromUserDoc.lastName || '',
    name: fromUserDoc.name || `${fromUserDoc.firstName} ${fromUserDoc.lastName}`,
    handle: fromUserDoc.handle,
    avatar: fromUserDoc.avatar,
    avatarKey: fromUserDoc.avatarKey,
    avatarType: fromUserDoc.avatarType || 'image',
    activeGlow: fromUserDoc.activeGlow
  } : {
    id: fromUserId,
    firstName: 'User',
    lastName: '',
    name: 'User',
    handle: '@user',
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`,
    avatarType: 'image',
    activeGlow: undefined
  };

  const newNotification = {
    id: `notif-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    notificationId: `notif-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId,
    type,
    fromUser,
    message,
    timestamp: Date.now(),
    createdAt: new Date(),
    updatedAt: new Date(),
    isRead: false,
    readAt: null,
    postId: postId || '',
    connectionId: connectionId || undefined,
    meta: meta || undefined,
    data: meta || undefined, // Alias for 'data' as requested
    yearKey: yearKey || undefined,
    ownerType // Store ownerType in notification too
  };

  if (db) {
    try {
      await db.collection(collectionName).updateOne(
        { id: userId },
        { 
          $push: { notifications: { $each: [newNotification], $position: 0 } }
        } as any
      );
    } catch (error) {
      console.error(`Error creating notification in DB (${collectionName}):`, error);
    }
  }

  return newNotification;
};

export const notificationsController = {
  // GET /api/notifications - Get notifications for the current user or authorized company
  getMyNotifications: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req as any).user?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { page = 1, limit = 20, unreadOnly, ownerType = 'user', ownerId } = req.query;

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType: ownerType as string,
        ownerId: ownerId as string
      });

      if (!actor) {
        return res.status(403).json({ success: false, error: 'Unauthorized access to this identity' });
      }

      const targetId = actor.id;
      const collectionName = actor.type === 'company' ? 'companies' : 'users';
      
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: Number(page), limit: Number(limit), total: 0, pages: 0 },
          unreadCount: 0
        });
      }

      const db = getDB();
      const doc = await db.collection(collectionName).findOne({ id: targetId });
      
      if (!doc) {
        return res.status(404).json({
          success: false,
          error: `${actor.type === 'company' ? 'Company' : 'User'} not found`
        });
      }

      let notifications = doc.notifications || [];
      
      if (unreadOnly === 'true') {
        notifications = notifications.filter((notif: any) => !notif.isRead);
      }
      
      notifications.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
      
      const startIndex = (Number(page) - 1) * Number(limit);
      const paginatedNotifications = notifications.slice(startIndex, startIndex + Number(limit)).map((notification: any) => {
        if (notification.fromUser) {
          notification.fromUser = transformUser(notification.fromUser);
        }
        return notification;
      });
      
      res.json({
        success: true,
        data: paginatedNotifications,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: notifications.length,
          pages: Math.ceil(notifications.length / Number(limit))
        },
        unreadCount: (doc.notifications || []).filter((n: any) => !n.isRead).length
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
    }
  },

  // POST /api/notifications - Create new notification
  createNotification: async (req: Request, res: Response) => {
    try {
      const { userId, type, fromUserId, message, postId, connectionId, ownerType = 'user', fromOwnerType } = req.body;
      const authenticatedUserId = (req as any).user?.id;
      
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      if (!userId || !type || !fromUserId || !message) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      // Authorization: Only allow creating notifications if acting as fromUserId (user or company)
      const senderOwnerType = (req.body.fromOwnerType as 'user' | 'company') || 'user';
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType: senderOwnerType,
        ownerId: fromUserId
      });

      if (!actor) {
        return res.status(403).json({ success: false, error: 'Unauthorized sender identity' });
      }

      const isAdmin = (req as any).user?.role === 'admin' || (req as any).user?.isAdmin === true;
      if (!isAdmin && userId !== actor.id) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'You can only create notifications for your own identity'
        });
      }

      const db = getDB();
      const senderCollection = actor.type === 'company' ? 'companies' : 'users';
      const fromDoc = await db.collection(senderCollection).findOne({ id: actor.id });
      
      const fromUser = fromDoc ? {
        id: fromDoc.id,
        firstName: fromDoc.firstName || '',
        lastName: fromDoc.lastName || '',
        name: fromDoc.name || `${fromDoc.firstName || ''} ${fromDoc.lastName || ''}`.trim(),
        handle: fromDoc.handle,
        avatar: fromDoc.avatar,
        avatarKey: fromDoc.avatarKey,
        avatarType: fromDoc.avatarType || 'image',
        activeGlow: fromDoc.activeGlow
      } : {
        id: fromUserId,
        firstName: 'User',
        lastName: '',
        name: 'User',
        handle: '@user',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromUserId}`,
        avatarType: 'image',
        activeGlow: undefined
      };

      const newNotification = {
        id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type,
        fromUser,
        message,
        timestamp: Date.now(),
        isRead: false,
        postId: postId || undefined,
        connectionId: connectionId || undefined,
        ownerType
      };

      const collectionName = ownerType === 'company' ? 'companies' : 'users';
      const targetDoc = await db.collection(collectionName).findOne({ id: userId });
      if (!targetDoc) {
        return res.status(404).json({ success: false, error: 'Target identity not found' });
      }

      await db.collection(collectionName).updateOne(
        { id: userId },
        { $push: { notifications: { $each: [newNotification], $position: 0 } } } as any
      );

      if (newNotification.fromUser) {
        newNotification.fromUser = transformUser(newNotification.fromUser);
      }

      res.status(201).json({ success: true, data: newNotification });
    } catch (error) {
      console.error('Error creating notification:', error);
      res.status(500).json({ success: false, error: 'Failed to create notification' });
    }
  },

  // PUT /api/notifications/:id/read - Mark notification as read
  markAsRead: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const authenticatedUserId = (req as any).user?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { ownerId, ownerType = 'user' } = req.body;
      const db = getDB();

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId
      });

      if (!actor) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      const actorId = actor.id;
      const collectionName = actor.type === 'company' ? 'companies' : 'users';

      // Update notification only if it belongs to the authorized actor
      const result = await db.collection(collectionName).updateOne(
        { id: actorId, "notifications.id": id },
        { 
          $set: { 
            "notifications.$.isRead": true,
            "notifications.$.readAt": new Date(),
            "notifications.$.updatedAt": new Date()
          } 
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, error: 'Notification not found' });
      }

      res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  // PUT /api/notifications/read-all - Mark all notifications as read
  markAllAsRead: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req as any).user?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { ownerId, ownerType = 'user' } = req.body;
      const db = getDB();

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId
      });

      if (!actor) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      const actorId = actor.id;
      const collectionName = actor.type === 'company' ? 'companies' : 'users';
      
      const doc = await db.collection(collectionName).findOne({ id: actorId });
      if (!doc) {
        return res.status(404).json({ success: false, error: 'Identity not found' });
      }
      
      if (!doc.notifications || doc.notifications.length === 0) {
        return res.json({ success: true, message: 'No notifications' });
      }

      const updatedNotifications = doc.notifications.map((n: any) => ({ ...n, isRead: true }));
      
      await db.collection(collectionName).updateOne(
        { id: actorId },
        { $set: { notifications: updatedNotifications } }
      );

      res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },

  // DELETE /api/notifications/:id - Delete notification
  deleteNotification: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const authenticatedUserId = (req as any).user?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { ownerId, ownerType = 'user' } = req.body;
      const db = getDB();

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId
      });

      if (!actor) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      const actorId = actor.id;
      const collectionName = actor.type === 'company' ? 'companies' : 'users';

      const result = await db.collection(collectionName).updateOne(
        { id: actorId, "notifications.id": id },
        { $pull: { notifications: { id: id } } } as any
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, error: 'Notification not found' });
      }

      res.json({ success: true, message: 'Notification deleted successfully' });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
};
