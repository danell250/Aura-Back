import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { transformUser } from '../utils/userUtils';
import { resolveIdentityActor } from '../utils/identityUtils';
import { emitToIdentity } from '../realtime/socketHub';

const NOTIFICATIONS_COLLECTION = 'notifications';
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const MAX_NOTIFICATIONS_PER_OWNER = 200;
const NOTIFICATION_CLEANUP_QUEUE_BATCH = 100;
const NOTIFICATION_CLEANUP_QUEUE_DELAY_MS = 1000;
const NOTIFICATION_CLEANUP_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const NOTIFICATION_CLEANUP_SWEEP_OWNER_LIMIT = 500;

const notificationCleanupQueue = new Set<string>();
let notificationCleanupDrainScheduled = false;
let notificationCleanupDrainInFlight = false;
let notificationCleanupSweepTimer: NodeJS.Timeout | null = null;

const buildTypedNotificationId = (type: string): string => {
  const timestamp = Date.now();
  const entropy = Math.random().toString(36).slice(2, 11);
  return `notif-${type}-${timestamp}-${entropy}`;
};

let notificationIndexesInitPromise: Promise<void> | null = null;

const ensureNotificationIndexes = (db: any): Promise<void> => {
  if (notificationIndexesInitPromise) {
    return notificationIndexesInitPromise;
  }

  notificationIndexesInitPromise = (async () => {
    try {
      await db.collection(NOTIFICATIONS_COLLECTION).createIndexes([
        {
          key: { id: 1 },
          name: 'notifications_id_unique',
          unique: true,
        },
        {
          key: { ownerType: 1, ownerId: 1, timestamp: -1, id: -1 },
          name: 'notifications_owner_cursor_idx',
        },
        {
          key: { ownerType: 1, ownerId: 1, isRead: 1, timestamp: -1 },
          name: 'notifications_owner_unread_idx',
        },
        {
          key: { ownerType: 1, ownerId: 1, type: 1, yearKey: 1, 'fromUser.id': 1, timestamp: -1 },
          name: 'notifications_owner_type_year_idx',
          sparse: true,
        },
      ]);
    } catch (error) {
      notificationIndexesInitPromise = null;
      throw error;
    }
  })();

  return notificationIndexesInitPromise;
};

const parseLimit = (rawLimit: unknown): number => {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(parsed)));
};

const encodeCursor = (timestamp: number, id: string): string => {
  return Buffer.from(`${timestamp}:${id}`, 'utf8').toString('base64url');
};

const decodeCursor = (rawCursor: unknown): { timestamp: number; id: string } | null => {
  if (typeof rawCursor !== 'string' || !rawCursor.trim()) return null;
  try {
    const decoded = Buffer.from(rawCursor, 'base64url').toString('utf8');
    const delimiterIndex = decoded.indexOf(':');
    if (delimiterIndex <= 0) return null;
    const timestampRaw = decoded.slice(0, delimiterIndex);
    const id = decoded.slice(delimiterIndex + 1);
    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp) || !id) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
};

const enforceNotificationCap = async (
  db: any,
  ownerType: 'user' | 'company',
  ownerId: string,
): Promise<void> => {
  const boundary = await db
    .collection(NOTIFICATIONS_COLLECTION)
    .find({ ownerType, ownerId })
    .sort({ timestamp: -1, id: -1 })
    .skip(MAX_NOTIFICATIONS_PER_OWNER - 1)
    .limit(1)
    .project({ timestamp: 1, id: 1, _id: 0 })
    .next();

  if (!boundary) {
    return;
  }

  const boundaryTimestamp = Number(boundary.timestamp);
  const boundaryId = String(boundary.id || '');
  if (!Number.isFinite(boundaryTimestamp) || !boundaryId) {
    return;
  }

  await db.collection(NOTIFICATIONS_COLLECTION).deleteMany({
    ownerType,
    ownerId,
    $or: [
      { timestamp: { $lt: boundaryTimestamp } },
      { timestamp: boundaryTimestamp, id: { $lt: boundaryId } },
    ],
  });
};

const evictOldestNotificationIfAtCap = async (
  db: any,
  ownerType: 'user' | 'company',
  ownerId: string,
): Promise<void> => {
  const capBoundary = await db
    .collection(NOTIFICATIONS_COLLECTION)
    .find({ ownerType, ownerId })
    .sort({ timestamp: -1, id: -1 })
    .skip(MAX_NOTIFICATIONS_PER_OWNER - 1)
    .limit(1)
    .project({ id: 1, _id: 0 })
    .next();

  if (!capBoundary) {
    return;
  }

  await db.collection(NOTIFICATIONS_COLLECTION).findOneAndDelete(
    { ownerType, ownerId },
    { sort: { timestamp: 1, id: 1 } },
  );
};

const makeCleanupOwnerKey = (ownerType: 'user' | 'company', ownerId: string): string => `${ownerType}:${ownerId}`;

