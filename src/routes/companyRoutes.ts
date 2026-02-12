import { Router } from 'express';
import { getDB } from '../db';
import { requireAuth } from '../middleware/authMiddleware';
import { sendCompanyInviteEmail } from '../services/emailService';
import { createNotificationInDB } from '../controllers/notificationsController';
import crypto from 'crypto';

const router = Router();

// POST /api/companies/:companyId/invites - Create invite
router.post('/:companyId/invites', requireAuth, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { email, role } = req.body;
    const currentUser = (req as any).user;

    if (!email || !role) {
      return res.status(400).json({ success: false, error: 'Email and role are required' });
    }

    const db = getDB();

    // Verify currentUser is owner/admin of the company
    const member = await db.collection('company_members').findOne({
      companyId,
      userId: currentUser.id,
      role: { $in: ['owner', 'admin'] }
    });

    // If not in company_members, check if they ARE the company (initial setup)
    if (!member && currentUser.id !== companyId) {
      return res.status(403).json({ success: false, error: 'Unauthorized to invite' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    // If the user already exists, send them a notification in the app
    const invitedUser = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
    
    const invite = {
      companyId,
      email: email.toLowerCase().trim(),
      role,
      token,
      status: 'pending',
      invitedByUserId: currentUser.id,
      targetUserId: invitedUser?.id || null,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const insertResult = await db.collection('company_invites').insertOne(invite);
    const inviteId = insertResult.insertedId.toString();

    // Get company name for the email/notification
    const company = await db.collection('users').findOne({ id: companyId });
    const companyName = company?.name || 'A Company';

    if (invitedUser) {
      await createNotificationInDB(
        invitedUser.id,
        'company_invite',
        currentUser.id,
        `invited you to join ${companyName} as ${role}`,
        undefined,
        undefined,
        { inviteId, companyId, role, token }
      );
      console.log(`🔔 Notification sent to existing user ${invitedUser.id} for company invite`);
    } else {
      // If the user doesn't exist, send them an email invite link
      const inviteUrl = `${process.env.FRONTEND_URL || 'https://aura.net.za'}/?invite=${token}`;
      await sendCompanyInviteEmail(invite.email, companyName, inviteUrl);
      console.log(`✉️ Email invite sent to new user ${invite.email}`);
    }

    res.json({ success: true, message: 'Invite sent successfully' });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to create invite' });
  }
});

// POST /api/companies/invites/accept - Accept invite token
router.post('/invites/accept', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    const currentUser = (req as any).user;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    const db = getDB();
    const invite = await db.collection('company_invites').findOne({
      token,
      expiresAt: { $gt: new Date() },
      status: 'pending'
    });

    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invalid, expired, or already processed invite' });
    }

    // Add to members
    await db.collection('company_members').updateOne(
      { companyId: invite.companyId, userId: currentUser.id },
      {
        $set: {
          companyId: invite.companyId,
          userId: currentUser.id,
          role: invite.role,
          joinedAt: new Date(),
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    // Mark invite as accepted
    await db.collection('company_invites').updateOne(
      { _id: invite._id },
      { 
        $set: { 
          status: 'accepted',
          acceptedAt: new Date(), 
          acceptedByUserId: currentUser.id,
          updatedAt: new Date()
        } 
      }
    );

    // Update the notification to mark it as read/accepted
    await db.collection('users').updateOne(
      { id: currentUser.id, 'notifications.type': 'company_invite', 'notifications.meta.token': token },
      { $set: { 'notifications.$.isRead': true } }
    );

    res.json({ success: true, message: 'Invite accepted successfully' });
  } catch (error) {
    console.error('Accept invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to accept invite' });
  }
});

// POST /api/companies/:companyId/invites/:inviteId/resend - Resend invite
router.post('/:companyId/invites/:inviteId/resend', requireAuth, async (req, res) => {
  try {
    const { companyId, inviteId } = req.params;
    const currentUser = (req as any).user;
    const { ObjectId } = require('mongodb');

    const db = getDB();

    // Verify currentUser is owner/admin
    const requester = await db.collection('company_members').findOne({
      companyId,
      userId: currentUser.id,
      role: { $in: ['owner', 'admin'] }
    });

    if (!requester && currentUser.id !== companyId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    let query: any = {};
    try {
      query._id = new ObjectId(inviteId);
    } catch (e) {
      query.inviteId = inviteId;
    }
    query.companyId = companyId;

    const invite = await db.collection('company_invites').findOne(query);

    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    // Refresh expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.collection('company_invites').updateOne(
      { _id: invite._id },
      { 
        $set: { 
          expiresAt,
          updatedAt: new Date() 
        } 
      }
    );

    // Get company name
    const company = await db.collection('users').findOne({ id: companyId });
    const companyName = company?.name || 'A Company';

    if (invite.targetUserId) {
      await createNotificationInDB(
        invite.targetUserId,
        'company_invite',
        currentUser.id,
        `resent an invite to join ${companyName} as ${invite.role}`,
        undefined,
        undefined,
        { inviteId: invite._id.toString(), companyId, role: invite.role, token: invite.token }
      );
    } else {
      const inviteUrl = `${process.env.FRONTEND_URL || 'https://aura.net.za'}/?invite=${invite.token}`;
      await sendCompanyInviteEmail(invite.email, companyName, inviteUrl);
    }

    res.json({ success: true, message: 'Invite resent successfully' });
  } catch (error) {
    console.error('Resend invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to resend invite' });
  }
});

