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
exports.sendGroupMessage = exports.markGroupMessagesRead = exports.fetchGroupMessages = exports.createGroupConversation = exports.listGroupConversations = void 0;
const mongodb_1 = require("mongodb");
const db_1 = require("../db");
const socketHub_1 = require("../realtime/socketHub");
const Message_1 = require("../models/Message");
const MessageGroup_1 = require("../models/MessageGroup");
const MessageThread_1 = require("../models/MessageThread");
const GROUP_HANDLE_PREFIX = '@group';
const MAX_GROUP_PARTICIPANTS = 24;
const SEND_WINDOW_MS = 60000;
const SEND_WINDOW_LIMIT = 45;
const actorMarker = (type, id) => `${type}:${id}`;
const groupConversationKey = (groupId) => `group:${groupId}`;
const trimTo = (value, max) => value.trim().slice(0, max);
const normalizeGroupName = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return trimTo(text || 'Group Chat', 80);
};
const buildGroupHandle = (name, id) => {
    const compact = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 28);
    const suffix = id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-6);
    return `${GROUP_HANDLE_PREFIX}-${compact || 'chat'}-${suffix}`;
};
const actorHasGroupAccess = (actor, group) => Array.isArray(group.participantKeys) &&
    group.participantKeys.includes(actorMarker(actor.type, actor.id));
const mapGroupMessageForActor = (message) => (Object.assign(Object.assign({}, message), { id: message.id || (message._id ? String(message._id) : undefined) }));
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
const normalizeAndValidateMediaUrl = (rawUrl) => {
    if (typeof rawUrl !== 'string')
        return undefined;
    const value = rawUrl.trim();
    if (!value)
        return undefined;
    if (/^(javascript:|vbscript:|data:text\/html|file:)/i.test(value)) {
        throw new Error('Unsafe media URL detected');
    }
    if (value.startsWith('/uploads/')) {
        return value.slice(0, 1200);
    }
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch (_a) {
        throw new Error('Invalid media URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Unsupported media URL protocol');
    }
    return parsed.toString().slice(0, 1200);
};
const applyRateLimit = (actor) => __awaiter(void 0, void 0, void 0, function* () {
    const key = actorMarker(actor.type, actor.id);
    const now = new Date();
    const nowMs = now.getTime();
    const collection = (0, db_1.getDB)().collection('message_rate_limits');
    const current = yield collection.findOne({ key });
    const startedAtMs = (current === null || current === void 0 ? void 0 : current.startedAt) instanceof Date
        ? current.startedAt.getTime()
        : (current === null || current === void 0 ? void 0 : current.startedAt)
            ? new Date(current.startedAt).getTime()
            : 0;
    const expired = !startedAtMs || nowMs - startedAtMs > SEND_WINDOW_MS;
    if (!current || expired) {
        yield collection.updateOne({ key }, {
            $set: { key, count: 1, startedAt: now, updatedAt: now },
        }, { upsert: true });
        return { allowed: true, remaining: SEND_WINDOW_LIMIT - 1 };
    }
    const currentCount = typeof current.count === 'number' ? current.count : 0;
    if (currentCount >= SEND_WINDOW_LIMIT) {
        return { allowed: false, remaining: 0 };
    }
    const nextCount = currentCount + 1;
    yield collection.updateOne({ key }, {
        $set: { updatedAt: now },
        $inc: { count: 1 },
    });
    return { allowed: true, remaining: SEND_WINDOW_LIMIT - nextCount };
});
const normalizeParticipantCandidates = (rawParticipants) => (Array.isArray(rawParticipants) ? rawParticipants : [])
    .slice(0, MAX_GROUP_PARTICIPANTS)
    .map((item) => typeof item === 'string'
    ? { type: 'user', id: item }
    : typeof item === 'object' && item
        ? {
            type: item.type === 'company'
                ? 'company'
                : item.type === 'user'
                    ? 'user'
                    : null,
            id: String(item.id || ''),
        }
        : null)
    .filter((candidate) => Boolean(candidate === null || candidate === void 0 ? void 0 : candidate.id));