const parseCleanupOwnerKey = (rawKey: string): { ownerType: 'user' | 'company'; ownerId: string } | null => {
  const delimiterIndex = rawKey.indexOf(':');
  if (delimiterIndex <= 0) return null;
  const ownerTypeRaw = rawKey.slice(0, delimiterIndex);
  const ownerId = rawKey.slice(delimiterIndex + 1);
  if (!ownerId) return null;
  if (ownerTypeRaw !== 'user' && ownerTypeRaw !== 'company') return null;
  return { ownerType: ownerTypeRaw, ownerId };
};

const processNotificationCleanupQueue = async (): Promise<void> => {
  if (notificationCleanupDrainInFlight || notificationCleanupQueue.size === 0 || !isDBConnected()) {
    return;
  }

  notificationCleanupDrainInFlight = true;
  try {
    const db = getDB();
    await ensureNotificationIndexes(db);

    const ownerKeys = Array.from(notificationCleanupQueue).slice(0, NOTIFICATION_CLEANUP_QUEUE_BATCH);
    ownerKeys.forEach((ownerKey) => notificationCleanupQueue.delete(ownerKey));

    for (const ownerKey of ownerKeys) {
      const target = parseCleanupOwnerKey(ownerKey);
      if (!target) continue;
      await enforceNotificationCap(db, target.ownerType, target.ownerId);
    }
  } catch (error) {
    console.error('Error processing notification cleanup queue:', error);
  } finally {
    notificationCleanupDrainInFlight = false;
    if (notificationCleanupQueue.size > 0) {
      scheduleNotificationCleanupDrain();
    }
  }
};

const scheduleNotificationCleanupDrain = (): void => {
  if (notificationCleanupDrainScheduled) {
    return;
  }
  notificationCleanupDrainScheduled = true;
  setTimeout(() => {
    notificationCleanupDrainScheduled = false;
    void processNotificationCleanupQueue();
  }, NOTIFICATION_CLEANUP_QUEUE_DELAY_MS);
};

const queueNotificationCleanup = (ownerType: 'user' | 'company', ownerId: string): void => {
  if (!ownerId) return;
  notificationCleanupQueue.add(makeCleanupOwnerKey(ownerType, ownerId));
  scheduleNotificationCleanupDrain();
};

const runNotificationRetentionSweep = async (db: any): Promise<number> => {
  const overflowingOwners = await db
    .collection(NOTIFICATIONS_COLLECTION)
    .aggregate([
      {
        $group: {
          _id: { ownerType: '$ownerType', ownerId: '$ownerId' },
          total: { $sum: 1 },
        },
      },
      { $match: { total: { $gt: MAX_NOTIFICATIONS_PER_OWNER } } },
      { $limit: NOTIFICATION_CLEANUP_SWEEP_OWNER_LIMIT },
    ])
    .toArray();

  for (const ownerRow of overflowingOwners) {
    const ownerType = ownerRow?._id?.ownerType;
    const ownerId = ownerRow?._id?.ownerId;
    if ((ownerType === 'user' || ownerType === 'company') && ownerId) {
      await enforceNotificationCap(db, ownerType, ownerId);
    }
  }

  return overflowingOwners.length;
};

