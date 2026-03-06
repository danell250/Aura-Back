import { Request, Response } from 'express';
import { getDB } from '../db';
import { resolveOwnerAdminCompanyAccess } from '../services/jobApplicationLifecycleService';
import { getApplicationResumeSignedUrl } from '../services/jobResumeStorageService';
import { createInviteToApplyNotification } from '../services/userOpportunityNotificationService';
import { readString } from '../utils/inputSanitizers';
import { resolveIdentityActor } from '../utils/identityUtils';

const readIdentityHeader = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
};

const resolveCompanyIdentityAccess = async (req: Request): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  companyId?: string;
  company?: any;
}> => {
  const authenticatedUserId = readString((req as any)?.user?.id, 120);
  if (!authenticatedUserId) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const identityType = readIdentityHeader(req.headers['x-identity-type']);
  const requestedCompanyId = readIdentityHeader(req.headers['x-identity-id']);
  if (identityType !== 'company' || !requestedCompanyId) {
    return { ok: false, status: 403, error: 'Company identity context is required' };
  }

  const identityActor = await resolveIdentityActor(
    authenticatedUserId,
    { ownerType: 'company', ownerId: requestedCompanyId },
    req.headers,
  );
  if (!identityActor || identityActor.type !== 'company' || identityActor.id !== requestedCompanyId) {
    return { ok: false, status: 403, error: 'Unauthorized company identity context' };
  }

  const access = await resolveOwnerAdminCompanyAccess(identityActor.id, authenticatedUserId);
  if (!access.allowed || !access.company) {
    return { ok: false, status: access.status, error: access.error || 'Unauthorized company access' };
  }

  return {
    ok: true,
    status: 200,
    companyId: identityActor.id,
    company: access.company,
  };
};

const candidateAllowsCompanyOutreach = (candidate: any): boolean => {
  if ((candidate as any)?.openToWork !== true) return false;
  const privacySettings = ((candidate as any)?.privacySettings && typeof (candidate as any).privacySettings === 'object')
    ? (candidate as any).privacySettings
    : {};
  const profileVisibility = readString((privacySettings as any)?.profileVisibility, 40).toLowerCase();
  if (profileVisibility === 'private' || profileVisibility === 'friends') {
    return false;
  }
  if ((privacySettings as any)?.showInSearch === false) {
    return false;
  }
  return true;
};

export const userOpportunityController = {
  // POST /api/users/:id/invite-to-apply
  inviteToApply: async (req: Request, res: Response) => {
    try {
      const candidateUserId = readString(req.params.id, 120);
      if (!candidateUserId) {
        return res.status(400).json({ success: false, error: 'Candidate user id is required' });
      }

      const companyAccess = await resolveCompanyIdentityAccess(req);
      if (!companyAccess.ok || !companyAccess.companyId || !companyAccess.company) {
        return res.status(companyAccess.status).json({ success: false, error: companyAccess.error || 'Unauthorized' });
      }

      const db = getDB();
      const candidate = await db.collection('users').findOne({ id: candidateUserId });
      if (!candidate) {
        return res.status(404).json({ success: false, error: 'Candidate not found' });
      }

      if (!candidateAllowsCompanyOutreach(candidate)) {
        return res.status(409).json({
          success: false,
          error: 'Candidate is not available for company outreach on Aura',
        });
      }

      const duplicateWindowMs = 7 * 24 * 60 * 60 * 1000;
      const existingInvite = await db.collection('notifications').findOne(
        {
          ownerType: 'user',
          ownerId: candidateUserId,
          type: 'invite_to_apply',
          'fromUser.id': companyAccess.companyId,
          timestamp: { $gte: Date.now() - duplicateWindowMs },
        },
        { projection: { id: 1 } },
      );

      if (existingInvite) {
        return res.status(409).json({
          success: false,
          error: 'This candidate was already invited recently',
        });
      }

      const inviterUserId = readString((req as any)?.user?.id, 120);
      const notification = await createInviteToApplyNotification({
        db,
        candidateUserId,
        companyId: companyAccess.companyId,
        companyHandle: readString((companyAccess.company as any)?.handle, 120),
        invitedByUserId: inviterUserId,
      });

      return res.json({
        success: true,
        data: {
          notificationId: String((notification as any)?.id || ''),
          candidateUserId,
          companyId: companyAccess.companyId,
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Invite candidate to apply error:', error);
      return res.status(500).json({ success: false, error: 'Failed to send invite' });
    }
  },

  // GET /api/users/:id/open-resume/view-url
  getOpenResumeViewUrl: async (req: Request, res: Response) => {
    try {
      const targetUserId = readString(req.params.id, 120);
      const authenticatedUserId = readString((req as any)?.user?.id, 120);
      if (!targetUserId || !authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const db = getDB();
      const candidate = await db.collection('users').findOne({ id: targetUserId });
      if (!candidate) {
        return res.status(404).json({ success: false, error: 'Candidate not found' });
      }

      const isSelf = authenticatedUserId === targetUserId;
      if (!isSelf) {
        const companyAccess = await resolveCompanyIdentityAccess(req);
        if (!companyAccess.ok) {
          return res.status(companyAccess.status).json({ success: false, error: companyAccess.error || 'Unauthorized' });
        }
        if (!candidateAllowsCompanyOutreach(candidate)) {
          return res.status(409).json({ success: false, error: 'Candidate is not available for company outreach on Aura' });
        }
      }

      const resumeKey = readString((candidate as any)?.resumeKey, 500) || readString((candidate as any)?.defaultResumeKey, 500);
      if (!resumeKey) {
        return res.status(404).json({ success: false, error: 'Resume not available' });
      }

      const expiresInSeconds = 600;
      const url = await getApplicationResumeSignedUrl(resumeKey, expiresInSeconds);
      if (!url) {
        return res.status(503).json({
          success: false,
          error: 'Resume preview service is not configured',
        });
      }

      return res.json({
        success: true,
        data: {
          url,
          expiresInSeconds,
        },
      });
    } catch (error) {
      console.error('Get open resume view URL error:', error);
      return res.status(500).json({ success: false, error: 'Failed to generate resume view URL' });
    }
  },
};
