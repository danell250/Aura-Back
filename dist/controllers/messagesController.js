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
exports.messagesController = void 0;
const Message_1 = require("../models/Message");
const mongodb_1 = require("mongodb");
const db_1 = require("../db");
const userUtils_1 = require("../utils/userUtils");
const identityUtils_1 = require("../utils/identityUtils");
const MessageThread_1 = require("../models/MessageThread");
const SEND_WINDOW_MS = 60000;
const SEND_WINDOW_LIMIT = 45;
const sendRateState = new Map();
const MESSAGE_STATES = ['active', 'archived', 'requests', 'muted', 'blocked'];
const actorMarker = (type, id) => `${type}:${id}`;
const peerMarker = (type, id) => `${type}:${id}`;
const actorDeleteMarkers = (actor) => {
    const markers = [actorMarker(actor.type, actor.id)];
    // Preserve old personal-only deletion markers for legacy user<->user message rows.
    if (actor.type === 'user') {
        markers.push(actor.id);
    }
    return markers;
};
const nowIso = () => new Date().toISOString();
const trimTo = (value, max) => value.trim().slice(0, max);
const sanitizeStringArray = (value, maxItems, maxLength) => {
    if (!Array.isArray(value))
        return [];
    const next = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const trimmed = item.trim();
        if (!trimmed)
            continue;
        next.push(trimmed.slice(0, maxLength));
        if (next.length >= maxItems)
            break;
    }
    return next;
};
const isActorSender = (message, actor) => {
    if (message.senderOwnerId && message.senderOwnerType) {
        return message.senderOwnerId === actor.id && message.senderOwnerType === actor.type;
    }
    if (actor.type !== 'user')
        return false;
    return (message.senderId === actor.id &&
        !message.senderOwnerType &&
        !message.senderOwnerId &&
        !message.receiverOwnerType &&
        !message.receiverOwnerId);
};
const isActorReceiver = (message, actor) => {
    if (message.receiverOwnerId && message.receiverOwnerType) {
        return message.receiverOwnerId === actor.id && message.receiverOwnerType === actor.type;
    }
    if (actor.type !== 'user')
        return false;
    return (message.receiverId === actor.id &&
        !message.senderOwnerType &&
        !message.senderOwnerId &&
        !message.receiverOwnerType &&
        !message.receiverOwnerId);
};
const messageAccessQuery = (actor, otherId, otherType) => {
    const resolvedOtherType = otherType || 'user';
    const deleteMarkers = actorDeleteMarkers(actor);
    const clauses = [
        {
            senderOwnerType: actor.type,
            senderOwnerId: actor.id,
            receiverOwnerType: resolvedOtherType,
            receiverOwnerId: otherId,
        },
        {
            senderOwnerType: resolvedOtherType,
            senderOwnerId: otherId,
            receiverOwnerType: actor.type,
            receiverOwnerId: actor.id,
        },
    ];
    // Backward-compatible legacy support for old personal<->personal messages
    if (actor.type === 'user' && resolvedOtherType === 'user') {
        clauses.push({
            senderId: actor.id,
            receiverId: otherId,
            senderOwnerType: { $exists: false },
            receiverOwnerType: { $exists: false },
        }, {
            senderId: otherId,
            receiverId: actor.id,
            senderOwnerType: { $exists: false },
            receiverOwnerType: { $exists: false },
        });
    }
    return {
        $and: [
            { $or: clauses },
            {
                $or: [
                    { deletedFor: { $exists: false } },
                    { deletedFor: { $nin: deleteMarkers } },
                ],
            },
        ],
    };
};
const resolveEntityTypeById = (id) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const [company, user] = yield Promise.all([
        db.collection('companies').findOne({ id }, { projection: { id: 1 } }),
        db.collection('users').findOne({ id }, { projection: { id: 1 } }),
    ]);
    if (company)
        return 'company';
    if (user)
        return 'user';
    return null;
});
const resolvePeerType = (rawType, id) => __awaiter(void 0, void 0, void 0, function* () {
    const explicitType = rawType === 'company' || rawType === 'user' ? rawType : null;
    const db = (0, db_1.getDB)();
    if (explicitType === 'company') {
        const company = yield db.collection('companies').findOne({ id }, { projection: { id: 1 } });
        return company ? 'company' : null;
    }
    if (explicitType === 'user') {
        const user = yield db.collection('users').findOne({ id }, { projection: { id: 1 } });
        return user ? 'user' : null;
    }
    return resolveEntityTypeById(id);
});
const applyRateLimit = (actor) => {
    const key = actorMarker(actor.type, actor.id);
    const now = Date.now();
    const current = sendRateState.get(key);
    if (!current || now - current.startedAt > SEND_WINDOW_MS) {
        sendRateState.set(key, { count: 1, startedAt: now });
        return { allowed: true, remaining: SEND_WINDOW_LIMIT - 1 };
    }
    if (current.count >= SEND_WINDOW_LIMIT) {
        return { allowed: false, remaining: 0 };
    }
    current.count += 1;
    sendRateState.set(key, current);
    return { allowed: true, remaining: SEND_WINDOW_LIMIT - current.count };
};
const unsafeLinkReason = (text) => {
    const lowered = text.toLowerCase();
    if (/(javascript:|vbscript:|data:text\/html|file:)/i.test(lowered)) {
        return 'Unsafe link protocol detected';
    }
    if (/(<script|onerror=|onload=|<iframe)/i.test(lowered)) {
        return 'Potentially unsafe markup detected';
    }
    return null;
};
const computeThreadState = (thread) => {
    if (thread.blocked)
        return 'blocked';
    if (thread.muted)
        return 'muted';
    if (thread.archived)
        return 'archived';
    if (thread.state === 'requests')
        return 'requests';
    return 'active';
};
const upsertThread = (ownerType, ownerId, peerType, peerId, patch) => __awaiter(void 0, void 0, void 0, function* () {
    const threads = (0, MessageThread_1.getMessageThreadsCollection)();
    const key = (0, MessageThread_1.buildMessageThreadKey)(ownerType, ownerId, peerType, peerId);
    const existing = yield threads.findOne({ key });
    const merged = Object.assign(Object.assign(Object.assign({}, (existing || {})), patch), { ownerType,
        ownerId,
        peerType,
        peerId,
        key });
    if (patch.clearRequest) {
        merged.state = 'active';
    }
    merged.state = computeThreadState(merged);
    const updatePayload = {
        ownerType,
        ownerId,
        peerType,
        peerId,
        state: merged.state,
        archived: !!merged.archived,
        muted: !!merged.muted,
        blocked: !!merged.blocked,
        assignmentUserId: merged.assignmentUserId,
        assignedByUserId: merged.assignedByUserId,
        assignedAt: merged.assignedAt,
        internalNotes: merged.internalNotes,
        cannedReplies: Array.isArray(merged.cannedReplies) ? merged.cannedReplies : [],
        campaignTags: Array.isArray(merged.campaignTags) ? merged.campaignTags : [],
        slaMinutes: typeof merged.slaMinutes === 'number' ? merged.slaMinutes : undefined,
        updatedAt: new Date(),
    };
    yield threads.updateOne({ key }, {
        $set: updatePayload,
        $setOnInsert: { createdAt: new Date() },
    }, { upsert: true });
    const next = yield threads.findOne({ key });
    return next;
});
const threadStateSummary = (conversations) => {
    const summary = {
        total: 0,
        active: 0,
        archived: 0,
        requests: 0,
        muted: 0,
        blocked: 0,
    };
    for (const conv of conversations) {
        summary.total += 1;
        const state = MESSAGE_STATES.includes(conv.state)
            ? conv.state
            : 'active';
        summary[state] += 1;
    }
    return summary;
};
const isTrustedConversation = (authenticatedUserId, sender, receiverId, receiverType) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    if (sender.id === receiverId && sender.type === receiverType)
        return true;
    if (sender.type === 'user' && receiverType === 'user') {
        const senderDoc = yield db.collection('users').findOne({ id: sender.id }, { projection: { acquaintances: 1 } });
        const acquaintances = Array.isArray(senderDoc === null || senderDoc === void 0 ? void 0 : senderDoc.acquaintances) ? senderDoc.acquaintances : [];
        return acquaintances.includes(receiverId);
    }
    if (sender.type === 'user' && receiverType === 'company') {
        const [senderDoc, membership] = yield Promise.all([
            db.collection('users').findOne({ id: sender.id }, { projection: { subscribedCompanyIds: 1 } }),
            db.collection('company_members').findOne({ companyId: receiverId, userId: sender.id }),
        ]);
        const subscriptions = Array.isArray(senderDoc === null || senderDoc === void 0 ? void 0 : senderDoc.subscribedCompanyIds) ? senderDoc.subscribedCompanyIds : [];
        return subscriptions.includes(receiverId) || !!membership;
    }
    if (sender.type === 'company' && receiverType === 'user') {
        const [receiverDoc, employeeMembership] = yield Promise.all([
            db.collection('users').findOne({ id: receiverId }, { projection: { subscribedCompanyIds: 1 } }),
            db.collection('company_members').findOne({ companyId: sender.id, userId: receiverId }),
        ]);
        const receiverSubscriptions = Array.isArray(receiverDoc === null || receiverDoc === void 0 ? void 0 : receiverDoc.subscribedCompanyIds)
            ? receiverDoc.subscribedCompanyIds
            : [];
        return receiverSubscriptions.includes(sender.id) || !!employeeMembership;
    }
    // company -> company
    if (sender.type === 'company' && receiverType === 'company') {
        return (0, identityUtils_1.validateIdentityAccess)(authenticatedUserId, receiverId);
    }
    return false;
});
const isConversationBlocked = (actor, otherType, otherId) => __awaiter(void 0, void 0, void 0, function* () {
    const threads = (0, MessageThread_1.getMessageThreadsCollection)();
    const [actorThread, otherThread] = yield Promise.all([
        threads.findOne({
            key: (0, MessageThread_1.buildMessageThreadKey)(actor.type, actor.id, otherType, otherId),
            blocked: true,
        }),
        threads.findOne({
            key: (0, MessageThread_1.buildMessageThreadKey)(otherType, otherId, actor.type, actor.id),
            blocked: true,
        }),
    ]);
    return !!actorThread || !!otherThread;
});
const parseState = (raw) => {
    if (typeof raw !== 'string')
        return null;
    return MESSAGE_STATES.includes(raw) ? raw : null;
};
const buildThreadStatePatch = (state) => {
    switch (state) {
        case 'archived':
            return { archived: true, muted: false, blocked: false, state: 'archived' };
        case 'muted':
            return { archived: false, muted: true, blocked: false, state: 'muted' };
        case 'blocked':
            return { archived: false, muted: false, blocked: true, state: 'blocked' };
        case 'requests':
            return { archived: false, muted: false, blocked: false, state: 'requests' };
        case 'active':
        default:
            return { archived: false, muted: false, blocked: false, state: 'active', clearRequest: true };
    }
};
exports.messagesController = {
    // GET /api/messages/conversations - Get all conversations for an actor (personal or company)
    getConversations: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType: req.query.ownerType,
                ownerId: req.query.userId,
            }, req.headers);
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.json({ success: true, data: [], summary: threadStateSummary([]) });
            }
            const stateFilter = parseState(req.query.state);
            const db = (0, db_1.getDB)();
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const threadsCollection = (0, MessageThread_1.getMessageThreadsCollection)();
            const deleteMarkers = actorDeleteMarkers(actor);
            const actorMessageClauses = actor.type === 'company'
                ? [
                    { senderOwnerType: 'company', senderOwnerId: actor.id },
                    { receiverOwnerType: 'company', receiverOwnerId: actor.id },
                ]
                : [
                    { senderOwnerType: 'user', senderOwnerId: actor.id },
                    { receiverOwnerType: 'user', receiverOwnerId: actor.id },
                    {
                        senderId: actor.id,
                        senderOwnerType: { $exists: false },
                        receiverOwnerType: { $exists: false },
                    },
                    {
                        receiverId: actor.id,
                        senderOwnerType: { $exists: false },
                        receiverOwnerType: { $exists: false },
                    },
                ];
            const messages = yield messagesCollection
                .find({
                $and: [
                    {
                        $or: actorMessageClauses,
                    },
                    {
                        $or: [
                            { deletedFor: { $exists: false } },
                            { deletedFor: { $nin: deleteMarkers } },
                        ],
                    },
                ],
            })
                .sort({ timestamp: -1 })
                .toArray();
            const byPeer = new Map();
            for (const message of messages) {
                const actorSent = isActorSender(message, actor);
                const actorReceived = isActorReceiver(message, actor);
                if (!actorSent && !actorReceived)
                    continue;
                const otherId = actorSent ? message.receiverId : message.senderId;
                if (!otherId)
                    continue;
                const otherType = actorSent
                    ? (message.receiverOwnerType || 'user')
                    : (message.senderOwnerType || 'user');
                const peerKey = peerMarker(otherType, otherId);
                const existing = byPeer.get(peerKey);
                if (!existing) {
                    byPeer.set(peerKey, {
                        peerId: otherId,
                        peerType: otherType,
                        conversationKey: peerKey,
                        lastMessage: message,
                        unreadCount: actorReceived && !message.isRead ? 1 : 0,
                    });
                }
                else if (actorReceived && !message.isRead) {
                    existing.unreadCount += 1;
                }
            }
            const peerEntries = Array.from(byPeer.values());
            if (peerEntries.length === 0) {
                return res.json({ success: true, data: [], summary: threadStateSummary([]) });
            }
            const userPeerIds = Array.from(new Set(peerEntries.filter((entry) => entry.peerType === 'user').map((entry) => entry.peerId)));
            const companyPeerIds = Array.from(new Set(peerEntries.filter((entry) => entry.peerType === 'company').map((entry) => entry.peerId)));
            const peerFilters = peerEntries.map((entry) => ({ peerType: entry.peerType, peerId: entry.peerId }));
            const [users, companies, actorDoc, threadDocs] = yield Promise.all([
                userPeerIds.length > 0 ? db.collection('users').find({ id: { $in: userPeerIds } }).toArray() : Promise.resolve([]),
                companyPeerIds.length > 0
                    ? db.collection('companies').find({ id: { $in: companyPeerIds } }).toArray()
                    : Promise.resolve([]),
                db.collection(actor.type === 'company' ? 'companies' : 'users').findOne({ id: actor.id }),
                peerFilters.length > 0
                    ? threadsCollection
                        .find({
                        ownerType: actor.type,
                        ownerId: actor.id,
                        $or: peerFilters,
                    })
                        .toArray()
                    : Promise.resolve([]),
            ]);
            const userById = new Map(users.map((item) => [item.id, item]));
            const companyById = new Map(companies.map((item) => [item.id, item]));
            const threadByPeer = new Map(threadDocs.map((item) => [peerMarker(item.peerType, item.peerId), item]));
            const archivedChats = Array.isArray(actorDoc === null || actorDoc === void 0 ? void 0 : actorDoc.archivedChats) ? actorDoc.archivedChats : [];
            const conversations = peerEntries
                .map((base) => {
                const peerId = base.peerId;
                const peerType = base.peerType;
                const thread = threadByPeer.get(base.conversationKey);
                const entity = peerType === 'company'
                    ? companyById.get(peerId) || userById.get(peerId) || null
                    : userById.get(peerId) || companyById.get(peerId) || null;
                if (!entity)
                    return null;
                const normalized = thread || {
                    state: archivedChats.includes(peerId) && peerType === 'user'
                        ? 'archived'
                        : 'active',
                };
                const state = normalized.state || 'active';
                return {
                    _id: peerId,
                    conversationKey: base.conversationKey,
                    peerId,
                    peerType,
                    otherType: peerType,
                    lastMessage: base.lastMessage,
                    unreadCount: base.unreadCount,
                    state,
                    isArchived: state === 'archived',
                    isMuted: state === 'muted',
                    isBlocked: state === 'blocked',
                    isRequest: state === 'requests',
                    otherUser: (0, userUtils_1.transformUser)(entity),
                    meta: {
                        assignmentUserId: (thread === null || thread === void 0 ? void 0 : thread.assignmentUserId) || null,
                        assignedByUserId: (thread === null || thread === void 0 ? void 0 : thread.assignedByUserId) || null,
                        assignedAt: (thread === null || thread === void 0 ? void 0 : thread.assignedAt) || null,
                        internalNotes: (thread === null || thread === void 0 ? void 0 : thread.internalNotes) || '',
                        cannedReplies: Array.isArray(thread === null || thread === void 0 ? void 0 : thread.cannedReplies) ? thread === null || thread === void 0 ? void 0 : thread.cannedReplies : [],
                        campaignTags: Array.isArray(thread === null || thread === void 0 ? void 0 : thread.campaignTags) ? thread === null || thread === void 0 ? void 0 : thread.campaignTags : [],
                        slaMinutes: typeof (thread === null || thread === void 0 ? void 0 : thread.slaMinutes) === 'number' ? thread === null || thread === void 0 ? void 0 : thread.slaMinutes : null,
                    },
                };
            })
                .filter((item) => Boolean(item))
                .sort((a, b) => new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime());
            const filtered = stateFilter ? conversations.filter((conv) => conv.state === stateFilter) : conversations;
            res.json({
                success: true,
                data: filtered,
                summary: threadStateSummary(conversations),
            });
        }
        catch (error) {
            console.error('Error fetching conversations:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch conversations',
            });
        }
    }),
    // GET /api/messages/:otherId - Get messages between actor and another entity
    getMessages: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { userId: otherId } = req.params;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const { page = 1, limit = 50, ownerType, currentUserId, otherType: requestedOtherType } = req.query;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType: ownerType,
                ownerId: currentUserId,
            }, req.headers);
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.json({ success: true, data: [] });
            }
            const otherType = yield resolvePeerType(requestedOtherType, otherId);
            if (!otherType) {
                return res.status(404).json({ success: false, message: 'Conversation peer not found' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const messages = yield messagesCollection
                .find(messageAccessQuery(actor, otherId, otherType))
                .sort({ timestamp: -1 })
                .limit(Number(limit))
                .skip((Number(page) - 1) * Number(limit))
                .toArray();
            const mappedMessages = messages.map((message) => (Object.assign(Object.assign({}, message), { id: message.id || (message._id ? String(message._id) : undefined) })));
            const markReadFilter = {
                isRead: false,
                $or: [],
            };
            markReadFilter.$or.push({
                senderOwnerType: otherType,
                senderOwnerId: otherId,
                receiverOwnerType: actor.type,
                receiverOwnerId: actor.id,
            });
            if (actor.type === 'user' && otherType === 'user') {
                markReadFilter.$or.push({
                    senderId: otherId,
                    receiverId: actor.id,
                    senderOwnerType: { $exists: false },
                    receiverOwnerType: { $exists: false },
                });
            }
            yield messagesCollection.updateMany(markReadFilter, { $set: { isRead: true } });
            res.json({
                success: true,
                data: mappedMessages.reverse(),
            });
        }
        catch (error) {
            console.error('Error fetching messages:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch messages',
            });
        }
    }),
    // POST /api/messages - Send a new message
    sendMessage: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { senderId: requestedSenderId, ownerType, receiverId, text, messageType = 'text', receiverType: requestedReceiverType, mediaUrl, mediaKey, mediaMimeType, mediaSize, replyTo, } = req.body;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedSenderId,
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized to send as this identity' });
            }
            if (!receiverId || (!text && !mediaUrl)) {
                return res.status(400).json({
                    success: false,
                    message: 'Receiver ID and content are required',
                });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({
                    success: false,
                    message: 'Messaging service is temporarily unavailable',
                });
            }
            const unsafeReason = text ? unsafeLinkReason(String(text)) : null;
            if (unsafeReason) {
                return res.status(400).json({
                    success: false,
                    message: unsafeReason,
                });
            }
            const rate = applyRateLimit(actor);
            if (!rate.allowed) {
                return res.status(429).json({
                    success: false,
                    message: 'Too many messages sent from this identity. Please wait a moment.',
                });
            }
            const receiverType = yield resolvePeerType(requestedReceiverType, receiverId);
            if (!receiverType) {
                return res.status(404).json({ success: false, message: 'Receiver not found' });
            }
            const blocked = yield isConversationBlocked(actor, receiverType, receiverId);
            if (blocked) {
                return res.status(403).json({ success: false, message: 'Messaging is blocked for this conversation' });
            }
            const trusted = yield isTrustedConversation(authenticatedUserId, actor, receiverId, receiverType);
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const message = {
                senderId: actor.id,
                senderOwnerType: actor.type,
                senderOwnerId: actor.id,
                receiverId,
                receiverOwnerType: receiverType,
                receiverOwnerId: receiverId,
                text: String(text || ''),
                timestamp: new Date(),
                isRead: false,
                messageType,
                mediaUrl,
                mediaKey,
                mediaMimeType,
                mediaSize,
                replyTo,
                isEdited: false,
            };
            const result = yield messagesCollection.insertOne(message);
            const insertedMessage = yield messagesCollection.findOne({ _id: result.insertedId });
            yield upsertThread(actor.type, actor.id, receiverType, receiverId, {
                archived: false,
                muted: false,
                blocked: false,
                state: 'active',
            });
            yield upsertThread(receiverType, receiverId, actor.type, actor.id, {
                state: trusted ? 'active' : 'requests',
            });
            const responseMessage = insertedMessage
                ? Object.assign(Object.assign({}, insertedMessage), { id: insertedMessage._id ? String(insertedMessage._id) : undefined }) : null;
            res.status(201).json({
                success: true,
                data: responseMessage,
                threadState: trusted ? 'active' : 'requests',
            });
        }
        catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send message',
            });
        }
    }),
    // PUT /api/messages/:messageId - Edit a message
    editMessage: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { messageId } = req.params;
            const { text } = req.body;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!text) {
                return res.status(400).json({ success: false, message: 'Text is required' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, message: 'Service unavailable' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const message = yield messagesCollection.findOne({ _id: new mongodb_1.ObjectId(messageId) });
            if (!message) {
                return res.status(404).json({ success: false, message: 'Message not found' });
            }
            const actorId = message.senderOwnerId || message.senderId;
            const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(authenticatedUserId, actorId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Unauthorized to edit this message' });
            }
            const result = yield messagesCollection.findOneAndUpdate({ _id: new mongodb_1.ObjectId(messageId) }, {
                $set: {
                    text,
                    isEdited: true,
                    editedAt: new Date(),
                },
            }, { returnDocument: 'after' });
            res.json({ success: true, data: result });
        }
        catch (error) {
            console.error('Error editing message:', error);
            res.status(500).json({ success: false, message: 'Failed to edit message' });
        }
    }),
    // DELETE /api/messages/:messageId - Delete a message
    deleteMessage: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { messageId } = req.params;
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, message: 'Service unavailable' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const message = yield messagesCollection.findOne({ _id: new mongodb_1.ObjectId(messageId) });
            if (!message) {
                return res.status(404).json({ success: false, message: 'Message not found' });
            }
            const actorId = message.senderOwnerId || message.senderId;
            const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(authenticatedUserId, actorId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Unauthorized to delete this message' });
            }
            yield messagesCollection.deleteOne({ _id: new mongodb_1.ObjectId(messageId) });
            res.json({ success: true, message: 'Message deleted successfully' });
        }
        catch (error) {
            console.error('Error deleting message:', error);
            res.status(500).json({ success: false, message: 'Failed to delete message' });
        }
    }),
    // DELETE /api/messages/conversation - Delete all messages in a conversation
    deleteConversation: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const { userId: requestedActorId, ownerType, otherUserId, otherType: requestedOtherType } = req.body;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId,
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            if (!otherUserId) {
                return res.status(400).json({ success: false, message: 'Other party is required' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, message: 'Service unavailable' });
            }
            const otherType = yield resolvePeerType(requestedOtherType, otherUserId);
            if (!otherType) {
                return res.status(404).json({ success: false, message: 'Conversation peer not found' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const conversationQuery = messageAccessQuery(actor, otherUserId, otherType);
            const deleteMarkers = actor.type === 'user' && otherType === 'user'
                ? [actorMarker(actor.type, actor.id), actor.id]
                : [actorMarker(actor.type, actor.id)];
            yield messagesCollection.updateMany(conversationQuery, {
                $addToSet: { deletedFor: { $each: deleteMarkers } },
            });
            res.json({ success: true, message: 'Conversation deleted successfully' });
        }
        catch (error) {
            console.error('Error deleting conversation:', error);
            res.status(500).json({ success: false, message: 'Failed to delete conversation' });
        }
    }),
    markAsRead: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const requestedActorId = req.body.receiverId ||
                req.body.currentUserId ||
                req.body.userId ||
                req.query.receiverId ||
                req.query.currentUserId ||
                req.query.userId;
            const ownerType = req.body.ownerType || req.query.ownerType;
            const requestedOtherType = req.body.otherType || req.query.otherType;
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId,
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            const otherId = req.body.senderId || req.body.otherUserId || req.query.senderId || req.query.otherUserId;
            if (!otherId) {
                return res.json({ success: true, message: 'Missing sender parameters' });
            }
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, message: 'Service unavailable' });
            }
            const otherType = yield resolvePeerType(requestedOtherType, otherId);
            if (!otherType) {
                return res.status(404).json({ success: false, message: 'Conversation peer not found' });
            }
            const messagesCollection = (0, Message_1.getMessagesCollection)();
            const filter = {
                isRead: false,
                $or: [],
            };
            filter.$or.push({
                senderOwnerType: otherType,
                senderOwnerId: otherId,
                receiverOwnerType: actor.type,
                receiverOwnerId: actor.id,
            });
            if (actor.type === 'user' && otherType === 'user') {
                filter.$or.push({
                    senderId: otherId,
                    receiverId: actor.id,
                    senderOwnerType: { $exists: false },
                    receiverOwnerType: { $exists: false },
                });
            }
            yield messagesCollection.updateMany(filter, { $set: { isRead: true } });
            yield upsertThread(actor.type, actor.id, otherType, otherId, { clearRequest: true });
            res.json({ success: true, message: 'Messages marked as read' });
        }
        catch (error) {
            console.error('Error marking messages as read:', error);
            res.status(500).json({ success: false, message: 'Failed to mark messages as read' });
        }
    }),
    archiveConversation: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const { userId: requestedActorId, ownerType, otherUserId, otherType: requestedOtherType, archived } = req.body;
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId,
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            if (!otherUserId || typeof archived !== 'boolean') {
                return res.status(400).json({ success: false, message: 'Invalid parameters' });
            }
            const peerType = yield resolvePeerType(requestedOtherType, otherUserId);
            if (!peerType) {
                return res.status(404).json({ success: false, message: 'Conversation peer not found' });
            }
            const nextState = archived ? 'archived' : 'active';
            yield upsertThread(actor.type, actor.id, peerType, otherUserId, buildThreadStatePatch(nextState));
            // Backward compatibility for existing archivedChats logic
            const db = (0, db_1.getDB)();
            const legacyUpdate = archived
                ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: nowIso() } }
                : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: nowIso() } };
            yield Promise.all([
                db.collection('users').updateOne({ id: actor.id }, legacyUpdate),
                db.collection('companies').updateOne({ id: actor.id }, legacyUpdate),
            ]);
            res.json({
                success: true,
                message: archived ? 'Conversation archived successfully' : 'Conversation unarchived successfully',
            });
        }
        catch (error) {
            console.error('Error archiving conversation:', error);
            res.status(500).json({ success: false, message: 'Failed to update archive state' });
        }
    }),
    // POST /api/messages/thread-state - Set conversation state
    setThreadState: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const { userId: requestedActorId, ownerType, otherUserId, otherType: requestedOtherType, state } = req.body;
            const nextState = parseState(state);
            if (!otherUserId || !nextState) {
                return res.status(400).json({ success: false, message: 'otherUserId and valid state are required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId,
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            const peerType = yield resolvePeerType(requestedOtherType, otherUserId);
            if (!peerType) {
                return res.status(404).json({ success: false, message: 'Conversation peer not found' });
            }
            const thread = yield upsertThread(actor.type, actor.id, peerType, otherUserId, buildThreadStatePatch(nextState));
            // Keep archivedChats fallback synchronized for old clients.
            const db = (0, db_1.getDB)();
            const legacyUpdate = nextState === 'archived'
                ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: nowIso() } }
                : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: nowIso() } };
            yield Promise.all([
                db.collection('users').updateOne({ id: actor.id }, legacyUpdate),
                db.collection('companies').updateOne({ id: actor.id }, legacyUpdate),
            ]);
            res.json({
                success: true,
                data: {
                    state: thread.state,
                    archived: !!thread.archived,
                    muted: !!thread.muted,
                    blocked: !!thread.blocked,
                },
            });
        }
        catch (error) {
            console.error('Error setting thread state:', error);
            res.status(500).json({ success: false, message: 'Failed to update conversation state' });
        }
    }),
    // GET /api/messages/thread-meta - Read conversation metadata
    getThreadMeta: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const requestedActorId = req.query.userId || req.query.currentUserId;
            const ownerType = req.query.ownerType;
            const otherUserId = req.query.otherUserId;
            const requestedOtherType = req.query.otherType;
            if (!otherUserId) {
                return res.status(400).json({ success: false, message: 'otherUserId is required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId,
            }, req.headers);
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            const peerType = yield resolvePeerType(requestedOtherType, otherUserId);
            if (!peerType) {
                return res.status(404).json({ success: false, message: 'Conversation peer not found' });
            }
            const key = (0, MessageThread_1.buildMessageThreadKey)(actor.type, actor.id, peerType, otherUserId);
            const thread = yield (0, MessageThread_1.getMessageThreadsCollection)().findOne({ key });
            res.json({
                success: true,
                data: {
                    state: (thread === null || thread === void 0 ? void 0 : thread.state) || 'active',
                    archived: !!(thread === null || thread === void 0 ? void 0 : thread.archived),
                    muted: !!(thread === null || thread === void 0 ? void 0 : thread.muted),
                    blocked: !!(thread === null || thread === void 0 ? void 0 : thread.blocked),
                    assignmentUserId: (thread === null || thread === void 0 ? void 0 : thread.assignmentUserId) || '',
                    assignedByUserId: (thread === null || thread === void 0 ? void 0 : thread.assignedByUserId) || '',
                    assignedAt: (thread === null || thread === void 0 ? void 0 : thread.assignedAt) || null,
                    internalNotes: (thread === null || thread === void 0 ? void 0 : thread.internalNotes) || '',
                    cannedReplies: Array.isArray(thread === null || thread === void 0 ? void 0 : thread.cannedReplies) ? thread === null || thread === void 0 ? void 0 : thread.cannedReplies : [],
                    campaignTags: Array.isArray(thread === null || thread === void 0 ? void 0 : thread.campaignTags) ? thread === null || thread === void 0 ? void 0 : thread.campaignTags : [],
                    slaMinutes: typeof (thread === null || thread === void 0 ? void 0 : thread.slaMinutes) === 'number' ? thread.slaMinutes : null,
                },
            });
        }
        catch (error) {
            console.error('Error reading thread meta:', error);
            res.status(500).json({ success: false, message: 'Failed to load thread metadata' });
        }
    }),
    // POST /api/messages/thread-meta - Update conversation metadata (company-focused)
    updateThreadMeta: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const { userId: requestedActorId, ownerType, otherUserId, otherType: requestedOtherType, assignmentUserId, internalNotes, cannedReplies, campaignTags, slaMinutes, } = req.body;
            if (!otherUserId) {
                return res.status(400).json({ success: false, message: 'otherUserId is required' });
            }
            const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
                ownerType,
                ownerId: requestedActorId,
            });
            if (!actor) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            if (actor.type !== 'company') {
                return res.status(403).json({ success: false, message: 'Thread metadata is only available for company inboxes' });
            }
            const peerType = yield resolvePeerType(requestedOtherType, otherUserId);
            if (!peerType) {
                return res.status(404).json({ success: false, message: 'Conversation peer not found' });
            }
            const patch = {};
            if (typeof assignmentUserId === 'string') {
                patch.assignmentUserId = trimTo(assignmentUserId, 120);
                patch.assignedByUserId = authenticatedUserId;
                patch.assignedAt = new Date();
            }
            if (typeof internalNotes === 'string') {
                patch.internalNotes = trimTo(internalNotes, 3000);
            }
            if (Array.isArray(cannedReplies)) {
                patch.cannedReplies = sanitizeStringArray(cannedReplies, 20, 240);
            }
            if (Array.isArray(campaignTags)) {
                patch.campaignTags = sanitizeStringArray(campaignTags, 20, 50);
            }
            if (typeof slaMinutes === 'number' && Number.isFinite(slaMinutes) && slaMinutes >= 0) {
                patch.slaMinutes = Math.min(Math.round(slaMinutes), 60 * 24 * 30);
            }
            const thread = yield upsertThread(actor.type, actor.id, peerType, otherUserId, patch);
            res.json({
                success: true,
                data: {
                    state: thread.state,
                    assignmentUserId: thread.assignmentUserId || '',
                    assignedByUserId: thread.assignedByUserId || '',
                    assignedAt: thread.assignedAt || null,
                    internalNotes: thread.internalNotes || '',
                    cannedReplies: Array.isArray(thread.cannedReplies) ? thread.cannedReplies : [],
                    campaignTags: Array.isArray(thread.campaignTags) ? thread.campaignTags : [],
                    slaMinutes: typeof thread.slaMinutes === 'number' ? thread.slaMinutes : null,
                },
            });
        }
        catch (error) {
            console.error('Error updating thread meta:', error);
            res.status(500).json({ success: false, message: 'Failed to update thread metadata' });
        }
    }),
};
