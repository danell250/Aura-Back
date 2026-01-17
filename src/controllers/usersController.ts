import { Request, Response } from 'express';
import axios from 'axios';
import { getDB } from '../db';
import { calculateUserTrust, recalculateAllTrustScores, getSerendipityMatchesForUser } from '../services/trustService';
import { logSecurityEvent } from '../utils/securityLogger';

const generateUniqueHandle = async (firstName: string, lastName: string): Promise<string> => {
  const db = getDB();

  const firstNameSafe = (firstName || 'user').toLowerCase().trim().replace(/\s+/g, '');
  const lastNameSafe = (lastName || '').toLowerCase().trim().replace(/\s+/g, '');

  const baseHandle = `@${firstNameSafe}${lastNameSafe}`;

  try {
    let existingUser = await db.collection('users').findOne({ handle: baseHandle });
    if (!existingUser) {
      console.log('✓ Handle available:', baseHandle);
      return baseHandle;
    }
  } catch (error) {
    console.error('Error checking base handle:', error);
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const randomNum = Math.floor(Math.random() * 100000);
    const candidateHandle = `${baseHandle}${randomNum}`;

    try {
      const existingUser = await db.collection('users').findOne({ handle: candidateHandle });
      if (!existingUser) {
        console.log('✓ Handle available:', candidateHandle);
        return candidateHandle;
      }
    } catch (error) {
      console.error(`Error checking handle ${candidateHandle}:`, error);
      continue;
    }
  }

  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 9);
  const fallbackHandle = `@user${timestamp}${randomStr}`;
  console.log('⚠ Using fallback handle:', fallbackHandle);
  return fallbackHandle;
};

const CREDIT_BUNDLE_CONFIG: Record<string, { credits: number; price: number }> = {
  'Nano Pulse': { credits: 100, price: 9.99 },
  'Neural Spark': { credits: 500, price: 39.99 },
  'Neural Surge': { credits: 2000, price: 149.99 },
  'Universal Core': { credits: 5000, price: 349.99 }
};

