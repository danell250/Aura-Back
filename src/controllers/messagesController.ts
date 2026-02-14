import { Request, Response } from 'express';
import { getMessagesCollection, IMessage } from '../models/Message';
import { ObjectId } from 'mongodb';
import { getDB, isDBConnected } from '../db';
import { transformUser } from '../utils/userUtils';
import { resolveIdentityActor, validateIdentityAccess } from '../utils/identityUtils';
import {
  buildMessageThreadKey,
  getMessageThreadsCollection,
  IMessageThread,
  MessageThreadState,
} from '../models/MessageThread';
import { getCallLogsCollection } from '../models/CallLog';

const SEND_WINDOW_MS = 60_000;
const SEND_WINDOW_LIMIT = 45;
const sendRateState = new Map<string, { count: number; startedAt: number }>();

const MESSAGE_STATES: MessageThreadState[] = ['active', 'archived', 'requests', 'muted', 'blocked'];

const actorMarker = (type: 'user' | 'company', id: string) => `${type}:${id}`;
const peerMarker = (type: 'user' | 'company', id: string) => `${type}:${id}`;
const actorDeleteMarkers = (actor: { type: 'user' | 'company'; id: string }) => {
  const markers = [actorMarker(actor.type, actor.id)];
  // Preserve old personal-only deletion markers for legacy user<->user message rows.
  if (actor.type === 'user') {
    markers.push(actor.id);
  }
  return markers;
};

const nowIso = () => new Date().toISOString();

const trimTo = (value: string, max: number) => value.trim().slice(0, max);

const sanitizeStringArray = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    next.push(trimmed.slice(0, maxLength));
    if (next.length >= maxItems) break;
  }
  return next;
};

const isActorSender = (message: any, actor: { type: 'user' | 'company'; id: string }) => {
  if (message.senderOwnerId && message.senderOwnerType) {
    return message.senderOwnerId === actor.id && message.senderOwnerType === actor.type;
  }
  if (actor.type !== 'user') return false;
  return (
    message.senderId === actor.id &&
    !message.senderOwnerType &&
    !message.senderOwnerId &&
    !message.receiverOwnerType &&
    !message.receiverOwnerId
  );
};

const isActorReceiver = (message: any, actor: { type: 'user' | 'company'; id: string }) => {
  if (message.receiverOwnerId && message.receiverOwnerType) {
    return message.receiverOwnerId === actor.id && message.receiverOwnerType === actor.type;
  }
  if (actor.type !== 'user') return false;
  return (
    message.receiverId === actor.id &&
    !message.senderOwnerType &&
    !message.senderOwnerId &&
    !message.receiverOwnerType &&
    !message.receiverOwnerId
  );
};

