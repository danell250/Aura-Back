import { ObjectId } from 'mongodb';
import { getDB } from '../db';
import { emitToIdentity } from '../realtime/socketHub';
import { getMessagesCollection, IMessage } from '../models/Message';
import { getMessageGroupsCollection } from '../models/MessageGroup';
import { buildMessageThreadKey, getMessageThreadsCollection } from '../models/MessageThread';

const GROUP_HANDLE_PREFIX = '@group';
const MAX_GROUP_PARTICIPANTS = 24;
const SEND_WINDOW_MS = 60_000;
const SEND_WINDOW_LIMIT = 45;

type Actor = { type: 'user' | 'company'; id: string };

type GroupMessagePayload = {
  text: string;
  messageType: IMessage['messageType'];
  mediaUrl?: string;
  mediaKey?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  replyTo?: string;
};

const actorMarker = (type: 'user' | 'company', id: string) => `${type}:${id}`;
const groupConversationKey = (groupId: string) => `group:${groupId}`;
const trimTo = (value: string, max: number) => value.trim().slice(0, max);

const normalizeGroupName = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  return trimTo(text || 'Group Chat', 80);
};

const buildGroupHandle = (name: string, id: string): string => {
  const compact = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  const suffix = id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-6);
  return `${GROUP_HANDLE_PREFIX}-${compact || 'chat'}-${suffix}`;
};

const actorHasGroupAccess = (
  actor: Actor,
  group: { participantKeys?: string[] },
) =>
  Array.isArray(group.participantKeys) &&
  group.participantKeys.includes(actorMarker(actor.type, actor.id));

const mapGroupMessageForActor = (message: any) => ({
  ...message,
  id: message.id || (message._id ? String(message._id) : undefined),
});

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

const normalizeAndValidateMediaUrl = (rawUrl: unknown): string | undefined => {
  if (typeof rawUrl !== 'string') return undefined;
  const value = rawUrl.trim();
  if (!value) return undefined;

  if (/^(javascript:|vbscript:|data:text\/html|file:)/i.test(value)) {
    throw new Error('Unsafe media URL detected');
  }

  if (value.startsWith('/uploads/')) {
    return value.slice(0, 1200);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid media URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Unsupported media URL protocol');
  }

  return parsed.toString().slice(0, 1200);
};

