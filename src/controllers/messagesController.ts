import { Request, Response } from 'express';
import { getMessagesCollection, IMessage } from '../models/Message';
import { ObjectId } from 'mongodb';
import { getDB, isDBConnected } from '../db';
import { transformUser } from '../utils/userUtils';
import { resolveIdentityActor, validateIdentityAccess } from '../utils/identityUtils';

export const messagesController = {
  // GET /api/messages/conversations - Get all conversations for an actor (personal or company)
  getConversations: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType: req.query.ownerType as string,
        ownerId: req.query.userId as string
      }, req.headers);

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
      }

      const actorId = actor.id;
      const ownerType = actor.type;

      if (!isDBConnected()) {
        return res.json({ success: true, data: [] });
      }

      const messagesCollection = getMessagesCollection();
      const db = getDB();

      // Get latest message for each conversation where actor is sender or receiver
      const conversations = await messagesCollection.aggregate([
        {
          $match: {
            $or: [
              { senderId: actorId },
              { receiverId: actorId }
            ]
          }
        },
        {
          $addFields: {
            conversationWith: {
              $cond: {
                if: { $eq: ['$senderId', actorId] },
                then: '$receiverId',
                else: '$senderId'
              }
            }
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $group: {
            _id: '$conversationWith',
            lastMessage: { $first: '$$ROOT' },
            unreadCount: {
              $sum: {
                $cond: {
                  if: {
                    $and: [
                      { $eq: ['$receiverId', actorId] },
                      { $eq: ['$isRead', false] }
                    ]
                  },
                  then: 1,
                  else: 0
                }
              }
            }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: 'id',
            as: 'otherUser'
          }
        },
        {
          $lookup: {
            from: 'companies',
            localField: '_id',
            foreignField: 'id',
            as: 'otherCompany'
          }
        },
        {
          $addFields: {
            otherEntity: {
              $cond: {
                if: { $gt: [{ $size: '$otherUser' }, 0] },
                then: { $arrayElemAt: ['$otherUser', 0] },
                else: { $arrayElemAt: ['$otherCompany', 0] }
              }
            }
          }
        },
        {
          $unwind: {
            path: '$otherEntity',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $sort: { 'lastMessage.timestamp': -1 }
        }
      ]).toArray();

      const collectionName = ownerType === 'company' ? 'companies' : 'users';
      const doc = await db.collection(collectionName).findOne({ id: actorId });
      const archivedChats: string[] = (doc?.archivedChats as string[]) || [];

      const conversationsWithArchive = conversations.map(conv => {
        const otherUser = conv.otherEntity ? transformUser(conv.otherEntity) : null;
        return {
          ...conv,
          otherUser,
          isArchived: archivedChats.includes(conv._id as string),
        };
      });

      res.json({
        success: true,
        data: conversationsWithArchive
      });
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch conversations'
      });
    }
  },

  // GET /api/messages/:otherId - Get messages between actor and another entity
  getMessages: async (req: Request, res: Response) => {
    try {
      const { userId: otherId } = req.params; // The other person/company
      const authenticatedUserId = (req.user as any)?.id;
      const { page = 1, limit = 50, ownerType, currentUserId } = req.query;

      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType: ownerType as string,
        ownerId: currentUserId as string
      }, req.headers);

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to this identity' });
      }

      const actorId = actor.id;

      if (!isDBConnected()) {
        return res.json({ success: true, data: [] });
      }

      const messagesCollection = getMessagesCollection();

      const messages = await messagesCollection.find({
        $and: [
          {
            $or: [
              { senderId: actorId, receiverId: otherId },
              { senderId: otherId, receiverId: actorId }
            ]
          },
          { deletedFor: { $ne: actorId } }
        ]
      })
        .sort({ timestamp: -1 })
        .limit(Number(limit))
        .skip((Number(page) - 1) * Number(limit))
        .toArray();

      const mappedMessages = messages.map((message: any) => ({
        ...message,
        id: message.id || (message._id ? String(message._id) : undefined),
      }));

      // Mark messages as read (only those sent by the other entity to the actor)
      await messagesCollection.updateMany(
        {
          senderId: otherId,
          receiverId: actorId,
          isRead: false
        },
        { $set: { isRead: true } }
      );

      res.json({
        success: true,
        data: mappedMessages.reverse()
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch messages'
      });
    }
  },

  // POST /api/messages - Send a new message
  sendMessage: async (req: Request, res: Response) => {
    try {
      const {
        senderId: requestedSenderId, // Actor ID from client
        ownerType,
        receiverId,
        text,
        messageType = 'text',
        mediaUrl,
        mediaKey,
        mediaMimeType,
        mediaSize,
        replyTo
      } = req.body;

      const authenticatedUserId = (req.user as any)?.id;

      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedSenderId
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized to send as this identity' });
      }

      const senderId = actor.id;

      if (!receiverId || !text) {
        return res.status(400).json({
          success: false,
          message: 'Receiver ID and text are required'
        });
      }

      if (!isDBConnected()) {
        return res.status(503).json({
          success: false,
          message: 'Messaging service is temporarily unavailable'
        });
      }

      const messagesCollection = getMessagesCollection();
      const db = getDB();

      const message: IMessage = {
        senderId,
        receiverId,
        text,
        timestamp: new Date(),
        isRead: false,
        messageType,
        mediaUrl,
        mediaKey,
        mediaMimeType,
        mediaSize,
        replyTo,
        isEdited: false
      };

      const result = await messagesCollection.insertOne(message);
      const insertedMessage = await messagesCollection.findOne({ _id: result.insertedId });

      const responseMessage = insertedMessage
        ? {
          ...insertedMessage,
          id: (insertedMessage as any)._id ? String((insertedMessage as any)._id) : undefined,
        }
        : null;

      // Auto-unarchive for receiver
      const unarchiveUpdate: any = { 
        $pull: { archivedChats: senderId }, 
        $set: { updatedAt: new Date().toISOString() } 
      };
      await Promise.all([
        db.collection('users').updateOne({ id: receiverId }, unarchiveUpdate),
        db.collection('companies').updateOne({ id: receiverId }, unarchiveUpdate)
      ]);

      res.status(201).json({
        success: true,
        data: responseMessage
      });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send message'
      });
    }
  },

  // PUT /api/messages/:messageId - Edit a message
  editMessage: async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;
      const { text, userId: requestedActorId } = req.body;
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

      // Authorization: Must be the sender and have access to that identity
      const actorId = message.senderId;
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
            editedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error editing message:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to edit message'
      });
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

      // Authorization: Must be the sender and have access to that identity
      const actorId = message.senderId;
      const hasAccess = await validateIdentityAccess(authenticatedUserId, actorId);
      
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Unauthorized to delete this message' });
      }

      await messagesCollection.deleteOne({ _id: new ObjectId(messageId) });

      res.json({
        success: true,
        message: 'Message deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete message'
      });
    }
  },

  // DELETE /api/messages/conversation - Delete all messages in a conversation
  deleteConversation: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      const { userId: requestedActorId, ownerType, otherUserId } = req.body;

      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedActorId
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const actorId = actor.id;

      if (!otherUserId) {
        return res.status(400).json({ success: false, message: 'Other party is required' });
      }

      if (!isDBConnected()) {
        return res.status(503).json({ success: false, message: 'Service unavailable' });
      }

      const messagesCollection = getMessagesCollection();

      // IMPORTANT: In a "delete conversation" for one side, we usually just clear it for THEM
      // but the current schema seems to delete the messages globally for both. 
      // Following existing logic but with auth.
      await messagesCollection.updateMany(
        {
          $or: [
            { senderId: actorId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: actorId }
          ]
        },
        { $addToSet: { deletedFor: actorId } }
      );

      res.json({
        success: true,
        message: 'Conversation deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete conversation'
      });
    }
  },

  markAsRead: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      
      // Actor is the receiver of the messages being marked as read
      const requestedActorId = req.body.receiverId || req.body.currentUserId || req.body.userId || (req.query.receiverId as string) || (req.query.currentUserId as string) || (req.query.userId as string);
      const ownerType = req.body.ownerType || (req.query.ownerType as string);

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedActorId
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const actorId = actor.id;
      
      // Other party is the sender of the messages
      const otherId = req.body.senderId || req.body.otherUserId || (req.query.senderId as string) || (req.query.otherUserId as string);

      if (!otherId) {
        return res.json({ success: true, message: 'Missing sender parameters' });
      }

      if (!isDBConnected()) {
        return res.status(503).json({ success: false, message: 'Service unavailable' });
      }

      const messagesCollection = getMessagesCollection();

      await messagesCollection.updateMany(
        {
          senderId: otherId,
          receiverId: actorId,
          isRead: false
        },
        { $set: { isRead: true } }
      );

      res.json({
        success: true,
        message: 'Messages marked as read'
      });
    } catch (error) {
      console.error('Error marking messages as read:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark messages as read'
      });
    }
  },

  archiveConversation: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req.user as any)?.id;
      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { userId: requestedActorId, ownerType, otherUserId, archived } = req.body;

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(authenticatedUserId, {
        ownerType,
        ownerId: requestedActorId
      });

      if (!actor) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const actorId = actor.id;

      if (!otherUserId || typeof archived !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Invalid parameters' });
      }

      const db = getDB();
      const update = archived
        ? { $addToSet: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } }
        : { $pull: { archivedChats: otherUserId }, $set: { updatedAt: new Date().toISOString() } };

      // Update in both collections to be safe
      await Promise.all([
        db.collection('users').updateOne({ id: actorId }, update),
        db.collection('companies').updateOne({ id: actorId }, update)
      ]);

      res.json({
        success: true,
        message: archived ? 'Conversation archived successfully' : 'Conversation unarchived successfully'
      });
    } catch (error) {
      console.error('Error archiving conversation:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update archive state'
      });
    }
  }
};