export const usersController = {
  // GET /api/users - Get all users (respects showInSearch privacy setting)
  getAllUsers: async (req: Request, res: Response) => {
    try {
      const db = getDB();
      // Filter out users who have explicitly set showInSearch to false
      // Users without the setting (undefined) default to true (visible)
      const query = {
        $or: [
          { 'privacySettings.showInSearch': { $ne: false } },
          { 'privacySettings.showInSearch': { $exists: false } }
        ]
      };
      
      const users = await db.collection('users').find(query).toArray();
      
      res.json({
        success: true,
        data: users,
        count: users.length
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch users',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/cancel-connection - Cancel a sent connection request
  cancelConnectionRequest: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { targetUserId } = req.body;

      const db = getDB();

      const requester = await db.collection('users').findOne({ id });
      if (!requester) {
        return res.status(404).json({
          success: false,
          error: 'Requester not found',
          message: `User with ID ${id} does not exist`
        });
      }

      const targetUser = await db.collection('users').findOne({ id: targetUserId });
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'Target user not found',
          message: `User with ID ${targetUserId} does not exist`
        });
      }

      const updatedSentRequests = (requester.sentAcquaintanceRequests || []).filter((rid: string) => rid !== targetUserId);

      await db.collection('users').updateOne(
        { id },
        {
          $set: {
            sentAcquaintanceRequests: updatedSentRequests,
            updatedAt: new Date().toISOString()
          }
        }
      );

      const updatedNotifications = (targetUser.notifications || []).filter(
        (n: any) => !(n.type === 'acquaintance_request' && n.fromUser.id === id)
      );

      await db.collection('users').updateOne(
        { id: targetUserId },
        {
          $set: {
            notifications: updatedNotifications,
            updatedAt: new Date().toISOString()
          }
        }
      );

      res.json({
        success: true,
        data: {
          requesterId: id,
          targetUserId,
          timestamp: new Date().toISOString()
        },
        message: 'Connection request cancelled successfully'
      });
    } catch (error) {
      console.error('Error cancelling connection request:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel connection request',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/users/:id - Get user by ID
  getUserById: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const user = await db.collection('users').findOne({ id });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }
      
      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users - Create new user
  createUser: async (req: Request, res: Response) => {
    try {
      const userData = req.body;

      if (!userData.firstName || !userData.lastName || !userData.email) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'firstName, lastName, and email are required'
        });
      }

      const db = getDB();

      const existingUser = await db.collection('users').findOne({
        $or: [
          { email: userData.email },
          { handle: userData.handle }
        ]
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'User already exists',
          message: 'A user with this email or handle already exists'
        });
      }

      const uniqueHandle = await generateUniqueHandle(userData.firstName, userData.lastName);

      const userId = userData.id || `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newUser = {
        id: userId,
        firstName: userData.firstName,
        lastName: userData.lastName,
        name: userData.name || `${userData.firstName} ${userData.lastName}`,
        handle: uniqueHandle,
        avatar: userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
        avatarType: userData.avatarType || 'image',
        email: userData.email,
        bio: userData.bio || '',
        dob: userData.dob || '',
        phone: userData.phone || '',
        country: userData.country || '',
        industry: userData.industry || '',
        companyName: userData.companyName || '',
        acquaintances: userData.acquaintances || [],
        blockedUsers: userData.blockedUsers || [],
        trustScore: userData.trustScore || 10,
        auraCredits: userData.auraCredits || 100,
        activeGlow: userData.activeGlow || 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await db.collection('users').insertOne(newUser);

      if (!result.acknowledged) {
        throw new Error('Failed to insert user into database');
      }

      console.log('✓ User created:', userId, '| Handle:', uniqueHandle);

      res.status(201).json({
        success: true,
        data: newUser,
        message: 'User created successfully'
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create user',
        message: 'Internal server error'
      });
    }
  },

  // PUT /api/users/:id - Update user
  updateUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const db = getDB();
      
      // Prevent immutable fields like handle from being changed
      const { handle, googleId, id: _ignoredId, ...mutableUpdates } = updates || {};
      const updateData = {
        ...mutableUpdates,
        updatedAt: new Date().toISOString()
      };

      const result = await db.collection('users').updateOne(
        { id },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // Get updated user
      const updatedUser = await db.collection('users').findOne({ id });

      res.json({
        success: true,
        data: updatedUser,
        message: 'User updated successfully'
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update user',
        message: 'Internal server error'
      });
    }
  },

  // DELETE /api/users/:id - Delete user
  deleteUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      
      const result = await db.collection('users').deleteOne({ id });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete user',
        message: 'Internal server error'
      });
    }
  },

 

  // POST /api/users/:id/remove-acquaintance - Remove an acquaintance
  removeAcquaintance: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { targetUserId } = req.body;

      const db = getDB();

      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      const acquaintances: string[] = user.acquaintances || [];
      const updatedAcquaintances = acquaintances.filter(aid => aid !== targetUserId);

      await db.collection('users').updateOne(
        { id },
        {
          $set: {
            acquaintances: updatedAcquaintances,
            updatedAt: new Date().toISOString()
          }
        }
      );

      res.json({
        success: true,
        message: 'Acquaintance removed successfully'
      });
    } catch (error) {
      console.error('Error removing acquaintance:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove acquaintance',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/accept-connection - Accept connection request
  acceptConnectionRequest: async (req: Request, res: Response) => {
    try {
      const { id } = req.params; // The ID of the user accepting the request (acceptor)
      const { requesterId } = req.body; // The ID of the user who sent the request

      const db = getDB();

      // Find both users
      const acceptor = await db.collection('users').findOne({ id });
      if (!acceptor) {
        return res.status(404).json({
          success: false,
          error: 'Acceptor not found',
          message: `User with ID ${id} does not exist`
        });
      }

      const requester = await db.collection('users').findOne({ id: requesterId });
      if (!requester) {
        return res.status(404).json({
          success: false,
          error: 'Requester not found',
          message: `User with ID ${requesterId} does not exist`
        });
      }

      // Check if they are already connected
      const acceptorAcquaintances = acceptor.acquaintances || [];
      if (acceptorAcquaintances.includes(requesterId)) {
        return res.status(400).json({
          success: false,
          error: 'Already connected',
          message: 'Users are already connected'
        });
      }

      // Update acceptor (add acquaintance, update notifications)
      const updatedAcceptorAcquaintances = [...acceptorAcquaintances, requesterId];
      // Mark the specific request notification as read
      const updatedNotifications = (acceptor.notifications || []).map((n: any) => {
        if (n.type === 'acquaintance_request' && n.fromUser.id === requesterId) {
          return { ...n, isRead: true };
        }
        return n;
      });

      await db.collection('users').updateOne(
        { id },
        { 
          $set: { 
            acquaintances: updatedAcceptorAcquaintances,
            notifications: updatedNotifications,
            updatedAt: new Date().toISOString()
          }
        }
      );

      // Update requester (add acquaintance, remove sent request, add acceptance notification)
      const requesterSentRequests = (requester.sentAcquaintanceRequests || []).filter((rid: string) => rid !== id);
      const requesterAcquaintances = [...(requester.acquaintances || []), id];
      
      const acceptanceNotification = {
        id: `notif-accept-${Date.now()}-${Math.random()}`,
        type: 'acquaintance_accepted', // Using a generic type or reuse 'acquaintance_request' with different message
        fromUser: {
          id: acceptor.id,
          name: acceptor.name,
          handle: acceptor.handle,
          avatar: acceptor.avatar,
          avatarType: acceptor.avatarType
        },
        message: 'accepted your connection request',
        timestamp: Date.now(),
        isRead: false,
        connectionId: id
      };

      await db.collection('users').updateOne(
        { id: requesterId },
        { 
          $set: { 
            acquaintances: requesterAcquaintances,
            sentAcquaintanceRequests: requesterSentRequests,
            updatedAt: new Date().toISOString()
          },
          $push: {
            notifications: {
              $each: [acceptanceNotification],
              $position: 0
            }
          } as any
        }
      );

      res.json({
        success: true,
        data: {
          acceptorId: id,
          requesterId: requesterId,
          timestamp: new Date().toISOString()
        },
        message: 'Connection request accepted successfully'
      });

    } catch (error) {
      console.error('Error accepting connection request:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to accept connection request',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/block - Block user
  blockUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { targetUserId } = req.body;
      const db = getDB();

      if (!targetUserId || typeof targetUserId !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Missing targetUserId',
          message: 'targetUserId is required'
        });
      }

      const blocker = await db.collection('users').findOne({ id });
      const target = await db.collection('users').findOne({ id: targetUserId });
      if (!blocker || !target) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: 'Blocker or target user not found'
        });
      }

      const nextBlocked = Array.from(new Set([...(blocker.blockedUsers || []), targetUserId]));
      const nextBlockedBy = Array.from(new Set([...(target.blockedBy || []), id]));

      const nextBlockerAcq = (blocker.acquaintances || []).filter((uid: string) => uid !== targetUserId);
      const nextTargetAcq = (target.acquaintances || []).filter((uid: string) => uid !== id);

      const nextBlockerRequests = (blocker.sentAcquaintanceRequests || []).filter((uid: string) => uid !== targetUserId);
      const nextTargetRequests = (target.sentAcquaintanceRequests || []).filter((uid: string) => uid !== id);

      await db.collection('users').updateOne(
        { id },
        {
          $set: {
            blockedUsers: nextBlocked,
            acquaintances: nextBlockerAcq,
            sentAcquaintanceRequests: nextBlockerRequests,
            updatedAt: new Date().toISOString()
          }
        }
      );

      await db.collection('users').updateOne(
        { id: targetUserId },
        {
          $set: {
            blockedBy: nextBlockedBy,
            acquaintances: nextTargetAcq,
            sentAcquaintanceRequests: nextTargetRequests,
            updatedAt: new Date().toISOString()
          }
        }
      );

      res.json({
        success: true,
        data: {
          blockerId: id,
          targetUserId,
          blockedUsers: nextBlocked,
          blockedBy: nextBlockedBy
        },
        message: 'User blocked successfully'
      });
    } catch (error) {
      console.error('Error blocking user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to block user',
        message: 'Internal server error'
      });
    }
  },

  unblockUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { targetUserId } = req.body;
      const db = getDB();

      if (!targetUserId || typeof targetUserId !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Missing targetUserId',
          message: 'targetUserId is required'
        });
      }

      const blocker = await db.collection('users').findOne({ id });
      const target = await db.collection('users').findOne({ id: targetUserId });
      if (!blocker || !target) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: 'Blocker or target user not found'
        });
      }

      const nextBlocked = (blocker.blockedUsers || []).filter((uid: string) => uid !== targetUserId);
      const nextBlockedBy = (target.blockedBy || []).filter((uid: string) => uid !== id);

      await db.collection('users').updateOne(
        { id },
        {
          $set: {
            blockedUsers: nextBlocked,
            updatedAt: new Date().toISOString()
          }
        }
      );

      await db.collection('users').updateOne(
        { id: targetUserId },
        {
          $set: {
            blockedBy: nextBlockedBy,
            updatedAt: new Date().toISOString()
          }
        }
      );

      res.json({
        success: true,
        data: {
          blockerId: id,
          targetUserId,
          blockedUsers: nextBlocked,
          blockedBy: nextBlockedBy
        },
        message: 'User unblocked successfully'
      });
    } catch (error) {
      console.error('Error unblocking user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to unblock user',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/report - Report user
  reportUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { targetUserId, reason, notes } = req.body;
      const db = getDB();

      if (!targetUserId || !reason) {
        return res.status(400).json({
          success: false,
          error: 'Missing fields',
          message: 'targetUserId and reason are required'
        });
      }

      const reporter = await db.collection('users').findOne({ id });
      const target = await db.collection('users').findOne({ id: targetUserId });
      if (!reporter || !target) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: 'Reporter or target user not found'
        });
      }

      const reportDoc = {
        id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        reporterId: id,
        targetUserId,
        reason,
        notes: notes || '',
        createdAt: new Date().toISOString(),
        status: 'open'
      };

      await db.collection('reports').insertOne(reportDoc);

      const toEmail = 'danelloosthuizen3@gmail.com';
      const subject = `Aura User Report: ${target.name || target.handle || targetUserId}`;
      const body = [
        `Reporter: ${reporter.name || reporter.handle || reporter.id} (${reporter.id})`,
        `Target: ${target.name || target.handle || targetUserId} (${targetUserId})`,
        `Reason: ${reason}`,
        `Notes: ${notes || ''}`,
        `Created At: ${reportDoc.createdAt}`,
        `Report ID: ${reportDoc.id}`
      ].join('\n');

      await db.collection('email_outbox').insertOne({
        to: toEmail,
        subject,
        body,
        createdAt: new Date().toISOString(),
        status: 'pending'
      });

      res.json({
        success: true,
        data: reportDoc,
        message: 'User reported successfully'
      });
    } catch (error) {
      console.error('Error reporting user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to report user',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/users/search - Search users
  searchUsers: async (req: Request, res: Response) => {
    try {
      const { q } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Missing search query',
          message: 'Query parameter "q" is required'
        });
      }

      const db = getDB();
      const searchTerm = q.toLowerCase().trim();
      
      // Create a case-insensitive regex search
      const searchRegex = new RegExp(searchTerm, 'i');
      
      const searchResults = await db.collection('users').find({
        $and: [
          // Privacy filter: only show users who allow being found in search
          {
            $or: [
              { 'privacySettings.showInSearch': { $ne: false } },
              { 'privacySettings.showInSearch': { $exists: false } }
            ]
          },
          // Text search filter
          {
            $or: [
              { name: searchRegex },
              { firstName: searchRegex },
              { lastName: searchRegex },
              { handle: searchRegex },
              { email: searchRegex },
              { bio: searchRegex }
            ]
          }
        ]
      })
      .project({
        id: 1,
        name: 1,
        handle: 1,
        avatar: 1,
        avatarType: 1,
        bio: 1,
        firstName: 1,
        lastName: 1,
        industry: 1,
        companyName: 1
      })
      .limit(20) // Limit results to improve performance
      .toArray();

      res.json({
        success: true,
        data: searchResults,
        count: searchResults.length,
        query: q
      });
    } catch (error) {
      console.error('Error searching users:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search users',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/purchase-credits - Purchase credits
  purchaseCredits: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { credits, bundleName, transactionId, paymentMethod, orderId } = req.body;

      // Validate required fields
      if (!bundleName) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'bundleName is required'
        });
      }

      const db = getDB();

      const bundleConfig = CREDIT_BUNDLE_CONFIG[bundleName];

      if (!bundleConfig) {
        return res.status(400).json({
          success: false,
          error: 'Invalid bundle',
          message: `Unknown credit bundle: ${bundleName}`
        });
      }

      const creditsToAdd = bundleConfig.credits;

      if (paymentMethod === 'paypal') {
        if (!orderId) {
          return res.status(400).json({
            success: false,
            error: 'Missing order ID',
            message: 'orderId is required for PayPal credit purchases'
          });
        }

        const isDevFallback = orderId === 'dev-fallback' && process.env.NODE_ENV !== 'production';

        if (!isDevFallback) {
          const clientId = process.env.PAYPAL_CLIENT_ID;
          const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
          const apiBase = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

          if (!clientId || !clientSecret) {
            logSecurityEvent({
              req,
              type: 'payment_failure',
              userId: id,
              metadata: {
                source: 'credit_purchase',
                reason: 'missing_paypal_credentials'
              }
            });
            return res.status(500).json({
              success: false,
              error: 'Payment configuration error',
              message: 'PayPal credentials not configured'
            });
          }

          if (transactionId) {
            const existingTx = await db.collection('transactions').findOne({
              transactionId,
              type: 'credit_purchase'
            });
            if (existingTx) {
              return res.status(409).json({
                success: false,
                error: 'Duplicate transaction',
                message: 'This payment has already been processed'
              });
            }
          }

          try {
            const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            const tokenResponse = await axios.post(
              `${apiBase}/v1/oauth2/token`,
              'grant_type=client_credentials',
              {
                headers: {
                  Authorization: `Basic ${basicAuth}`,
                  'Content-Type': 'application/x-www-form-urlencoded'
                }
              }
            );

            const accessToken = tokenResponse.data.access_token;

            const orderResponse = await axios.get(
              `${apiBase}/v2/checkout/orders/${orderId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`
                }
              }
            );

            const order = orderResponse.data;

            if (!order || order.status !== 'COMPLETED') {
              logSecurityEvent({
                req,
                type: 'payment_failure',
                userId: id,
                metadata: {
                  source: 'credit_purchase',
                  reason: 'paypal_order_not_completed',
                  orderStatus: order && order.status
                }
              });
              return res.status(400).json({
                success: false,
                error: 'Payment not completed',
                message: 'PayPal order is not completed'
              });
            }

            const purchaseUnits = order.purchase_units || [];
            const firstUnit = purchaseUnits[0];
            const amount = firstUnit && firstUnit.amount;

            if (!amount || amount.currency_code !== 'USD') {
              logSecurityEvent({
                req,
                type: 'payment_failure',
                userId: id,
                metadata: {
                  source: 'credit_purchase',
                  reason: 'invalid_paypal_currency',
                  currency: amount && amount.currency_code
                }
              });
              return res.status(400).json({
                success: false,
                error: 'Invalid payment currency',
                message: 'PayPal payment must be in USD'
              });
            }

            const paidAmount = parseFloat(amount.value);
            const expectedAmount = bundleConfig.price;

            if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) {
              logSecurityEvent({
                req,
                type: 'payment_failure',
                userId: id,
                metadata: {
                  source: 'credit_purchase',
                  reason: 'amount_mismatch',
                  paidAmount,
                  expectedAmount,
                  bundleName
                }
              });
              return res.status(400).json({
                success: false,
                error: 'Invalid payment amount',
                message: 'PayPal payment amount does not match selected bundle'
              });
            }
          } catch (error) {
            console.error('Error verifying PayPal order:', error);
            logSecurityEvent({
              req,
              type: 'payment_failure',
              userId: id,
              metadata: {
                source: 'credit_purchase',
                reason: 'paypal_verification_exception',
                errorMessage: error instanceof Error ? error.message : String(error),
                orderId
              }
            });
            return res.status(502).json({
              success: false,
              error: 'Payment verification failed',
              message: 'Unable to verify PayPal payment'
            });
          }
        }
      }
      
      // Find user
      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // Update user credits
      const currentCredits = user.auraCredits || 0;
      const newCredits = currentCredits + creditsToAdd;
      
      await db.collection('users').updateOne(
        { id },
        { 
          $set: { 
            auraCredits: newCredits,
            updatedAt: new Date().toISOString()
          }
        }
      );

      // Log the transaction
      const finalTransactionId = transactionId || orderId || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      await db.collection('transactions').insertOne({
        userId: id,
        type: 'credit_purchase',
        amount: creditsToAdd,
        bundleName,
        transactionId: finalTransactionId,
        paymentMethod,
        status: 'completed',
        createdAt: new Date().toISOString()
      });

      console.log('Credit purchase processed and logged:', {
        userId: id,
        bundleName,
        credits: creditsToAdd,
        previousCredits: currentCredits,
        newCredits,
        transactionId: finalTransactionId,
        paymentMethod,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        data: {
          userId: id,
          creditsAdded: creditsToAdd,
          previousCredits: currentCredits,
          newCredits,
          bundleName,
          transactionId: finalTransactionId
        },
        message: `Successfully added ${creditsToAdd} credits to user account`
      });
    } catch (error) {
      console.error('Error processing credit purchase:', error);
      logSecurityEvent({
        req,
        type: 'payment_failure',
        userId: req.params && req.params.id,
        metadata: {
          source: 'credit_purchase',
          reason: 'purchase_exception',
          bundleName: req.body && req.body.bundleName,
          credits: req.body && req.body.credits,
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
      res.status(500).json({
        success: false,
        error: 'Failed to process credit purchase',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/spend-credits - Spend/deduct credits
  spendCredits: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { credits, reason } = req.body;

      // Validate required fields
      if (!credits || credits <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid credits amount',
          message: 'credits must be a positive number'
        });
      }

      const db = getDB();
      
      // Find user
      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // Check if user has enough credits
      const currentCredits = user.auraCredits || 0;
      if (currentCredits < credits) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient credits',
          message: `User has ${currentCredits} credits but needs ${credits}`
        });
      }

      // Deduct credits
      const newCredits = currentCredits - credits;
      
      await db.collection('users').updateOne(
        { id },
        { 
          $set: { 
            auraCredits: newCredits,
            updatedAt: new Date().toISOString()
          }
        }
      );

      // Log the transaction (in production, save to database)
      console.log('Credit spending processed:', {
        userId: id,
        creditsSpent: credits,
        reason,
        previousCredits: currentCredits,
        newCredits,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        data: {
          userId: id,
          creditsSpent: credits,
          reason,
          previousCredits: currentCredits,
          newCredits
        },
        message: `Successfully deducted ${credits} credits from user account`
      });
    } catch (error) {
      console.error('Error processing credit spending:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process credit spending',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/users/:id/privacy-data - Get user's privacy data (GDPR compliance)
  getPrivacyData: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      
      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // In production, this would gather all user data from various tables
      const privacyData = {
        personalInfo: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          dob: user.dob,
          phone: user.phone || '',
          bio: user.bio,
          handle: user.handle,
          avatar: user.avatar,
          createdAt: user.createdAt || new Date().toISOString(),
          lastLogin: user.lastLogin || new Date().toISOString()
        },
        accountData: {
          trustScore: user.trustScore,
          auraCredits: user.auraCredits,
          activeGlow: user.activeGlow,
          acquaintances: user.acquaintances || [],
          blockedUsers: user.blockedUsers || [],
          profileViews: user.profileViews || [],
          notifications: user.notifications || []
        },
        activityData: {
          postsCount: 0, // Would be calculated from posts table
          commentsCount: 0, // Would be calculated from comments table
          reactionsGiven: 0, // Would be calculated from reactions table
          messagesCount: 0, // Would be calculated from messages table
          loginHistory: [], // Would be from login logs table
          ipAddresses: [], // Would be from security logs
          deviceInfo: [] // Would be from device tracking
        },
        dataProcessing: {
          purposes: [
            'Account management and authentication',
            'Content personalization and recommendations',
            'Communication and messaging',
            'Analytics and platform improvement',
            'Security and fraud prevention'
          ],
          legalBasis: 'Consent and legitimate interest',
          retentionPeriod: '2 years after account deletion',
          thirdPartySharing: 'None - all data remains within Aura platform',
          dataLocation: 'United States (with EU adequacy protections)'
        },
        exportedAt: new Date().toISOString(),
        format: 'JSON',
        version: '1.0'
      };

      res.json({
        success: true,
        data: privacyData,
        message: 'Privacy data exported successfully'
      });
    } catch (error) {
      console.error('Error exporting privacy data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export privacy data',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/clear-data - Clear user data (GDPR right to be forgotten)
  clearUserData: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { confirmationCode, reason } = req.body;

      // Validate confirmation code (in production, this would be a secure token)
      if (confirmationCode !== 'CONFIRM_DELETE_ALL_DATA') {
        return res.status(400).json({
          success: false,
          error: 'Invalid confirmation code',
          message: 'Please provide the correct confirmation code'
        });
      }

      const db = getDB();
      const user = await db.collection('users').findOne({ id });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }
      
      // Log the data deletion request for compliance
      console.log('Data deletion request processed:', {
        userId: id,
        userEmail: user.email,
        reason: reason || 'User requested data deletion',
        timestamp: new Date().toISOString(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      // In production, this would:
      // 1. Anonymize or delete user data across all tables
      // 2. Remove posts, comments, reactions, messages
      // 3. Clear profile views, acquaintances, notifications
      // 4. Purge uploaded files and media
      // 5. Remove from search indexes
      // 6. Clear analytics and tracking data
      // 7. Notify connected users of account deletion
      
      // Delete the user from MongoDB
      await db.collection('users').deleteOne({ id });

      res.json({
        success: true,
        message: 'All user data has been permanently deleted',
        deletedAt: new Date().toISOString(),
        dataTypes: [
          'Personal information',
          'Account data',
          'Posts and comments',
          'Messages and conversations',
          'Acquaintances and relationships',
          'Media files and uploads',
          'Activity logs and analytics'
        ]
      });
    } catch (error) {
      console.error('Error clearing user data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear user data',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/recalculate-trust - Recalculate trust score for a single user
  recalculateTrustForUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      const breakdown = await calculateUserTrust(id);
      if (!breakdown) {
        return res.status(500).json({
          success: false,
          error: 'Failed to calculate trust score',
          message: 'Unable to compute trust score for this user'
        });
      }

      res.json({
        success: true,
        data: breakdown,
        message: 'Trust score recalculated successfully'
      });
    } catch (error) {
      console.error('Error recalculating user trust:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to recalculate trust score',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/recalculate-trust-all - Recalculate trust scores for all users
  recalculateTrustForAllUsers: async (_req: Request, res: Response) => {
    try {
      await recalculateAllTrustScores();
      res.json({
        success: true,
        message: 'Trust scores recalculated for all users'
      });
    } catch (error) {
      console.error('Error recalculating trust scores for all users:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to recalculate trust scores for all users',
        message: 'Internal server error'
      });
    }
  },

  getSerendipityMatches: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { limit } = req.query as Record<string, any>;
      const parsedLimit = parseInt(String(limit ?? 20), 10);
      const limitValue = Number.isNaN(parsedLimit) ? 20 : parsedLimit;
      const matches = await getSerendipityMatchesForUser(id, limitValue);
      if (!matches) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }
      res.json({
        success: true,
        data: matches,
        count: matches.length,
        message: 'Serendipity matches retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting serendipity matches:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get serendipity matches',
        message: 'Internal server error'
      });
    }
  },

  addSerendipitySkip: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { targetUserId } = req.body;
      if (!targetUserId || typeof targetUserId !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Invalid targetUserId',
          message: 'targetUserId is required'
        });
      }

      const db = getDB();
      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      const now = new Date().toISOString();
      const skips = Array.isArray(user.serendipitySkips) ? user.serendipitySkips : [];
      const existingIndex = skips.findIndex((s: any) => s && s.targetUserId === targetUserId);

      if (existingIndex >= 0) {
        const existing = skips[existingIndex];
        skips[existingIndex] = {
          targetUserId,
          lastSkippedAt: now,
          count: typeof existing.count === 'number' ? existing.count + 1 : 1
        };
      } else {
        skips.push({
          targetUserId,
          lastSkippedAt: now,
          count: 1
        });
      }

      if (skips.length > 100) {
        skips.sort((a: any, b: any) => {
          const aTime = new Date(a.lastSkippedAt).getTime();
          const bTime = new Date(b.lastSkippedAt).getTime();
          return bTime - aTime;
        });
        skips.splice(100);
      }

      await db.collection('users').updateOne(
        { id },
        {
          $set: {
            serendipitySkips: skips,
            updatedAt: now
          }
        }
      );

      console.log('serendipity_skip event', { userId: id, targetUserId, count: skips.find((s: any) => s.targetUserId === targetUserId)?.count });

      res.json({
        success: true,
        message: 'Serendipity skip recorded'
      });
    } catch (error) {
      console.error('Error recording serendipity skip:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to record serendipity skip',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/users/:id/privacy-settings - Get user's privacy settings
  getPrivacySettings: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      
      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // Default privacy settings (in production, stored in database)
      const privacySettings = user.privacySettings || {
        profileVisibility: 'public', // public, friends, private
        showOnlineStatus: true,
        allowDirectMessages: 'everyone', // everyone, friends, none
        showProfileViews: true,
        allowTagging: true,
        showInSearch: true,
        dataProcessingConsent: true,
        marketingConsent: false,
        analyticsConsent: true,
        thirdPartySharing: false,
        locationTracking: false,
        activityTracking: true,
        personalizedAds: false,
        emailNotifications: true,
        pushNotifications: true,
        updatedAt: new Date().toISOString()
      };

      res.json({
        success: true,
        data: privacySettings,
        message: 'Privacy settings retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting privacy settings:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get privacy settings',
        message: 'Internal server error'
      });
    }
  },

  // PUT /api/users/:id/privacy-settings - Update user's privacy settings
  updatePrivacySettings: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const settings = req.body;
      const db = getDB();
      
      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // Update privacy settings
      const currentSettings = user.privacySettings || {};
      const updatedSettings = {
        ...currentSettings,
        ...settings,
        updatedAt: new Date().toISOString()
      };

      await db.collection('users').updateOne(
        { id },
        { 
          $set: { 
            privacySettings: updatedSettings,
            updatedAt: new Date().toISOString()
          }
        }
      );

      // Log privacy settings change for compliance
      console.log('Privacy settings updated:', {
        userId: id,
        changes: settings,
        timestamp: new Date().toISOString(),
        ipAddress: req.ip
      });

      res.json({
        success: true,
        data: updatedSettings,
        message: 'Privacy settings updated successfully'
      });
    } catch (error) {
      console.error('Error updating privacy settings:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update privacy settings',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/record-profile-view - Record that a user viewed another user's profile
  recordProfileView: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { viewerId } = req.body;
      const db = getDB();
      
      // Find the user whose profile was viewed
      const user = await db.collection('users').findOne({ id });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }
      
      // Find the viewer user
      const viewer = await db.collection('users').findOne({ id: viewerId });
      if (!viewer) {
        return res.status(404).json({
          success: false,
          error: 'Viewer not found',
          message: `Viewer with ID ${viewerId} does not exist`
        });
      }
      
      // Initialize profileViews array if it doesn't exist
      const profileViews = user.profileViews || [];
      
      // Add the viewer ID to the profile views if not already present
      if (!profileViews.includes(viewerId)) {
        profileViews.push(viewerId);
        
        await db.collection('users').updateOne(
          { id },
          { 
            $set: { 
              profileViews: profileViews,
              updatedAt: new Date().toISOString()
            }
          }
        );
      }
      
      // Create a notification for the profile owner
      const newNotification = {
        id: `notif-profile-view-${Date.now()}-${Math.random()}`,
        type: 'profile_view',
        fromUser: {
          id: viewer.id,
          name: viewer.name,
          handle: viewer.handle,
          avatar: viewer.avatar,
          avatarType: viewer.avatarType
        },
        message: 'viewed your profile',
        timestamp: new Date().toISOString(),
        isRead: false
      };
      
      // Add notification to the profile owner's notification array
      const updatedNotifications = [newNotification, ...(user.notifications || [])];
      
      await db.collection('users').updateOne(
        { id },
        { 
          $set: { 
            profileViews: profileViews,
            notifications: updatedNotifications,
            updatedAt: new Date().toISOString()
          }
        }
      );
      
      res.json({
        success: true,
        data: {
          profileOwnerId: id,
          viewerId: viewerId,
          timestamp: new Date().toISOString(),
          totalViews: profileViews.length
        },
        message: 'Profile view recorded successfully'
      });
    } catch (error) {
      console.error('Error recording profile view:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to record profile view',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/connect - Send connection request
  sendConnectionRequest: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      let { fromUserId } = req.body as { fromUserId?: string };
      const db = getDB();

      // Fallback to authenticated user if fromUserId is not provided
      if (!fromUserId && (req as any).user?.id) {
        fromUserId = (req as any).user.id;
      }

      if (!fromUserId) {
        return res.status(400).json({
          success: false,
          error: 'Missing requester',
          message: 'fromUserId is required to send a connection request'
        });
      }

      if (id === fromUserId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Cannot send connection request to yourself'
        });
      }

      // Find the target user
      const targetUser = await db.collection('users').findOne({ id });
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // Find the requester
      const requester = await db.collection('users').findOne({ id: fromUserId });
      if (!requester) {
        return res.status(404).json({
          success: false,
          error: 'Requester not found',
          message: `User with ID ${fromUserId} does not exist`
        });
      }

      // Check if already connected or requested
      const targetAcquaintances = targetUser.acquaintances || [];
      if (targetAcquaintances.includes(fromUserId)) {
        return res.status(400).json({
          success: false,
          error: 'Already connected',
          message: 'You are already connected with this user'
        });
      }

      // Create notification for target user
      const newNotification = {
        id: `notif-conn-${Date.now()}-${Math.random()}`,
        type: 'acquaintance_request',
        fromUser: {
          id: requester.id,
          name: requester.name,
          handle: requester.handle,
          avatar: requester.avatar,
          avatarType: requester.avatarType
        },
        message: 'wants to connect with you',
        timestamp: Date.now(),
        isRead: false
      };

      // Add to target user's notifications and sentRequests
      const updatedNotifications = [newNotification, ...(targetUser.notifications || [])];
      
      // Update target user
      await db.collection('users').updateOne(
        { id },
        { 
          $set: { 
            notifications: updatedNotifications,
            updatedAt: new Date().toISOString()
          }
        }
      );

      // Update requester's sentAcquaintanceRequests
      await db.collection('users').updateOne(
        { id: fromUserId },
        {
          $addToSet: { sentAcquaintanceRequests: id },
          $set: { updatedAt: new Date().toISOString() }
        }
      );

      res.json({
        success: true,
        message: 'Connection request sent successfully',
        data: newNotification
      });

    } catch (error) {
      console.error('Error sending connection request:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send connection request',
        message: 'Internal server error'
      });
    }
  },

  // POST /api/users/:id/reject-connection - Reject connection request
  rejectConnectionRequest: async (req: Request, res: Response) => {
    try {
      const { id } = req.params; // The ID of the user rejecting the request (rejecter)
      const { requesterId } = req.body; // The ID of the user who sent the request

      const db = getDB();

      // Find both users
      const rejecter = await db.collection('users').findOne({ id });
      if (!rejecter) {
        return res.status(404).json({
          success: false,
          error: 'Rejecter not found',
          message: `User with ID ${id} does not exist`
        });
      }

      const requester = await db.collection('users').findOne({ id: requesterId });
      if (!requester) {
        return res.status(404).json({
          success: false,
          error: 'Requester not found',
          message: `User with ID ${requesterId} does not exist`
        });
      }

      // Mark the specific request notification as read (rejected)
      const updatedNotifications = (rejecter.notifications || []).map((n: any) => {
        if (n.type === 'acquaintance_request' && n.fromUser.id === requesterId) {
          return { ...n, isRead: true };
        }
        return n;
      });

      await db.collection('users').updateOne(
        { id },
        { 
          $set: { 
            notifications: updatedNotifications,
            updatedAt: new Date().toISOString()
          }
        }
      );

      // Remove the sent request from requester's sentAcquaintanceRequests
      const requesterSentRequests = (requester.sentAcquaintanceRequests || []).filter((rid: string) => rid !== id);
      
      // Create a rejection notification for the requester
      const rejectionNotification = {
        id: `notif-reject-${Date.now()}-${Math.random()}`,
        type: 'acquaintance_rejected',
        fromUser: {
          id: rejecter.id,
          name: rejecter.name,
          handle: rejecter.handle,
          avatar: rejecter.avatar,
          avatarType: rejecter.avatarType
        },
        message: 'declined your connection request',
        timestamp: Date.now(),
        isRead: false,
        connectionId: id
      };

      await db.collection('users').updateOne(
        { id: requesterId },
        { 
          $set: { 
            sentAcquaintanceRequests: requesterSentRequests,
            updatedAt: new Date().toISOString()
          },
          $push: {
            notifications: {
              $each: [rejectionNotification],
              $position: 0
            }
          } as any
        }
      );

      res.json({
        success: true,
        data: {
          rejecterId: id,
          requesterId: requesterId,
          timestamp: new Date().toISOString()
        },
        message: 'Connection request rejected successfully'
      });

    } catch (error) {
      console.error('Error rejecting connection request:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reject connection request',
        message: 'Internal server error'
      });
    }
  },

  // DELETE /api/users/force-delete/:email - Force delete a user by email (Admin only)
  forceDeleteUser: async (req: Request, res: Response) => {
    try {
      const { email } = req.params;
      
      // Basic security check - in production this should be protected by admin middleware
      // For now, we'll just check if the email parameter is provided
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email required',
          message: 'Please provide the email of the user to delete'
        });
      }

      const db = getDB();
      
      // Find the user first to get their ID and handle
      const user = await db.collection('users').findOne({ 
        $or: [
          { email: email },
          { handle: email }, // Allow searching by handle too
          { id: email }      // Allow searching by ID too
        ]
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `No user found matching ${email}`
        });
      }

      // Delete the user
      const result = await db.collection('users').deleteOne({ _id: user._id });

      if (result.deletedCount === 1) {
        console.log(`Force deleted user: ${user.name} (${user.email})`);
        
        // Also clean up any posts or ads by this user if necessary
        // await db.collection('posts').deleteMany({ 'author.id': user.id });
        // await db.collection('ads').deleteMany({ ownerId: user.id });

        return res.json({
          success: true,
          message: `Successfully deleted user ${user.name} (${user.email})`,
          deletedUser: {
            name: user.name,
            email: user.email,
            handle: user.handle,
            id: user.id
          }
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Delete failed',
          message: 'Failed to delete the user from database'
        });
      }
    } catch (error) {
      console.error('Error force deleting user:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
};