const messageAccessQuery = (actor: { type: 'user' | 'company'; id: string }, otherId: string, otherType?: 'user' | 'company') => {
  const resolvedOtherType = otherType || 'user';
  const deleteMarkers = actorDeleteMarkers(actor);
  const clauses: any[] = [
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
    clauses.push(
      {
        senderId: actor.id,
        receiverId: otherId,
        senderOwnerType: { $exists: false },
        receiverOwnerType: { $exists: false },
      },
      {
        senderId: otherId,
        receiverId: actor.id,
        senderOwnerType: { $exists: false },
        receiverOwnerType: { $exists: false },
      },
    );
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

const resolveEntityTypeById = async (id: string): Promise<'user' | 'company' | null> => {
  const db = getDB();

  const [company, user] = await Promise.all([
    db.collection('companies').findOne({ id }, { projection: { id: 1 } }),
    db.collection('users').findOne({ id }, { projection: { id: 1 } }),
  ]);

  if (company) return 'company';
  if (user) return 'user';
  return null;
};

const resolvePeerType = async (
  rawType: unknown,
  id: string
): Promise<'user' | 'company' | null> => {
  const explicitType = rawType === 'company' || rawType === 'user' ? rawType : null;
  const db = getDB();

  if (explicitType === 'company') {
    const company = await db.collection('companies').findOne({ id }, { projection: { id: 1 } });
    return company ? 'company' : null;
  }

  if (explicitType === 'user') {
    const user = await db.collection('users').findOne({ id }, { projection: { id: 1 } });
    return user ? 'user' : null;
  }

  return resolveEntityTypeById(id);
};

const applyRateLimit = (actor: { type: 'user' | 'company'; id: string }) => {
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

const unsafeLinkReason = (text: string): string | null => {
  const lowered = text.toLowerCase();
  if (/(javascript:|vbscript:|data:text\/html|file:)/i.test(lowered)) {
    return 'Unsafe link protocol detected';
  }

  if (/(<script|onerror=|onload=|<iframe)/i.test(lowered)) {
    return 'Potentially unsafe markup detected';
  }

  return null;
};

const computeThreadState = (thread: Partial<IMessageThread>): MessageThreadState => {
  if (thread.blocked) return 'blocked';
  if (thread.muted) return 'muted';
  if (thread.archived) return 'archived';
  if (thread.state === 'requests') return 'requests';
  return 'active';
};

const upsertThread = async (
  ownerType: 'user' | 'company',
  ownerId: string,
  peerType: 'user' | 'company',
  peerId: string,
  patch: Partial<IMessageThread> & { clearRequest?: boolean }
): Promise<IMessageThread> => {
  const threads = getMessageThreadsCollection();
  const key = buildMessageThreadKey(ownerType, ownerId, peerType, peerId);
  const existing = await threads.findOne({ key });

  const merged: Partial<IMessageThread> = {
    ...(existing || {}),
    ...patch,
    ownerType,
    ownerId,
    peerType,
    peerId,
    key,
  };

  if (patch.clearRequest) {
    merged.state = 'active';
  }

  merged.state = computeThreadState(merged);

  const updatePayload: any = {
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

  await threads.updateOne(
    { key },
    {
      $set: updatePayload,
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  const next = await threads.findOne({ key });
  return next as IMessageThread;
};

const threadStateSummary = (conversations: any[]) => {
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
    const state: MessageThreadState = MESSAGE_STATES.includes(conv.state as MessageThreadState)
      ? (conv.state as MessageThreadState)
      : 'active';
    summary[state] += 1;
  }

  return summary;
};

const isTrustedConversation = async (
  authenticatedUserId: string,
  sender: { type: 'user' | 'company'; id: string },
  receiverId: string,
  receiverType: 'user' | 'company'
): Promise<boolean> => {
  const db = getDB();

  if (sender.id === receiverId && sender.type === receiverType) return true;

  if (sender.type === 'user' && receiverType === 'user') {
    const senderDoc = await db.collection('users').findOne({ id: sender.id }, { projection: { acquaintances: 1 } });
    const acquaintances = Array.isArray(senderDoc?.acquaintances) ? senderDoc.acquaintances : [];
    return acquaintances.includes(receiverId);
  }

  if (sender.type === 'user' && receiverType === 'company') {
    const [senderDoc, membership] = await Promise.all([
      db.collection('users').findOne({ id: sender.id }, { projection: { subscribedCompanyIds: 1 } }),
      db.collection('company_members').findOne({ companyId: receiverId, userId: sender.id }),
    ]);

    const subscriptions = Array.isArray(senderDoc?.subscribedCompanyIds) ? senderDoc.subscribedCompanyIds : [];
    return subscriptions.includes(receiverId) || !!membership;
  }

  if (sender.type === 'company' && receiverType === 'user') {
    const [receiverDoc, employeeMembership] = await Promise.all([
      db.collection('users').findOne({ id: receiverId }, { projection: { subscribedCompanyIds: 1 } }),
      db.collection('company_members').findOne({ companyId: sender.id, userId: receiverId }),
    ]);

    const receiverSubscriptions = Array.isArray(receiverDoc?.subscribedCompanyIds)
      ? receiverDoc.subscribedCompanyIds
      : [];

    return receiverSubscriptions.includes(sender.id) || !!employeeMembership;
  }

  // company -> company
  if (sender.type === 'company' && receiverType === 'company') {
    return validateIdentityAccess(authenticatedUserId, receiverId);
  }

  return false;
};

const isConversationBlocked = async (
  actor: { type: 'user' | 'company'; id: string },
  otherType: 'user' | 'company',
  otherId: string
): Promise<boolean> => {
  const threads = getMessageThreadsCollection();

  const [actorThread, otherThread] = await Promise.all([
    threads.findOne({
      key: buildMessageThreadKey(actor.type, actor.id, otherType, otherId),
      blocked: true,
    }),
    threads.findOne({
      key: buildMessageThreadKey(otherType, otherId, actor.type, actor.id),
      blocked: true,
    }),
  ]);

  return !!actorThread || !!otherThread;
};

const parseState = (raw: unknown): MessageThreadState | null => {
  if (typeof raw !== 'string') return null;
  return MESSAGE_STATES.includes(raw as MessageThreadState) ? (raw as MessageThreadState) : null;
};

const buildThreadStatePatch = (state: MessageThreadState): Partial<IMessageThread> & { clearRequest?: boolean } => {
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

export const messagesController = {
  // GET /api/messages/call-history - Get call history for the active identity
  getCallHistory: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const actor = await resolveIdentityActor(
        authenticatedUserId,
        {
          ownerType: req.query.ownerType as string,
          ownerId: (req.query.userId as string) || (req.query.ownerId as string),
        },
        req.headers,
      );

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
      }

      if (!isDBConnected()) {
        return res.json({ success: true, data: [] });
      }

      const withId = typeof req.query.withId === 'string' ? req.query.withId.trim() : '';
      const withTypeRaw = req.query.withType;
      const withType = withTypeRaw === 'company' || withTypeRaw === 'user' ? withTypeRaw : undefined;
      const onlyMissed = String(req.query.onlyMissed || '').toLowerCase() === 'true';

      const limitInput = Number(req.query.limit);
      const limit = Number.isFinite(limitInput) ? Math.min(Math.max(Math.round(limitInput), 1), 200) : 100;

      const query: any = {};

      if (withId) {
        const resolvedWithType = withType || (await resolveEntityTypeById(withId));
        if (!resolvedWithType) {
          return res.status(404).json({ success: false, message: 'Conversation peer not found' });
        }

        query.$or = [
          { fromType: actor.type, fromId: actor.id, toType: resolvedWithType, toId: withId },
          { fromType: resolvedWithType, fromId: withId, toType: actor.type, toId: actor.id },
        ];
      } else {
        query.$or = [
          { fromType: actor.type, fromId: actor.id },
          { toType: actor.type, toId: actor.id },
        ];
      }

      if (onlyMissed) {
        query.status = 'missed';
        query.toType = actor.type;
        query.toId = actor.id;
      }

      const rows = await getCallLogsCollection()
        .find(query)
        .sort({ startedAt: -1 })
        .limit(limit)
        .toArray();

      const data = rows.map((row: any) => {
        const incoming = row.toType === actor.type && row.toId === actor.id;
        const peerType = incoming ? row.fromType : row.toType;
        const peerId = incoming ? row.fromId : row.toId;

        return {
          callId: row.callId,
          callType: row.callType,
          status: row.status,
          startedAt: row.startedAt,
          acceptedAt: row.acceptedAt || null,
          endedAt: row.endedAt || null,
          durationSeconds: typeof row.durationSeconds === 'number' ? row.durationSeconds : null,
          endReason: row.endReason || null,
          fromType: row.fromType,
          fromId: row.fromId,
          toType: row.toType,
          toId: row.toId,
          direction: incoming ? 'incoming' : 'outgoing',
          peerType,
          peerId,
          conversationKey: `${peerType}:${peerId}`,
          isMissedForActor: row.status === 'missed' && incoming,
        };
      });

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error fetching call history:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch call history',
      });
    }
  },

  // GET /api/messages/conversations - Get all conversations for an actor (personal or company)
  getConversations: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const actor = await resolveIdentityActor(
        authenticatedUserId,
        {
          ownerType: req.query.ownerType as string,
          ownerId: req.query.userId as string,
        },
        req.headers,
      );

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
      }

      if (!isDBConnected()) {
        return res.json({ success: true, data: [], summary: threadStateSummary([]) });
      }

      const stateFilter = parseState(req.query.state);
      const db = getDB();
      const messagesCollection = getMessagesCollection();
      const threadsCollection = getMessageThreadsCollection();

      const deleteMarkers = actorDeleteMarkers(actor);
      const actorMessageClauses: any[] =
        actor.type === 'company'
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

      const messages = await messagesCollection
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

      const byPeer = new Map<string, any>();

      for (const message of messages) {
        const actorSent = isActorSender(message, actor);
        const actorReceived = isActorReceiver(message, actor);

        if (!actorSent && !actorReceived) continue;

        const otherId = actorSent ? message.receiverId : message.senderId;
        if (!otherId) continue;

        const otherType = actorSent
          ? ((message.receiverOwnerType as 'user' | 'company' | undefined) || 'user')
          : ((message.senderOwnerType as 'user' | 'company' | undefined) || 'user');

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
        } else if (actorReceived && !message.isRead) {
          existing.unreadCount += 1;
        }
      }

      const peerEntries = Array.from(byPeer.values()) as Array<{
        peerId: string;
        peerType: 'user' | 'company';
        conversationKey: string;
        lastMessage: any;
        unreadCount: number;
      }>;
      if (peerEntries.length === 0) {
        return res.json({ success: true, data: [], summary: threadStateSummary([]) });
      }

      const userPeerIds = Array.from(
        new Set(peerEntries.filter((entry) => entry.peerType === 'user').map((entry) => entry.peerId)),
      );
      const companyPeerIds = Array.from(
        new Set(peerEntries.filter((entry) => entry.peerType === 'company').map((entry) => entry.peerId)),
      );
      const peerFilters = peerEntries.map((entry) => ({ peerType: entry.peerType, peerId: entry.peerId }));

      const [users, companies, actorDoc, threadDocs] = await Promise.all([
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

      const userById = new Map(users.map((item: any) => [item.id, item]));
      const companyById = new Map(companies.map((item: any) => [item.id, item]));
      const threadByPeer = new Map(threadDocs.map((item) => [peerMarker(item.peerType, item.peerId), item]));
      const archivedChats = Array.isArray((actorDoc as any)?.archivedChats) ? (actorDoc as any).archivedChats : [];

      const conversations = peerEntries
        .map((base) => {
          const peerId = base.peerId;
          const peerType = base.peerType;
          const thread = threadByPeer.get(base.conversationKey);
          const entity =
            peerType === 'company'
              ? companyById.get(peerId) || userById.get(peerId) || null
              : userById.get(peerId) || companyById.get(peerId) || null;

          if (!entity) return null;

          const normalized = thread || {
            state:
              archivedChats.includes(peerId) && peerType === 'user'
                ? ('archived' as MessageThreadState)
                : ('active' as MessageThreadState),
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
            otherUser: transformUser(entity),
            meta: {
              assignmentUserId: thread?.assignmentUserId || null,
              assignedByUserId: thread?.assignedByUserId || null,
              assignedAt: thread?.assignedAt || null,
              internalNotes: thread?.internalNotes || '',
              cannedReplies: Array.isArray(thread?.cannedReplies) ? thread?.cannedReplies : [],
              campaignTags: Array.isArray(thread?.campaignTags) ? thread?.campaignTags : [],
              slaMinutes: typeof thread?.slaMinutes === 'number' ? thread?.slaMinutes : null,
            },
          };
        })
        .filter((item): item is any => Boolean(item))
        .sort((a, b) => new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime());

      const filtered = stateFilter ? conversations.filter((conv) => conv.state === stateFilter) : conversations;

      res.json({
        success: true,
        data: filtered,
        summary: threadStateSummary(conversations),
      });
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch conversations',
      });
    }
  },

  // GET /api/messages/:otherId - Get messages between actor and another entity
  getMessages: async (req: Request, res: Response) => {
    try {
      const { userId: otherId } = req.params;
      const authenticatedUserId = (req.user as any)?.id;
      const { page = 1, limit = 50, ownerType, currentUserId, otherType: requestedOtherType } = req.query;

      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const actor = await resolveIdentityActor(
        authenticatedUserId,
        {
          ownerType: ownerType as string,
          ownerId: currentUserId as string,
        },
        req.headers,
      );

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
      }

      if (!isDBConnected()) {
        return res.json({ success: true, data: [] });
      }

      const otherType = await resolvePeerType(requestedOtherType, otherId);
      if (!otherType) {
        return res.status(404).json({ success: false, message: 'Conversation peer not found' });
      }
      const messagesCollection = getMessagesCollection();

      const messages = await messagesCollection
        .find(messageAccessQuery(actor, otherId, otherType))
        .sort({ timestamp: -1 })
        .limit(Number(limit))
        .skip((Number(page) - 1) * Number(limit))
        .toArray();

      const mappedMessages = messages.map((message: any) => ({
        ...message,
        id: message.id || (message._id ? String(message._id) : undefined),
      }));

      const markReadFilter: any = {
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

      await messagesCollection.updateMany(markReadFilter, { $set: { isRead: true } });

      res.json({
        success: true,
        data: mappedMessages.reverse(),
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch messages',
      });
    }
  },

  // POST /api/messages - Send a new message
  sendMessage: async (req: Request, res: Response) => {
    try {
      const {
        senderId: requestedSenderId,
        ownerType,
        receiverId,
        text,
        messageType = 'text',
        receiverType: requestedReceiverType,
        mediaUrl,
        mediaKey,
        mediaMimeType,
        mediaSize,
        replyTo,
      } = req.body;

      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, {
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

      if (!isDBConnected()) {
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

      const receiverType = await resolvePeerType(requestedReceiverType, receiverId);
      if (!receiverType) {
        return res.status(404).json({ success: false, message: 'Receiver not found' });
      }

      const blocked = await isConversationBlocked(actor, receiverType, receiverId);
      if (blocked) {
        return res.status(403).json({ success: false, message: 'Messaging is blocked for this conversation' });
      }

      const trusted = await isTrustedConversation(authenticatedUserId, actor, receiverId, receiverType);

      const messagesCollection = getMessagesCollection();

      const message: IMessage = {
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

      const result = await messagesCollection.insertOne(message);
      const insertedMessage = await messagesCollection.findOne({ _id: result.insertedId });

      await upsertThread(actor.type, actor.id, receiverType, receiverId, {
        archived: false,
        muted: false,
        blocked: false,
        state: 'active',
      });

      await upsertThread(receiverType, receiverId, actor.type, actor.id, {
        state: trusted ? 'active' : 'requests',
      });

      const responseMessage = insertedMessage
        ? {
            ...insertedMessage,
            id: (insertedMessage as any)._id ? String((insertedMessage as any)._id) : undefined,
          }
        : null;

      res.status(201).json({
        success: true,
        data: responseMessage,
        threadState: trusted ? 'active' : 'requests',
      });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send message',
      });
    }
  },

  // PUT /api/messages/:messageId - Edit a message
  editMessage: async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;
      const { text } = req.body;
      const authenticatedUserId = (req.user as any)?.id;

      if (!text) {
        return res.status(400).json({ success: false, message: 'Text is required' });
      }

      if (!isDBConnected()) {
        return res.status(503).json({ success: false, message: 'Service unavailable' });
      }

      const messagesCollection = getMessagesCollection();
      const message = await messagesCollection.findOne({ _id: new ObjectId(messageId) });

      if (!message) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }

      const actorId = message.senderOwnerId || message.senderId;
      const hasAccess = await validateIdentityAccess(authenticatedUserId, actorId);

      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Unauthorized to edit this message' });
      }

      const result = await messagesCollection.findOneAndUpdate(
        { _id: new ObjectId(messageId) },
        {
          $set: {
            text,
            isEdited: true,
            editedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error editing message:', error);
      res.status(500).json({ success: false, message: 'Failed to edit message' });
    }
  },

  // DELETE /api/messages/:messageId - Delete a message
  deleteMessage: async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;
      const authenticatedUserId = (req.user as any)?.id;

      if (!isDBConnected()) {
        return res.status(503).json({ success: false, message: 'Service unavailable' });
      }

      const messagesCollection = getMessagesCollection();
      const message = await messagesCollection.findOne({ _id: new ObjectId(messageId) });

      if (!message) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }

      const actorId = message.senderOwnerId || message.senderId;
      const hasAccess = await validateIdentityAccess(authenticatedUserId, actorId);

      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Unauthorized to delete this message' });
      }

      await messagesCollection.deleteOne({ _id: new ObjectId(messageId) });

      res.json({ success: true, message: 'Message deleted successfully' });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({ success: false, message: 'Failed to delete message' });
    }
  },

  // DELETE /api/messages/conversation - Delete all messages in a conversation
  deleteConversation: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      const { userId: requestedActorId, ownerType, otherUserId, otherType: requestedOtherType } = req.body;

      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedActorId,
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      if (!otherUserId) {
        return res.status(400).json({ success: false, message: 'Other party is required' });
      }

      if (!isDBConnected()) {
        return res.status(503).json({ success: false, message: 'Service unavailable' });
      }

      const otherType = await resolvePeerType(requestedOtherType, otherUserId);
      if (!otherType) {
        return res.status(404).json({ success: false, message: 'Conversation peer not found' });
      }
      const messagesCollection = getMessagesCollection();

      const conversationQuery = messageAccessQuery(actor, otherUserId, otherType);
      const deleteMarkers =
        actor.type === 'user' && otherType === 'user'
          ? [actorMarker(actor.type, actor.id), actor.id]
          : [actorMarker(actor.type, actor.id)];
      await messagesCollection.updateMany(conversationQuery, {
        $addToSet: { deletedFor: { $each: deleteMarkers } } as any,
      });

      res.json({ success: true, message: 'Conversation deleted successfully' });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      res.status(500).json({ success: false, message: 'Failed to delete conversation' });
    }
  },

  markAsRead: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const requestedActorId =
        req.body.receiverId ||
        req.body.currentUserId ||
        req.body.userId ||
        (req.query.receiverId as string) ||
        (req.query.currentUserId as string) ||
        (req.query.userId as string);

      const ownerType = req.body.ownerType || (req.query.ownerType as string);
      const requestedOtherType = req.body.otherType || (req.query.otherType as string);

      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedActorId,
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const otherId =
        req.body.senderId || req.body.otherUserId || (req.query.senderId as string) || (req.query.otherUserId as string);

      if (!otherId) {
        return res.json({ success: true, message: 'Missing sender parameters' });
      }

      if (!isDBConnected()) {
        return res.status(503).json({ success: false, message: 'Service unavailable' });
      }

      const otherType = await resolvePeerType(requestedOtherType, otherId);
      if (!otherType) {
        return res.status(404).json({ success: false, message: 'Conversation peer not found' });
      }
      const messagesCollection = getMessagesCollection();

      const filter: any = {
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

      await messagesCollection.updateMany(filter, { $set: { isRead: true } });

      await upsertThread(actor.type, actor.id, otherType, otherId, { clearRequest: true });

      res.json({ success: true, message: 'Messages marked as read' });
    } catch (error) {
      console.error('Error marking messages as read:', error);
      res.status(500).json({ success: false, message: 'Failed to mark messages as read' });
    }
  },

  archiveConversation: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { userId: requestedActorId, ownerType, otherUserId, otherType: requestedOtherType, archived } = req.body;

      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedActorId,
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      if (!otherUserId || typeof archived !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Invalid parameters' });
      }

      const peerType = await resolvePeerType(requestedOtherType, otherUserId);
      if (!peerType) {
        return res.status(404).json({ success: false, message: 'Conversation peer not found' });
      }
      const nextState: MessageThreadState = archived ? 'archived' : 'active';

      await upsertThread(actor.type, actor.id, peerType, otherUserId, buildThreadStatePatch(nextState));

      // Backward compatibility for existing archivedChats logic
      const db = getDB();
      const legacyUpdate = archived
        ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: nowIso() } }
        : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: nowIso() } };

      await Promise.all([
        db.collection('users').updateOne({ id: actor.id }, legacyUpdate),
        db.collection('companies').updateOne({ id: actor.id }, legacyUpdate),
      ]);

      res.json({
        success: true,
        message: archived ? 'Conversation archived successfully' : 'Conversation unarchived successfully',
      });
    } catch (error) {
      console.error('Error archiving conversation:', error);
      res.status(500).json({ success: false, message: 'Failed to update archive state' });
    }
  },

  // POST /api/messages/thread-state - Set conversation state
  setThreadState: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { userId: requestedActorId, ownerType, otherUserId, otherType: requestedOtherType, state } = req.body;
      const nextState = parseState(state);

      if (!otherUserId || !nextState) {
        return res.status(400).json({ success: false, message: 'otherUserId and valid state are required' });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedActorId,
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const peerType = await resolvePeerType(requestedOtherType, otherUserId);
      if (!peerType) {
        return res.status(404).json({ success: false, message: 'Conversation peer not found' });
      }
      const thread = await upsertThread(actor.type, actor.id, peerType, otherUserId, buildThreadStatePatch(nextState));

      // Keep archivedChats fallback synchronized for old clients.
      const db = getDB();
      const legacyUpdate = nextState === 'archived'
        ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: nowIso() } }
        : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: nowIso() } };

      await Promise.all([
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
    } catch (error) {
      console.error('Error setting thread state:', error);
      res.status(500).json({ success: false, message: 'Failed to update conversation state' });
    }
  },

  // GET /api/messages/thread-meta - Read conversation metadata
  getThreadMeta: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const requestedActorId = (req.query.userId as string) || (req.query.currentUserId as string);
      const ownerType = req.query.ownerType as string;
      const otherUserId = req.query.otherUserId as string;
      const requestedOtherType = req.query.otherType as string;

      if (!otherUserId) {
        return res.status(400).json({ success: false, message: 'otherUserId is required' });
      }

      const actor = await resolveIdentityActor(
        authenticatedUserId,
        {
          ownerType,
          ownerId: requestedActorId,
        },
        req.headers,
      );

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const peerType = await resolvePeerType(requestedOtherType, otherUserId);
      if (!peerType) {
        return res.status(404).json({ success: false, message: 'Conversation peer not found' });
      }
      const key = buildMessageThreadKey(actor.type, actor.id, peerType, otherUserId);
      const thread = await getMessageThreadsCollection().findOne({ key });

      res.json({
        success: true,
        data: {
          state: thread?.state || 'active',
          archived: !!thread?.archived,
          muted: !!thread?.muted,
          blocked: !!thread?.blocked,
          assignmentUserId: thread?.assignmentUserId || '',
          assignedByUserId: thread?.assignedByUserId || '',
          assignedAt: thread?.assignedAt || null,
          internalNotes: thread?.internalNotes || '',
          cannedReplies: Array.isArray(thread?.cannedReplies) ? thread?.cannedReplies : [],
          campaignTags: Array.isArray(thread?.campaignTags) ? thread?.campaignTags : [],
          slaMinutes: typeof thread?.slaMinutes === 'number' ? thread.slaMinutes : null,
        },
      });
    } catch (error) {
      console.error('Error reading thread meta:', error);
      res.status(500).json({ success: false, message: 'Failed to load thread metadata' });
    }
  },

  // POST /api/messages/thread-meta - Update conversation metadata (company-focused)
  updateThreadMeta: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const {
        userId: requestedActorId,
        ownerType,
        otherUserId,
        otherType: requestedOtherType,
        assignmentUserId,
        internalNotes,
        cannedReplies,
        campaignTags,
        slaMinutes,
      } = req.body;

      if (!otherUserId) {
        return res.status(400).json({ success: false, message: 'otherUserId is required' });
      }

      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedActorId,
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      if (actor.type !== 'company') {
        return res.status(403).json({ success: false, message: 'Thread metadata is only available for company inboxes' });
      }

      const peerType = await resolvePeerType(requestedOtherType, otherUserId);
      if (!peerType) {
        return res.status(404).json({ success: false, message: 'Conversation peer not found' });
      }

      const patch: Partial<IMessageThread> = {};

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

      const thread = await upsertThread(actor.type, actor.id, peerType, otherUserId, patch);

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
    } catch (error) {
      console.error('Error updating thread meta:', error);
      res.status(500).json({ success: false, message: 'Failed to update thread metadata' });
    }
  },
};
