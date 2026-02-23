import { Request, Response } from 'express';
import { isDBConnected } from '../db';
import { resolveIdentityActor } from '../utils/identityUtils';
import {
  createGroupConversation,
  fetchGroupMessages,
  listGroupConversations,
  markGroupMessagesRead,
  sendGroupMessage,
} from '../services/messageGroupService';

const parseActor = async (req: Request, ownerTypeRaw: unknown, ownerIdRaw: unknown) => {
  const authenticatedUserId = (req.user as any)?.id;
  if (!authenticatedUserId) return null;
  return resolveIdentityActor(
    authenticatedUserId,
    {
      ownerType: ownerTypeRaw as string,
      ownerId: ownerIdRaw as string,
    },
    req.headers,
  );
};

type Actor = { type: 'user' | 'company'; id: string };
type ActorTask = (actor: Actor) => Promise<Response>;

const runWithActor = async (
  req: Request,
  res: Response,
  ownerTypeRaw: unknown,
  ownerIdRaw: unknown,
  task: ActorTask,
) => {
  const actor = await parseActor(req, ownerTypeRaw, ownerIdRaw);
  if (!actor) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  if (!isDBConnected()) {
    return res.status(503).json({ success: false, message: 'Service unavailable' });
  }

  return task(actor);
};

const mapGroupServiceError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  if (message === 'Group not found') return { status: 404, message };
  if (
    message === 'groupId and content are required' ||
    message === 'Group needs at least 2 participants' ||
    message === 'Unsafe link protocol detected' ||
    message === 'Potentially unsafe markup detected' ||
    message === 'Unsafe media URL detected' ||
    message === 'Invalid media URL' ||
    message === 'Unsupported media URL protocol'
  ) {
    return { status: 400, message };
  }
  if (message.startsWith('Too many messages')) {
    return { status: 429, message };
  }
  return { status: 500, message: 'Failed to process group messaging request' };
};

export const messageGroupsController = {
  // GET /api/messages/groups - List groups visible to the active identity
  getGroupConversations: async (req: Request, res: Response) =>
    runWithActor(req, res, req.query.ownerType, req.query.userId, async (actor) => {
      try {
        const rows = await listGroupConversations(actor);
        return res.json({ success: true, data: rows });
      } catch (error) {
        console.error('Error fetching group conversations:', error);
        const mapped = mapGroupServiceError(error);
        return res.status(mapped.status).json({ success: false, message: mapped.message });
      }
    }),

  // POST /api/messages/groups - Create a messaging group
  createGroupConversation: async (req: Request, res: Response) =>
    runWithActor(req, res, req.body.ownerType, req.body.senderId, async (actor) => {
      try {
        const created = await createGroupConversation(actor, {
          name: req.body.name,
          avatar: req.body.avatar,
          participants: req.body.participants,
        });
        return res.status(201).json({ success: true, data: created });
      } catch (error) {
        console.error('Error creating group conversation:', error);
        const mapped = mapGroupServiceError(error);
        return res.status(mapped.status).json({ success: false, message: mapped.message });
      }
    }),

  // GET /api/messages/groups/:groupId/messages - Get messages for a group conversation
  getGroupMessages: async (req: Request, res: Response) =>
    runWithActor(req, res, req.query.ownerType, req.query.currentUserId, async (actor) => {
      const groupId = String(req.params.groupId || '').trim();
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));

      try {
        const data = await fetchGroupMessages(actor, groupId, page, limit);
        return res.json({ success: true, data });
      } catch (error) {
        console.error('Error fetching group messages:', error);
        const mapped = mapGroupServiceError(error);
        return res.status(mapped.status).json({ success: false, message: mapped.message });
      }
    }),

  // PUT /api/messages/groups/:groupId/read - Mark group messages as read for actor
  markGroupMessagesRead: async (req: Request, res: Response) =>
    runWithActor(req, res, req.body.ownerType, req.body.userId, async (actor) => {
      const groupId = String(req.params.groupId || '').trim();
      try {
        await markGroupMessagesRead(actor, groupId);
        return res.json({ success: true, message: 'Group messages marked as read' });
      } catch (error) {
        console.error('Error marking group messages as read:', error);
        const mapped = mapGroupServiceError(error);
        return res.status(mapped.status).json({ success: false, message: mapped.message });
      }
    }),

  // POST /api/messages/groups/:groupId/messages - Send a group message
  sendGroupMessage: async (req: Request, res: Response) =>
    runWithActor(req, res, req.body.ownerType, req.body.senderId, async (actor) => {
      const groupId = String(req.params.groupId || '').trim();
      try {
        const message = await sendGroupMessage(actor, groupId, {
          text: String(req.body.text || ''),
          messageType: (req.body.messageType || 'text') as any,
          mediaUrl: typeof req.body.mediaUrl === 'string' ? req.body.mediaUrl : undefined,
          mediaKey: typeof req.body.mediaKey === 'string' ? req.body.mediaKey : undefined,
          mediaMimeType: typeof req.body.mediaMimeType === 'string' ? req.body.mediaMimeType : undefined,
          mediaSize: typeof req.body.mediaSize === 'number' ? req.body.mediaSize : undefined,
          replyTo: typeof req.body.replyTo === 'string' ? req.body.replyTo : undefined,
        });
        return res.status(201).json({ success: true, data: message, threadState: 'active' });
      } catch (error) {
        console.error('Error sending group message:', error);
        const mapped = mapGroupServiceError(error);
        return res.status(mapped.status).json({ success: false, message: mapped.message });
      }
    }),
};