const resolveGroupParticipants = (actor, rawParticipants) => __awaiter(void 0, void 0, void 0, function* () {
    const normalized = normalizeParticipantCandidates(rawParticipants);
    const explicitUserIds = new Set();
    const explicitCompanyIds = new Set();
    const unknownTypeIds = new Set();
    normalized.forEach((candidate) => {
        if (candidate.type === 'user')
            explicitUserIds.add(candidate.id);
        else if (candidate.type === 'company')
            explicitCompanyIds.add(candidate.id);
        else
            unknownTypeIds.add(candidate.id);
    });
    unknownTypeIds.forEach((id) => {
        explicitUserIds.add(id);
        explicitCompanyIds.add(id);
    });
    const db = (0, db_1.getDB)();
    const [users, companies] = yield Promise.all([
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
    const userSet = new Set(users.map((entry) => String(entry.id)));
    const companySet = new Set(companies.map((entry) => String(entry.id)));
    const unique = new Map();
    unique.set(actorMarker(actor.type, actor.id), { type: actor.type, id: actor.id });
    normalized.forEach((candidate) => {
        if (candidate.type === 'user') {
            if (!userSet.has(candidate.id))
                return;
            unique.set(actorMarker('user', candidate.id), { type: 'user', id: candidate.id });
            return;
        }
        if (candidate.type === 'company') {
            if (!companySet.has(candidate.id))
                return;
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
});
const upsertGroupThreadsForParticipants = (groupId, participants) => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date();
    const threadsCollection = (0, MessageThread_1.getMessageThreadsCollection)();
    yield threadsCollection.bulkWrite(participants.map((participant) => {
        const key = (0, MessageThread_1.buildMessageThreadKey)(participant.type, participant.id, 'group', groupId);
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
    }), { ordered: false });
});
const buildGroupOutgoingMessages = (actor, recipients, payload) => {
    const timestamp = new Date();
    const groupMessageId = `gmsg-${new mongodb_1.ObjectId().toHexString()}`;
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
const emitGroupMessages = (rows) => __awaiter(void 0, void 0, void 0, function* () {
    yield Promise.all(rows.map((row) => __awaiter(void 0, void 0, void 0, function* () {
        (0, socketHub_1.emitToIdentity)(row.receiverOwnerType || 'user', row.receiverOwnerId || row.receiverId, 'message:new', {
            message: row,
            threadState: 'active',
        });
    })));
});
const listGroupConversations = (actor) => __awaiter(void 0, void 0, void 0, function* () {
    const actorKey = actorMarker(actor.type, actor.id);
    const groupsCollection = (0, MessageGroup_1.getMessageGroupsCollection)();
    const messagesCollection = (0, Message_1.getMessagesCollection)();
    const groups = yield groupsCollection
        .find({ participantKeys: actorKey })
        .sort({ updatedAt: -1 })
        .toArray();
    if (groups.length === 0)
        return [];
    const groupIds = groups.map((group) => group.id);
    const messageSummary = yield messagesCollection
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
    const summaryByGroup = new Map(messageSummary.map((item) => [String(item._id), item]));
    return groups.map((group) => {
        const summary = summaryByGroup.get(group.id);
        const unreadCount = typeof (summary === null || summary === void 0 ? void 0 : summary.unreadCount) === 'number' ? summary.unreadCount : 0;
        const lastMessage = (summary === null || summary === void 0 ? void 0 : summary.lastMessage) || null;
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
});
exports.listGroupConversations = listGroupConversations;
const createGroupConversation = (actor, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const name = normalizeGroupName(payload.name);
    const participants = yield resolveGroupParticipants(actor, payload.participants);
    if (participants.length < 2) {
        throw new Error('Group needs at least 2 participants');
    }
    const groupId = `grp-${new mongodb_1.ObjectId().toHexString()}`;
    const now = new Date();
    const group = {
        id: groupId,
        name,
        handle: buildGroupHandle(name, groupId),
        avatar: typeof payload.avatar === 'string' ? trimTo(payload.avatar, 600) : '',
        createdByType: actor.type,
        createdById: actor.id,
        participants: participants.map((participant) => (Object.assign(Object.assign({}, participant), { joinedAt: now }))),
        participantKeys: participants.map((participant) => actorMarker(participant.type, participant.id)),
        createdAt: now,
        updatedAt: now,
    };
    yield (0, MessageGroup_1.getMessageGroupsCollection)().insertOne(group);
    yield upsertGroupThreadsForParticipants(groupId, participants);
    return {
        id: group.id,
        type: 'group',
        name: group.name,
        handle: group.handle,
        avatar: group.avatar,
        avatarType: 'image',
        participantCount: group.participants.length,
    };
});
exports.createGroupConversation = createGroupConversation;
const fetchGroupMessages = (actor, groupId, page, limit) => __awaiter(void 0, void 0, void 0, function* () {
    const actorKey = actorMarker(actor.type, actor.id);
    const group = yield (0, MessageGroup_1.getMessageGroupsCollection)().findOne({ id: groupId });
    if (!group || !actorHasGroupAccess(actor, group)) {
        throw new Error('Group not found');
    }
    const messagesCollection = (0, Message_1.getMessagesCollection)();
    const messages = yield messagesCollection
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
    yield messagesCollection.updateMany({
        groupId,
        receiverOwnerType: actor.type,
        receiverOwnerId: actor.id,
        isRead: false,
    }, { $set: { isRead: true, readAt: new Date() } });
    return messages.map(mapGroupMessageForActor).reverse();
});
exports.fetchGroupMessages = fetchGroupMessages;
const markGroupMessagesRead = (actor, groupId) => __awaiter(void 0, void 0, void 0, function* () {
    const group = yield (0, MessageGroup_1.getMessageGroupsCollection)().findOne({ id: groupId });
    if (!group || !actorHasGroupAccess(actor, group)) {
        throw new Error('Group not found');
    }
    yield (0, Message_1.getMessagesCollection)().updateMany({
        groupId,
        receiverOwnerType: actor.type,
        receiverOwnerId: actor.id,
        isRead: false,
    }, { $set: { isRead: true, readAt: new Date() } });
});
exports.markGroupMessagesRead = markGroupMessagesRead;
const sendGroupMessage = (actor, groupId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const mediaUrl = normalizeAndValidateMediaUrl(payload.mediaUrl);
    if (!groupId || (!payload.text && !mediaUrl)) {
        throw new Error('groupId and content are required');
    }
    const unsafeReason = payload.text ? unsafeLinkReason(payload.text) : null;
    if (unsafeReason) {
        throw new Error(unsafeReason);
    }
    const rate = yield applyRateLimit(actor);
    if (!rate.allowed) {
        throw new Error('Too many messages sent from this identity. Please wait a moment.');
    }
    const group = yield (0, MessageGroup_1.getMessageGroupsCollection)().findOne({ id: groupId });
    if (!group || !actorHasGroupAccess(actor, group)) {
        throw new Error('Group not found');
    }
    const recipients = Array.isArray(group.participants)
        ? group.participants.map((participant) => ({
            type: participant.type === 'company' ? 'company' : 'user',
            id: String(participant.id),
        }))
        : [];
    const outgoing = buildGroupOutgoingMessages(actor, recipients, Object.assign(Object.assign({}, payload), { mediaUrl, groupId }));
    const insert = yield (0, Message_1.getMessagesCollection)().insertMany(outgoing);
    const emittedRows = outgoing.map((row, index) => (Object.assign(Object.assign({}, row), { _id: insert.insertedIds[index], id: String(insert.insertedIds[index]) })));
    yield upsertGroupThreadsForParticipants(groupId, recipients);
    const senderMessage = emittedRows.find((row) => row.receiverOwnerType === actor.type && row.receiverOwnerId === actor.id) || emittedRows[0];
    yield emitGroupMessages(emittedRows);
    yield (0, MessageGroup_1.getMessageGroupsCollection)().updateOne({ id: groupId }, { $set: { updatedAt: new Date() } });
    return senderMessage;
});
exports.sendGroupMessage = sendGroupMessage;
