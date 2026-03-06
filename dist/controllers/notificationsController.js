"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsController = exports.createNotificationInDB = exports.startNotificationCleanupWorker = void 0;
const db_1 = require("../db");
const userUtils_1 = require("../utils/userUtils");
const identityUtils_1 = require("../utils/identityUtils");
const socketHub_1 = require("../realtime/socketHub");
const NOTIFICATIONS_COLLECTION = 'notifications';
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const MAX_NOTIFICATIONS_PER_OWNER = 200;
const NOTIFICATION_CLEANUP_QUEUE_BATCH = 100;
const NOTIFICATION_CLEANUP_QUEUE_DELAY_MS = 1000;
const NOTIFICATION_CLEANUP_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const NOTIFICATION_CLEANUP_SWEEP_OWNER_LIMIT = 500;
const notificationCleanupQueue = new Set();
let notificationCleanupDrainScheduled = false;
let notificationCleanupDrainInFlight = false;
let notificationCleanupSweepTimer = null;
const buildTypedNotificationId = (type) => {
    const timestamp = Date.now();
    const entropy = Math.random().toString(36).slice(2, 11);
    return `notif-${type}-${timestamp}-${entropy}`;
};
let notificationIndexesInitPromise = null;
const ensureNotificationIndexes = (db) => {
    if (notificationIndexesInitPromise) {
        return notificationIndexesInitPromise;
    }
    notificationIndexesInitPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield db.collection(NOTIFICATIONS_COLLECTION).createIndexes([
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
                {
                    key: { ownerType: 1, ownerId: 1, type: 1, timestamp: -1 },
                    name: 'notifications_owner_type_timestamp_idx',
                },
                {
                    key: { ownerType: 1, ownerId: 1, type: 1, 'fromUser.id': 1, timestamp: -1 },
                    name: 'notifications_owner_type_actor_timestamp_idx',
                },
            ]);
        }
        catch (error) {
            notificationIndexesInitPromise = null;
            throw error;
        }
    }))();
    return notificationIndexesInitPromise;
};
const parseLimit = (rawLimit) => {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed))
        return DEFAULT_PAGE_LIMIT;
    return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(parsed)));
};
const encodeCursor = (timestamp, id) => {
    return Buffer.from(`${timestamp}:${id}`, 'utf8').toString('base64url');
};
const decodeCursor = (rawCursor) => {
    if (typeof rawCursor !== 'string' || !rawCursor.trim())
        return null;
    try {
        const decoded = Buffer.from(rawCursor, 'base64url').toString('utf8');
        const delimiterIndex = decoded.indexOf(':');
        if (delimiterIndex <= 0)
            return null;
        const timestampRaw = decoded.slice(0, delimiterIndex);
        const id = decoded.slice(delimiterIndex + 1);
        const timestamp = Number(timestampRaw);
        if (!Number.isFinite(timestamp) || !id)
            return null;
        return { timestamp, id };
    }
    catch (_a) {
        return null;
    }
};
const enforceNotificationCap = (db, ownerType, ownerId) => __awaiter(void 0, void 0, void 0, function* () {
    const boundary = yield db
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
    yield db.collection(NOTIFICATIONS_COLLECTION).deleteMany({
        ownerType,
        ownerId,
        $or: [
            { timestamp: { $lt: boundaryTimestamp } },
            { timestamp: boundaryTimestamp, id: { $lt: boundaryId } },
        ],
    });
});
const evictOldestNotificationIfAtCap = (db, ownerType, ownerId) => __awaiter(void 0, void 0, void 0, function* () {
    const capBoundary = yield db
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
    yield db.collection(NOTIFICATIONS_COLLECTION).findOneAndDelete({ ownerType, ownerId }, { sort: { timestamp: 1, id: 1 } });
});
const makeCleanupOwnerKey = (ownerType, ownerId) => `${ownerType}:${ownerId}`;
const parseCleanupOwnerKey = (rawKey) => {
    const delimiterIndex = rawKey.indexOf(':');
    if (delimiterIndex <= 0)
        return null;
    const ownerTypeRaw = rawKey.slice(0, delimiterIndex);
    const ownerId = rawKey.slice(delimiterIndex + 1);
    if (!ownerId)
        return null;
    if (ownerTypeRaw !== 'user' && ownerTypeRaw !== 'company')
        return null;
    return { ownerType: ownerTypeRaw, ownerId };
};
const processNotificationCleanupQueue = () => __awaiter(void 0, void 0, void 0, function* () {
    if (notificationCleanupDrainInFlight || notificationCleanupQueue.size === 0 || !(0, db_1.isDBConnected)()) {
        return;
    }
    notificationCleanupDrainInFlight = true;
    try {
        const db = (0, db_1.getDB)();
        yield ensureNotificationIndexes(db);
        const ownerKeys = Array.from(notificationCleanupQueue).slice(0, NOTIFICATION_CLEANUP_QUEUE_BATCH);
        ownerKeys.forEach((ownerKey) => notificationCleanupQueue.delete(ownerKey));
        for (const ownerKey of ownerKeys) {
            const target = parseCleanupOwnerKey(ownerKey);
            if (!target)
                continue;
            yield enforceNotificationCap(db, target.ownerType, target.ownerId);
        }
    }
    catch (error) {
        console.error('Error processing notification cleanup queue:', error);
    }
    finally {
        notificationCleanupDrainInFlight = false;
        if (notificationCleanupQueue.size > 0) {
            scheduleNotificationCleanupDrain();
        }
    }
});
const scheduleNotificationCleanupDrain = () => {
    if (notificationCleanupDrainScheduled) {
        return;
    }
    notificationCleanupDrainScheduled = true;
    setTimeout(() => {
        notificationCleanupDrainScheduled = false;
        void processNotificationCleanupQueue();
    }, NOTIFICATION_CLEANUP_QUEUE_DELAY_MS);
};
const queueNotificationCleanup = (ownerType, ownerId) => {
    if (!ownerId)
        return;
    notificationCleanupQueue.add(makeCleanupOwnerKey(ownerType, ownerId));
    scheduleNotificationCleanupDrain();
};
const runNotificationRetentionSweep = (db) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const overflowingOwners = yield db
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
        const ownerType = (_a = ownerRow === null || ownerRow === void 0 ? void 0 : ownerRow._id) === null || _a === void 0 ? void 0 : _a.ownerType;
        const ownerId = (_b = ownerRow === null || ownerRow === void 0 ? void 0 : ownerRow._id) === null || _b === void 0 ? void 0 : _b.ownerId;
        if ((ownerType === 'user' || ownerType === 'company') && ownerId) {
            yield enforceNotificationCap(db, ownerType, ownerId);
        }
    }
    return overflowingOwners.length;
});
const startNotificationCleanupWorker = () => {
    if (notificationCleanupSweepTimer) {
        return;
    }
    const runSweep = () => __awaiter(void 0, void 0, void 0, function* () {
        if (!(0, db_1.isDBConnected)())
            return;
        try {
            const db = (0, db_1.getDB)();
            yield ensureNotificationIndexes(db);
            const cleanedOwners = yield runNotificationRetentionSweep(db);
            if (cleanedOwners > 0) {
                console.log(`🧹 Notification cleanup capped ${cleanedOwners} owner(s) to ${MAX_NOTIFICATIONS_PER_OWNER} records.`);
            }
        }
        catch (error) {
            console.error('Error during notification retention sweep:', error);
        }
    });
    notificationCleanupSweepTimer = setInterval(() => {
        void runSweep();
    }, NOTIFICATION_CLEANUP_SWEEP_INTERVAL_MS);
    if (typeof notificationCleanupSweepTimer.unref === 'function') {
        notificationCleanupSweepTimer.unref();
    }
    void runSweep();
};
exports.startNotificationCleanupWorker = startNotificationCleanupWorker;
const resolveTargetCollection = (db, targetId, requestedOwnerType) => __awaiter(void 0, void 0, void 0, function* () {
    const preferred = requestedOwnerType === 'company' ? 'companies' : 'users';
    const fallback = preferred === 'companies' ? 'users' : 'companies';
    const preferredQuery = preferred === 'companies'
        ? { id: targetId, legacyArchived: { $ne: true } }
        : { id: targetId };
    const preferredDoc = yield db.collection(preferred).findOne(preferredQuery, { projection: { id: 1 } });
    if (preferredDoc) {
        return {
            collectionName: preferred,
            ownerType: preferred === 'companies' ? 'company' : 'user',
        };
    }
    const fallbackQuery = fallback === 'companies'
        ? { id: targetId, legacyArchived: { $ne: true } }
        : { id: targetId };
    const fallbackDoc = yield db.collection(fallback).findOne(fallbackQuery, { projection: { id: 1 } });
    if (fallbackDoc) {
        return {
            collectionName: fallback,
            ownerType: fallback === 'companies' ? 'company' : 'user',
        };
    }
    return null;
});
const resolveFromIdentityDoc = (db, fromId) => __awaiter(void 0, void 0, void 0, function* () {
    const userDoc = yield db.collection('users').findOne({ id: fromId });
    if (userDoc)
        return userDoc;
    return db.collection('companies').findOne({
        id: fromId,
        legacyArchived: { $ne: true },
    });
});
const createNotificationInDB = (userId_1, type_1, fromUserId_1, message_1, postId_1, connectionId_1, meta_1, yearKey_1, ...args_1) => __awaiter(void 0, [userId_1, type_1, fromUserId_1, message_1, postId_1, connectionId_1, meta_1, yearKey_1, ...args_1], void 0, function* (userId, type, fromUserId, message, postId, connectionId, meta, yearKey, ownerType = 'user') {
    let db = null;
    if ((0, db_1.isDBConnected)()) {
        try {
            db = (0, db_1.getDB)();
        }
        catch (error) {
            console.error('Error accessing DB for notifications:', error);
        }
    }
    let fromUserDoc = null;
    let targetOwnerType = ownerType;
    if (db) {
        try {
            const [resolvedFromUser, resolvedTarget] = yield Promise.all([
                resolveFromIdentityDoc(db, fromUserId),
                resolveTargetCollection(db, userId, ownerType),
            ]);
            fromUserDoc = resolvedFromUser;
            if (resolvedTarget) {
                targetOwnerType = resolvedTarget.ownerType;
            }
        }
        catch (error) {
            console.error('Error resolving notification identities in DB:', error);
        }
    }
    if (db) {
        try {
            yield ensureNotificationIndexes(db);
        }
        catch (error) {
            console.error('Error ensuring notification indexes:', error);
        }
    }
    if (db && yearKey) {
        try {
            const existingNotification = yield db.collection(NOTIFICATIONS_COLLECTION).findOne({
                ownerType: targetOwnerType,
                ownerId: userId,
                type,
                yearKey,
                'fromUser.id': fromUserId,
            });
            if (existingNotification) {
                return existingNotification;
            }
        }
        catch (error) {
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
            yield evictOldestNotificationIfAtCap(db, targetOwnerType, userId);
            yield db.collection(NOTIFICATIONS_COLLECTION).insertOne(newNotification);
            queueNotificationCleanup(targetOwnerType, userId);
        }
        catch (error) {
            console.error(`Error creating notification document in ${NOTIFICATIONS_COLLECTION}:`, error);
        }
    }
    (0, socketHub_1.emitToIdentity)(targetOwnerType, userId, 'notification:new', {
        ownerType: targetOwnerType,
        ownerId: userId,
        notification: Object.assign(Object.assign({}, newNotification), { fromUser: newNotification.fromUser ? (0, userUtils_1.transformUser)(newNotification.fromUser) : newNotification.fromUser }),
    });
    return newNotification;
});
exports.createNotificationInDB = createNotificationInDB;
exports.notificationsController = {
    // GET /api/notifications - Get notifications for the current user or authorized company
    getMyNotifications: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const { limit = DEFAULT_PAGE_LIMIT, unreadOnly, ownerType = 'user', ownerId, cursor } = req.query;
            // Resolve effective actor identity
            let actor;
            try {
                actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                    ownerType: ownerType,
                    ownerId: ownerId
                });
            }
            catch (resolveError) {
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
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { limit: parseLimit(limit), nextCursor: null, hasMore: false },
                    unreadCount: 0
                });
            }
            const db = (0, db_1.getDB)();
            yield ensureNotificationIndexes(db);
            const limitNumber = parseLimit(limit);
            const parsedCursor = decodeCursor(cursor);
            if (cursor && !parsedCursor) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid cursor format'
                });
            }
            const baseQuery = {
                ownerType: actor.type,
                ownerId: targetId,
            };
            if (unreadOnly === 'true') {
                baseQuery.isRead = { $ne: true };
            }
            const query = Object.assign({}, baseQuery);
            if (parsedCursor) {
                query.$or = [
                    { timestamp: { $lt: parsedCursor.timestamp } },
                    { timestamp: parsedCursor.timestamp, id: { $lt: parsedCursor.id } },
                ];
            }
            const notificationDocs = yield db
                .collection(NOTIFICATIONS_COLLECTION)
                .find(query)
                .sort({ timestamp: -1, id: -1 })
                .limit(limitNumber + 1)
                .toArray();
            const hasMore = notificationDocs.length > limitNumber;
            const pageItems = hasMore ? notificationDocs.slice(0, limitNumber) : notificationDocs;
            const unreadCount = yield db.collection(NOTIFICATIONS_COLLECTION).countDocuments({
                ownerType: actor.type,
                ownerId: targetId,
                isRead: { $ne: true },
            });
            const transformed = pageItems.map((notification) => {
                if (notification.fromUser) {
                    notification.fromUser = (0, userUtils_1.transformUser)(notification.fromUser);
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
        }
        catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
        }
    }),
    // POST /api/notifications - Create new notification
    createNotification: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const { userId, type, fromUserId, message, postId, connectionId, ownerType = 'user', fromOwnerType } = req.body;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            if (!userId || !type || !fromUserId || !message) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }
            // Authorization: Only allow creating notifications if acting as fromUserId (user or company)
            const senderOwnerType = req.body.fromOwnerType || 'user';
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
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
            const isAdmin = ((_b = req.user) === null || _b === void 0 ? void 0 : _b.role) === 'admin' || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.isAdmin) === true;
            if (!isAdmin && userId !== actor.id) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'Only admins can create notifications for other identities'
                });
            }
            const db = (0, db_1.getDB)();
            yield ensureNotificationIndexes(db);
            const senderCollection = actor.type === 'company' ? 'companies' : 'users';
            const fromDoc = yield db.collection(senderCollection).findOne({ id: actor.id });
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
            const targetDoc = yield db.collection(collectionName).findOne({ id: userId });
            if (!targetDoc) {
                return res.status(404).json({ success: false, error: 'Target identity not found' });
            }
            yield evictOldestNotificationIfAtCap(db, ownerType, userId);
            yield db.collection(NOTIFICATIONS_COLLECTION).insertOne(newNotification);
            queueNotificationCleanup(ownerType, userId);
            if (newNotification.fromUser) {
                newNotification.fromUser = (0, userUtils_1.transformUser)(newNotification.fromUser);
            }
            res.status(201).json({ success: true, data: newNotification });
        }
        catch (error) {
            console.error('Error creating notification:', error);
            res.status(500).json({ success: false, error: 'Failed to create notification' });
        }
    }),
    // PUT /api/notifications/:id/read - Mark notification as read
    markAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const { ownerId, ownerType = 'user' } = req.body;
            const db = (0, db_1.getDB)();
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId
            });
            if (!actor) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
            const actorId = actor.id;
            yield ensureNotificationIndexes(db);
            const now = new Date();
            const result = yield db.collection(NOTIFICATIONS_COLLECTION).updateOne({
                ownerType: actor.type,
                ownerId: actorId,
                id
            }, {
                $set: {
                    isRead: true,
                    readAt: now,
                    updatedAt: now
                }
            });
            if (result.matchedCount === 0) {
                return res.status(404).json({ success: false, error: 'Notification not found' });
            }
            res.json({ success: true, message: 'Notification marked as read' });
        }
        catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }),
    // PUT /api/notifications/read-all - Mark all notifications as read
    markAllAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const { ownerId, ownerType = 'user' } = req.body;
            const db = (0, db_1.getDB)();
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId
            });
            if (!actor) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
            const actorId = actor.id;
            yield ensureNotificationIndexes(db);
            const now = new Date();
            const collectionResult = yield db.collection(NOTIFICATIONS_COLLECTION).updateMany({
                ownerType: actor.type,
                ownerId: actorId,
                isRead: { $ne: true }
            }, {
                $set: {
                    isRead: true,
                    readAt: now,
                    updatedAt: now
                }
            });
            if (collectionResult.modifiedCount === 0) {
                return res.json({ success: true, message: 'No unread notifications' });
            }
            res.json({ success: true, message: 'All notifications marked as read' });
        }
        catch (error) {
            console.error('Error marking all notifications as read:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }),
    // DELETE /api/notifications/:id - Delete notification
    deleteNotification: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const { ownerId, ownerType = 'user' } = req.body;
            const db = (0, db_1.getDB)();
            // Resolve effective actor identity
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId
            });
            if (!actor) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
            const actorId = actor.id;
            yield ensureNotificationIndexes(db);
            const result = yield db.collection(NOTIFICATIONS_COLLECTION).deleteOne({
                ownerType: actor.type,
                ownerId: actorId,
                id
            });
            if (result.deletedCount === 0) {
                return res.status(404).json({ success: false, error: 'Notification not found' });
            }
            res.json({ success: true, message: 'Notification deleted successfully' });
        }
        catch (error) {
            console.error('Error deleting notification:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    })
};
