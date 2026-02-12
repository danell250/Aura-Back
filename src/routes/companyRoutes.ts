import { Router } from 'express';
import { getDB } from '../db';
import { requireAuth } from '../middleware/authMiddleware';
import { sendCompanyInviteEmail } from '../services/emailService';
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

    const invite = {
      companyId,
      email: email.toLowerCase().trim(),
      role,
      token,
      expiresAt,
      createdAt: new Date(),
      invitedBy: currentUser.id
    };

    await db.collection('company_invites').insertOne(invite);

    // Get company name for the email
    const company = await db.collection('users').findOne({ id: companyId });
    const companyName = company?.name || 'A Company';

    const inviteUrl = `${process.env.FRONTEND_URL || 'https://aura.net.za'}/?invite=${token}`;
    
    await sendCompanyInviteEmail(invite.email, companyName, inviteUrl);

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
      acceptedAt: { $exists: false }
    });

    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invalid or expired invite' });
    }

    // Add to members
    await db.collection('company_members').updateOne(
      { companyId: invite.companyId, userId: currentUser.id },
      {
        $set: {
          companyId: invite.companyId,
          userId: currentUser.id,
          role: invite.role,
          joinedAt: new Date()
        }
      },
      { upsert: true }
    );

    // Mark invite as accepted
    await db.collection('company_invites').updateOne(
      { _id: invite._id },
      { $set: { acceptedAt: new Date(), acceptedByUserId: currentUser.id } }
    );

    res.json({ success: true, message: 'Invite accepted successfully' });
  } catch (error) {
    console.error('Accept invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to accept invite' });
  }
});

// GET /api/companies/:companyId/members - List members
router.get('/:companyId/members', requireAuth, async (req, res) => {
  try {
    const { companyId } = req.params;
    const db = getDB();

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