const applyRateLimit = async (actor: Actor) => {
  const key = actorMarker(actor.type, actor.id);
  const now = new Date();
  const nowMs = now.getTime();
  const collection = getDB().collection('message_rate_limits');
  const current = await collection.findOne({ key });

  const startedAtMs =
    current?.startedAt instanceof Date
      ? current.startedAt.getTime()
      : current?.startedAt
      ? new Date(current.startedAt).getTime()
      : 0;
  const expired = !startedAtMs || nowMs - startedAtMs > SEND_WINDOW_MS;

  if (!current || expired) {
    await collection.updateOne(
      { key },
      {
        $set: { key, count: 1, startedAt: now, updatedAt: now },
      },
      { upsert: true },
    );
    return { allowed: true, remaining: SEND_WINDOW_LIMIT - 1 };
  }

  const currentCount = typeof current.count === 'number' ? current.count : 0;
  if (currentCount >= SEND_WINDOW_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  const nextCount = currentCount + 1;
  await collection.updateOne(
    { key },
    {
      $set: { updatedAt: now },
      $inc: { count: 1 },
    },
  );

  return { allowed: true, remaining: SEND_WINDOW_LIMIT - nextCount };
};

const normalizeParticipantCandidates = (rawParticipants: unknown) =>
  (Array.isArray(rawParticipants) ? rawParticipants : [])
    .slice(0, MAX_GROUP_PARTICIPANTS)
    .map((item) =>
      typeof item === 'string'
        ? { type: 'user' as const, id: item }
        : typeof item === 'object' && item
        ? {
            type:
              (item as any).type === 'company'
                ? ('company' as const)
                : (item as any).type === 'user'
                ? ('user' as const)
                : null,
            id: String((item as any).id || ''),
          }
        : null,
    )
    .filter((candidate): candidate is { type: 'user' | 'company' | null; id: string } => Boolean(candidate?.id));

const resolveGroupParticipants = async (
  actor: Actor,
  rawParticipants: unknown,
): Promise<Array<{ type: 'user' | 'company'; id: string }>> => {
  const normalized = normalizeParticipantCandidates(rawParticipants);
  const explicitUserIds = new Set<string>();
  const explicitCompanyIds = new Set<string>();
  const unknownTypeIds = new Set<string>();

  normalized.forEach((candidate) => {
    if (candidate.type === 'user') explicitUserIds.add(candidate.id);
    else if (candidate.type === 'company') explicitCompanyIds.add(candidate.id);
    else unknownTypeIds.add(candidate.id);
  });

  unknownTypeIds.forEach((id) => {
    explicitUserIds.add(id);
    explicitCompanyIds.add(id);
  });

  const db = getDB();
  const [users, companies] = await Promise.all([
    explicitUserIds.size
      ? db
          .collection('users')
          .find({ id: { $in: Array.from(explicitUserIds) } }, { projection: { id: 1 } })
          .toArray()
      : Promise.resolve([]),
    explicitCompanyIds.size
      ? db
          .collection('companies')
          .find({ id: { $in: Array.from(explicitCompanyIds) }, legacyArchived: { $ne: true } }, { projection: { id: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);

  const userSet = new Set(users.map((entry: any) => String(entry.id)));
  const companySet = new Set(companies.map((entry: any) => String(entry.id)));
  const unique = new Map<string, { type: 'user' | 'company'; id: string }>();

  unique.set(actorMarker(actor.type, actor.id), { type: actor.type, id: actor.id });

  normalized.forEach((candidate) => {
    if (candidate.type === 'user') {
      if (!userSet.has(candidate.id)) return;
      unique.set(actorMarker('user', candidate.id), { type: 'user', id: candidate.id });
      return;
    }
    if (candidate.type === 'company') {
      if (!companySet.has(candidate.id)) return;
      unique.set(actorMarker('company', candidate.id), { type: 'company', id: candidate.id });
      return;
    }

    if (companySet.has(candidate.id)) {
      unique.set(actorMarker('company', candidate.id), { type: 'company', id: candidate.id });
      return;
    }
    if (userSet.has(candidate.id)) {
      unique.set(actorMarker('user', candidate.id), { type: 'user', id: candidate.id });
    }
  });

  return Array.from(unique.values()).slice(0, MAX_GROUP_PARTICIPANTS);
};

const upsertGroupThreadsForParticipants = async (
  groupId: string,
  participants: Array<{ type: 'user' | 'company'; id: string }>,
) => {
  const now = new Date();
  const threadsCollection = getMessageThreadsCollection();
  await threadsCollection.bulkWrite(
    participants.map((participant) => {
      const key = buildMessageThreadKey(participant.type, participant.id, 'group', groupId);
      return {
        updateOne: {
          filter: { key },
          update: {
            $set: {
              ownerType: participant.type,
              ownerId: participant.id,
              peerType: 'group',
              peerId: groupId,
              key,
              state: 'active',
              archived: false,
              muted: false,
              blocked: false,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
};

const buildGroupOutgoingMessages = (
  actor: Actor,
  recipients: Array<{ type: 'user' | 'company'; id: string }>,
  payload: GroupMessagePayload & { groupId: string },
): IMessage[] => {
  const timestamp = new Date();
  const groupMessageId = `gmsg-${new ObjectId().toHexString()}`;

  return recipients.map((participant) => {
    const receiverType = participant.type === 'company' ? 'company' : 'user';
    const isSenderSelf = receiverType === actor.type && participant.id === actor.id;
    return {
      senderId: actor.id,
      senderOwnerType: actor.type,
      senderOwnerId: actor.id,
      receiverId: participant.id,
      receiverOwnerType: receiverType,
      receiverOwnerId: participant.id,
      text: payload.text,
      timestamp,
      isRead: isSenderSelf,
      readAt: isSenderSelf ? timestamp : null,
      messageType: payload.messageType,
      mediaUrl: payload.mediaUrl,
      mediaKey: payload.mediaKey,
      mediaMimeType: payload.mediaMimeType,
      mediaSize: payload.mediaSize,
      replyTo: payload.replyTo,
      groupId: payload.groupId,
      groupMessageId,
      isEdited: false,
    };
  });
};

const emitGroupMessages = async (rows: Array<IMessage & { id: string }>) => {
  await Promise.all(
    rows.map(async (row) => {
      emitToIdentity(row.receiverOwnerType || 'user', row.receiverOwnerId || row.receiverId, 'message:new', {
        message: row,
        threadState: 'active',
      });
    }),
  );
};

export const listGroupConversations = async (actor: Actor) => {
  const actorKey = actorMarker(actor.type, actor.id);
  const groupsCollection = getMessageGroupsCollection();
  const messagesCollection = getMessagesCollection();
  const groups = await groupsCollection
    .find({ participantKeys: actorKey })
    .sort({ updatedAt: -1 })
    .toArray();

  if (groups.length === 0) return [];

  const groupIds = groups.map((group) => group.id);
  const messageSummary = await messagesCollection
    .aggregate([
      {
        $match: {
          groupId: { $in: groupIds },
          receiverOwnerType: actor.type,
          receiverOwnerId: actor.id,
          $or: [{ deletedFor: { $exists: false } }, { deletedFor: { $nin: [actorKey] } }],
        },
      },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$groupId',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [{ $eq: ['$isRead', false] }, 1, 0],
            },
          },
        },
      },
    ])
    .toArray();

  const summaryByGroup = new Map(messageSummary.map((item: any) => [String(item._id), item]));

  return groups.map((group) => {
    const summary = summaryByGroup.get(group.id);
    const unreadCount = typeof summary?.unreadCount === 'number' ? summary.unreadCount : 0;
    const lastMessage = summary?.lastMessage || null;
    return {
      _id: group.id,
      peerId: group.id,
      peerType: 'group',
      otherType: 'group',
      conversationKey: groupConversationKey(group.id),
      state: 'active',
      isArchived: false,
      isMuted: false,
      isBlocked: false,
      isRequest: false,
      unreadCount,
      unread: unreadCount > 0,
      lastMessage: lastMessage ? mapGroupMessageForActor(lastMessage) : null,
      otherUser: {
        id: group.id,
        type: 'group',
        name: group.name,
        handle: group.handle,
        avatar: group.avatar || '',
        avatarType: 'image',
        participantCount: Array.isArray(group.participants) ? group.participants.length : 0,
      },
    };
  });
};

export const createGroupConversation = async (
  actor: Actor,
  payload: { name?: string; avatar?: string; participants?: unknown },
) => {
  const name = normalizeGroupName(payload.name);
  const participants = await resolveGroupParticipants(actor, payload.participants);
  if (participants.length < 2) {
    throw new Error('Group needs at least 2 participants');
  }

  const groupId = `grp-${new ObjectId().toHexString()}`;
  const now = new Date();
  const group = {
    id: groupId,
    name,
    handle: buildGroupHandle(name, groupId),
    avatar: typeof payload.avatar === 'string' ? trimTo(payload.avatar, 600) : '',
    createdByType: actor.type,
    createdById: actor.id,
    participants: participants.map((participant) => ({ ...participant, joinedAt: now })),
    participantKeys: participants.map((participant) => actorMarker(participant.type, participant.id)),
    createdAt: now,
    updatedAt: now,
  };

  await getMessageGroupsCollection().insertOne(group);
  await upsertGroupThreadsForParticipants(groupId, participants);

  return {
    id: group.id,
    type: 'group',
    name: group.name,
    handle: group.handle,
    avatar: group.avatar,
    avatarType: 'image',
    participantCount: group.participants.length,
  };
};

export const fetchGroupMessages = async (
  actor: Actor,
  groupId: string,
  page: number,
  limit: number,
) => {
  const actorKey = actorMarker(actor.type, actor.id);
  const group = await getMessageGroupsCollection().findOne({ id: groupId });
  if (!group || !actorHasGroupAccess(actor, group)) {
    throw new Error('Group not found');
  }

  const messagesCollection = getMessagesCollection();
  const messages = await messagesCollection
    .find({
      groupId,
      receiverOwnerType: actor.type,
      receiverOwnerId: actor.id,
      $or: [{ deletedFor: { $exists: false } }, { deletedFor: { $nin: [actorKey] } }],
    })
    .sort({ timestamp: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  await messagesCollection.updateMany(
    {
      groupId,
      receiverOwnerType: actor.type,
      receiverOwnerId: actor.id,
      isRead: false,
    },
    { $set: { isRead: true, readAt: new Date() } },
  );

  return messages.map(mapGroupMessageForActor).reverse();
};

export const markGroupMessagesRead = async (actor: Actor, groupId: string) => {
  const group = await getMessageGroupsCollection().findOne({ id: groupId });
  if (!group || !actorHasGroupAccess(actor, group)) {
    throw new Error('Group not found');
  }

  await getMessagesCollection().updateMany(
    {
      groupId,
      receiverOwnerType: actor.type,
      receiverOwnerId: actor.id,
      isRead: false,
    },
    { $set: { isRead: true, readAt: new Date() } },
  );
};

export const sendGroupMessage = async (
  actor: Actor,
  groupId: string,
  payload: GroupMessagePayload,
) => {
  const mediaUrl = normalizeAndValidateMediaUrl(payload.mediaUrl);
  if (!groupId || (!payload.text && !mediaUrl)) {
    throw new Error('groupId and content are required');
  }

  const unsafeReason = payload.text ? unsafeLinkReason(payload.text) : null;
  if (unsafeReason) {
    throw new Error(unsafeReason);
  }

  const rate = await applyRateLimit(actor);
  if (!rate.allowed) {
    throw new Error('Too many messages sent from this identity. Please wait a moment.');
  }

  const group = await getMessageGroupsCollection().findOne({ id: groupId });
  if (!group || !actorHasGroupAccess(actor, group)) {
    throw new Error('Group not found');
  }

  const recipients: Array<{ type: 'user' | 'company'; id: string }> = Array.isArray(group.participants)
    ? group.participants.map((participant) => ({
        type: participant.type === 'company' ? 'company' : 'user',
        id: String(participant.id),
      }))
    : [];
  const outgoing = buildGroupOutgoingMessages(actor, recipients, { ...payload, mediaUrl, groupId });
  const insert = await getMessagesCollection().insertMany(outgoing);
  const emittedRows = outgoing.map((row, index) => ({
    ...row,
    _id: insert.insertedIds[index],
    id: String(insert.insertedIds[index]),
  }));

  await upsertGroupThreadsForParticipants(groupId, recipients);

  const senderMessage =
    emittedRows.find(
      (row) => row.receiverOwnerType === actor.type && row.receiverOwnerId === actor.id,
    ) || emittedRows[0];

  await emitGroupMessages(emittedRows as Array<IMessage & { id: string }>);
  await getMessageGroupsCollection().updateOne({ id: groupId }, { $set: { updatedAt: new Date() } });
  return senderMessage;
};
