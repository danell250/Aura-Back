import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { transformUser } from '../utils/userUtils';
import { resolveIdentityActor } from '../utils/identityUtils';
import { emitToIdentity } from '../realtime/socketHub';

const resolveTargetCollection = async (
  db: any,
  targetId: string,
  requestedOwnerType: 'user' | 'company',
): Promise<{ collectionName: 'users' | 'companies'; ownerType: 'user' | 'company' } | null> => {
  const preferred = requestedOwnerType === 'company' ? 'companies' : 'users';
  const fallback = preferred === 'companies' ? 'users' : 'companies';

  const preferredQuery =
    preferred === 'companies'
      ? { id: targetId, legacyArchived: { $ne: true } }
      : { id: targetId };
  const preferredDoc = await db.collection(preferred).findOne(preferredQuery, { projection: { id: 1 } });
  if (preferredDoc) {
    return {
      collectionName: preferred as 'users' | 'companies',
      ownerType: preferred === 'companies' ? 'company' : 'user',
    };
  }

  const fallbackQuery =
    fallback === 'companies'
      ? { id: targetId, legacyArchived: { $ne: true } }
      : { id: targetId };
  const fallbackDoc = await db.collection(fallback).findOne(fallbackQuery, { projection: { id: 1 } });
  if (fallbackDoc) {
    return {
      collectionName: fallback as 'users' | 'companies',
      ownerType: fallback === 'companies' ? 'company' : 'user',
    };
  }

  return null;
};

const resolveFromIdentityDoc = async (db: any, fromId: string): Promise<any | null> => {
  const userDoc = await db.collection('users').findOne({ id: fromId });
  if (userDoc) return userDoc;

  return db.collection('companies').findOne({
    id: fromId,
    legacyArchived: { $ne: true },
  });
};

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
  let targetCollectionName: 'users' | 'companies' = ownerType === 'company' ? 'companies' : 'users';
  let targetOwnerType: 'user' | 'company' = ownerType;

  if (db) {
    try {
      const [resolvedFromUser, resolvedTarget] = await Promise.all([
        resolveFromIdentityDoc(db, fromUserId),
        resolveTargetCollection(db, userId, ownerType),
      ]);
      fromUserDoc = resolvedFromUser;
      if (resolvedTarget) {
        targetCollectionName = resolvedTarget.collectionName;
        targetOwnerType = resolvedTarget.ownerType;
      }
    } catch (error) {
      console.error('Error resolving notification identities in DB:', error);
    }
  }

  if (db && yearKey) {
    try {
      const existingDoc = await db.collection(targetCollectionName).findOne({
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
    name: fromUserDoc.name || `${fromUserDoc.firstName || ''} ${fromUserDoc.lastName || ''}`.trim(),
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
    ownerType: targetOwnerType // Store resolved ownerType in notification
  };

  if (db) {
    try {
      await db.collection(targetCollectionName).updateOne(
        { id: userId },
        { 
          $push: { notifications: { $each: [newNotification], $position: 0 } }
        } as any
      );
    } catch (error) {
      console.error(`Error creating notification in DB (${targetCollectionName}):`, error);
    }
  }

  emitToIdentity(targetOwnerType, userId, 'notification:new', {
    ownerType: targetOwnerType,
    ownerId: userId,
    notification: {
      ...newNotification,
      fromUser: newNotification.fromUser ? transformUser(newNotification.fromUser) : newNotification.fromUser,
    },
  });

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