export const startNotificationCleanupWorker = (): void => {
  if (notificationCleanupSweepTimer) {
    return;
  }

  const runSweep = async (): Promise<void> => {
    if (!isDBConnected()) return;
    try {
      const db = getDB();
      await ensureNotificationIndexes(db);
      const cleanedOwners = await runNotificationRetentionSweep(db);
      if (cleanedOwners > 0) {
        console.log(`🧹 Notification cleanup capped ${cleanedOwners} owner(s) to ${MAX_NOTIFICATIONS_PER_OWNER} records.`);
      }
    } catch (error) {
      console.error('Error during notification retention sweep:', error);
    }
  };

  notificationCleanupSweepTimer = setInterval(() => {
    void runSweep();
  }, NOTIFICATION_CLEANUP_SWEEP_INTERVAL_MS);
  if (typeof notificationCleanupSweepTimer.unref === 'function') {
    notificationCleanupSweepTimer.unref();
  }

  void runSweep();
};

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
  let targetOwnerType: 'user' | 'company' = ownerType;

  if (db) {
    try {
      const [resolvedFromUser, resolvedTarget] = await Promise.all([
        resolveFromIdentityDoc(db, fromUserId),
        resolveTargetCollection(db, userId, ownerType),
      ]);
      fromUserDoc = resolvedFromUser;
      if (resolvedTarget) {
        targetOwnerType = resolvedTarget.ownerType;
      }
    } catch (error) {
      console.error('Error resolving notification identities in DB:', error);
    }
  }

  if (db) {
    try {
      await ensureNotificationIndexes(db);
    } catch (error) {
      console.error('Error ensuring notification indexes:', error);
    }
  }

  if (db && yearKey) {
    try {
      const existingNotification = await db.collection(NOTIFICATIONS_COLLECTION).findOne({
        ownerType: targetOwnerType,
        ownerId: userId,
        type,
        yearKey,
        'fromUser.id': fromUserId,
      });
      if (existingNotification) {
        return existingNotification;
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

  const notificationId = buildTypedNotificationId(type);
  const newNotification = {
    id: notificationId,
    ownerId: userId,
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
    yearKey: yearKey || undefined,
    ownerType: targetOwnerType // Store resolved ownerType in notification
  };

  if (db) {
    try {
      await evictOldestNotificationIfAtCap(db, targetOwnerType, userId);
      await db.collection(NOTIFICATIONS_COLLECTION).insertOne(newNotification);
      queueNotificationCleanup(targetOwnerType, userId);
    } catch (error) {
      console.error(`Error creating notification document in ${NOTIFICATIONS_COLLECTION}:`, error);
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

      const { limit = DEFAULT_PAGE_LIMIT, unreadOnly, ownerType = 'user', ownerId, cursor } = req.query;

      // Resolve effective actor identity
      let actor;
      try {
        actor = await resolveIdentityActor(authenticatedUserId, {
          ownerType: ownerType as string,
          ownerId: ownerId as string
        });
      } catch (resolveError) {
        console.error('Error resolving notification identity actor:', resolveError);
        return res.status(500).json({
          success: false,
          error: 'Failed to resolve notification identity'
        });
      }

      if (!actor) {
        return res.status(403).json({ success: false, error: 'Unauthorized access to this identity' });
      }

      const targetId = actor.id;
      if (!isDBConnected()) {
        return res.json({
          success: true,
          data: [],
          pagination: { limit: parseLimit(limit), nextCursor: null, hasMore: false },
          unreadCount: 0
        });
      }

      const db = getDB();
      await ensureNotificationIndexes(db);

      const limitNumber = parseLimit(limit);
      const parsedCursor = decodeCursor(cursor);
      if (cursor && !parsedCursor) {
        return res.status(400).json({
          success: false,
          error: 'Invalid cursor format'
        });
      }

      const baseQuery: Record<string, any> = {
        ownerType: actor.type,
        ownerId: targetId,
      };
      if (unreadOnly === 'true') {
        baseQuery.isRead = { $ne: true };
      }

      const query: Record<string, any> = { ...baseQuery };
      if (parsedCursor) {
        query.$or = [
          { timestamp: { $lt: parsedCursor.timestamp } },
          { timestamp: parsedCursor.timestamp, id: { $lt: parsedCursor.id } },
        ];
      }

      const notificationDocs = await db
        .collection(NOTIFICATIONS_COLLECTION)
        .find(query)
        .sort({ timestamp: -1, id: -1 })
        .limit(limitNumber + 1)
        .toArray();

      const hasMore = notificationDocs.length > limitNumber;
      const pageItems = hasMore ? notificationDocs.slice(0, limitNumber) : notificationDocs;
      const unreadCount = await db.collection(NOTIFICATIONS_COLLECTION).countDocuments({
        ownerType: actor.type,
        ownerId: targetId,
        isRead: { $ne: true },
      });

      const transformed = pageItems.map((notification: any) => {
        if (notification.fromUser) {
          notification.fromUser = transformUser(notification.fromUser);
        }
        return notification;
      });

      const tail = transformed[transformed.length - 1];
      const nextCursor = hasMore && tail ? encodeCursor(Number(tail.timestamp || 0), String(tail.id || '')) : null;

      res.json({
        success: true,
        data: transformed,
        pagination: {
          limit: limitNumber,
          nextCursor,
          hasMore,
        },
        unreadCount
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

      if (actor.id !== fromUserId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Sender identity does not match authenticated actor'
        });
      }

      const isAdmin = (req as any).user?.role === 'admin' || (req as any).user?.isAdmin === true;
      if (!isAdmin && userId !== actor.id) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Only admins can create notifications for other identities'
        });
      }

      const db = getDB();
      await ensureNotificationIndexes(db);
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

      const notificationId = buildTypedNotificationId(type);
      const newNotification = {
        id: notificationId,
        ownerId: userId,
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

      await evictOldestNotificationIfAtCap(db, ownerType, userId);
      await db.collection(NOTIFICATIONS_COLLECTION).insertOne(newNotification);
      queueNotificationCleanup(ownerType, userId);

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
      await ensureNotificationIndexes(db);

      const now = new Date();
      const result = await db.collection(NOTIFICATIONS_COLLECTION).updateOne(
        {
          ownerType: actor.type,
          ownerId: actorId,
          id
        },
        {
          $set: {
            isRead: true,
            readAt: now,
            updatedAt: now
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
      await ensureNotificationIndexes(db);

      const now = new Date();
      const collectionResult = await db.collection(NOTIFICATIONS_COLLECTION).updateMany(
        {
          ownerType: actor.type,
          ownerId: actorId,
          isRead: { $ne: true }
        },
        {
          $set: {
            isRead: true,
            readAt: now,
            updatedAt: now
          }
        }
      );

      if (collectionResult.modifiedCount === 0) {
        return res.json({ success: true, message: 'No unread notifications' });
      }

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
      await ensureNotificationIndexes(db);

      const result = await db.collection(NOTIFICATIONS_COLLECTION).deleteOne({
        ownerType: actor.type,
        ownerId: actorId,
        id
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, error: 'Notification not found' });
      }

      res.json({ success: true, message: 'Notification deleted successfully' });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
};