// GET /api/companies/:companyId/members - List members
router.get('/:companyId/members', requireAuth, async (req, res) => {
  try {
    const { companyId } = req.params;
    const currentUser = (req as any).user;
    const db = getDB();

    // Verify currentUser is a member or the company itself
    const isMember = await db.collection('company_members').findOne({
      companyId,
      userId: currentUser.id
    });

    if (!isMember && currentUser.id !== companyId) {
      return res.status(403).json({ success: false, error: 'Unauthorized to view members' });
    }

    const members = await db.collection('company_members').aggregate([
      { $match: { companyId } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'id',
          as: 'userDetails'
        }
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          userId: 1,
          role: 1,
          joinedAt: 1,
          name: '$userDetails.name',
          email: '$userDetails.email',
          avatar: '$userDetails.avatar'
        }
      }
    ]).toArray();

    res.json({ success: true, data: members });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ success: false, error: 'Failed to get members' });
  }
});

// GET /api/companies/:companyId/invites - List pending invites
router.get('/:companyId/invites', requireAuth, async (req, res) => {
  try {
    const { companyId } = req.params;
    const currentUser = (req as any).user;
    const db = getDB();

    // Verify currentUser is owner/admin
    const requester = await db.collection('company_members').findOne({
      companyId,
      userId: currentUser.id,
      role: { $in: ['owner', 'admin'] }
    });

    if (!requester && currentUser.id !== companyId) {
      return res.status(403).json({ success: false, error: 'Unauthorized to view invites' });
    }

    const invites = await db.collection('company_invites').find({
      companyId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).toArray();

    res.json({ success: true, data: invites });
  } catch (error) {
    console.error('Get invites error:', error);
    res.status(500).json({ success: false, error: 'Failed to get invites' });
  }
});

// DELETE /api/companies/:companyId/invites/:inviteId - Cancel invite
router.delete('/:companyId/invites/:inviteId', requireAuth, async (req, res) => {
  try {
    const { companyId, inviteId } = req.params;
    const currentUser = (req as any).user;
    const { ObjectId } = require('mongodb');

    const db = getDB();

    // Verify currentUser is owner/admin
    const requester = await db.collection('company_members').findOne({
      companyId,
      userId: currentUser.id,
      role: { $in: ['owner', 'admin'] }
    });

    if (!requester && currentUser.id !== companyId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    let query: any = {};
    try {
      query._id = new ObjectId(inviteId);
    } catch (e) {
      // If not a valid ObjectId, try finding by custom inviteId field if it exists
      query.inviteId = inviteId;
    }
    query.companyId = companyId;

    const result = await db.collection('company_invites').updateOne(
      query,
      { 
        $set: { 
          status: 'cancelled',
          updatedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    res.json({ success: true, message: 'Invite cancelled successfully' });
  } catch (error) {
    console.error('Cancel invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel invite' });
  }
});

// POST /api/companies/invites/:inviteId/accept - Accept invite by ID
router.post('/invites/:inviteId/accept', requireAuth, async (req, res) => {
  try {
    const { inviteId } = req.params;
    const currentUser = (req as any).user;
    const { ObjectId } = require('mongodb');

    const db = getDB();
    
    let query: any = { 
      status: 'pending',
      expiresAt: { $gt: new Date() }
    };
    
    try {
      query._id = new ObjectId(inviteId);
    } catch (e) {
      query.inviteId = inviteId;
    }

    const invite = await db.collection('company_invites').findOne(query);

    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invalid, expired, or already processed invite' });
    }

    // Check if target matches user email or targetUserId
    const user = await db.collection('users').findOne({ id: currentUser.id });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const emailMatch = invite.email.toLowerCase() === user.email.toLowerCase();
    const idMatch = invite.targetUserId === user.id;

    if (!emailMatch && !idMatch) {
      return res.status(403).json({ success: false, error: 'This invite was not intended for you' });
    }

    // Add to members
    await db.collection('company_members').updateOne(
      { companyId: invite.companyId, userId: currentUser.id },
      {
        $set: {
          companyId: invite.companyId,
          userId: currentUser.id,
          role: invite.role,
          joinedAt: new Date(),
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    // Mark invite as accepted
    await db.collection('company_invites').updateOne(
      { _id: invite._id },
      { 
        $set: { 
          status: 'accepted',
          acceptedAt: new Date(), 
          acceptedByUserId: currentUser.id,
          updatedAt: new Date()
        } 
      }
    );

    // Mark notification as read
    await db.collection('users').updateOne(
      { id: currentUser.id, 'notifications.meta.inviteId': inviteId },
      { $set: { 'notifications.$.isRead': true } }
    );

    res.json({ success: true, message: 'Invite accepted successfully' });
  } catch (error) {
    console.error('Accept invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to accept invite' });
  }
});

// POST /api/companies/invites/:inviteId/decline - Decline invite
router.post('/invites/:inviteId/decline', requireAuth, async (req, res) => {
  try {
    const { inviteId } = req.params;
    const currentUser = (req as any).user;
    const { ObjectId } = require('mongodb');

    const db = getDB();
    
    let query: any = { 
      status: 'pending'
    };
    
    try {
      query._id = new ObjectId(inviteId);
    } catch (e) {
      query.inviteId = inviteId;
    }

    const invite = await db.collection('company_invites').findOne(query);

    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invite not found or already processed' });
    }

    // Verify this invite is for the current user
    const user = await db.collection('users').findOne({ id: currentUser.id });
    if (!user || (invite.email.toLowerCase() !== user.email.toLowerCase() && invite.targetUserId !== user.id)) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    await db.collection('company_invites').updateOne(
      { _id: invite._id },
      { 
        $set: { 
          status: 'declined',
          updatedAt: new Date() 
        } 
      }
    );

    // Mark notification as read
    await db.collection('users').updateOne(
      { id: currentUser.id, 'notifications.meta.inviteId': inviteId },
      { $set: { 'notifications.$.isRead': true } }
    );

    res.json({ success: true, message: 'Invite declined' });
  } catch (error) {
    console.error('Decline invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to decline invite' });
  }
});

// DELETE /api/companies/:companyId/members/:userId - Remove member
router.delete('/:companyId/members/:userId', requireAuth, async (req, res) => {
  try {
    const { companyId, userId } = req.params;
    const currentUser = (req as any).user;

    const db = getDB();

    // Verify currentUser is owner/admin
    const requester = await db.collection('company_members').findOne({
      companyId,
      userId: currentUser.id,
      role: { $in: ['owner', 'admin'] }
    });

    if (!requester && currentUser.id !== companyId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    await db.collection('company_members').deleteOne({ companyId, userId });

    res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
});

export default router;
