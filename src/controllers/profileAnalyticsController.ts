import { Request, Response } from 'express';
import { getDB } from '../db';
import { emitAuthorInsightsUpdate } from './postsController';
import { createNotificationInDB } from './notificationsController';
import { resolveIdentityActor } from '../utils/identityUtils';
import { recordOpenToWorkProfileViewMetric } from '../services/openToWorkMetricsService';

export const profileAnalyticsController = {
  // POST /api/privacy/profile-view - Record profile view (if user allows it)
  recordProfileView: async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = (req as any).user?.id as string | undefined;
      const { profileOwnerId } = req.body;
      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      if (!profileOwnerId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'profileOwnerId is required'
        });
      }

      const db = getDB();

      const [userOwner, companyOwner] = await Promise.all([
        db.collection('users').findOne({ id: profileOwnerId }),
        db.collection('companies').findOne({ id: profileOwnerId, legacyArchived: { $ne: true } }),
      ]);

      const ownerType: 'user' | 'company' = userOwner ? 'user' : 'company';
      const ownerCollection = ownerType === 'user' ? 'users' : 'companies';
      const profileOwner = userOwner || companyOwner;

      if (!profileOwner) {
        return res.status(404).json({
          success: false,
          error: 'Profile owner not found'
        });
      }

      if (ownerType === 'company') {
        const isCompanyOwner = String((profileOwner as any)?.ownerId || '') === authenticatedUserId;
        const companyMembership = await db.collection('company_members').findOne(
          { companyId: profileOwnerId, userId: authenticatedUserId },
          { projection: { _id: 1 } }
        );

        if (isCompanyOwner || companyMembership) {
          return res.json({
            success: true,
            message: 'Skipped profile view tracking for internal company view'
          });
        }
      }

      if (ownerType === 'user' && profileOwnerId === authenticatedUserId) {
        return res.json({
          success: true,
          message: 'Skipped profile view tracking for self-view'
        });
      }

      const privacySettings = ownerType === 'user' ? (profileOwner.privacySettings || {}) : {};
      if (ownerType === 'user' && !privacySettings.showProfileViews && privacySettings.showProfileViews !== undefined) {
        return res.json({
          success: true,
          message: 'Profile view not recorded - user has disabled profile view tracking'
        });
      }

      const viewerIdentity = await resolveIdentityActor(
        authenticatedUserId,
        {},
        req.headers,
      );
      if (!viewerIdentity) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Unauthorized identity context for profile view tracking',
        });
      }

      const viewer = await db.collection('users').findOne({ id: authenticatedUserId });
      if (!viewer) {
        return res.status(404).json({
          success: false,
          error: 'Viewer not found'
        });
      }

      const viewerActor =
        viewerIdentity.type === 'company'
          ? await db.collection('companies').findOne(
              { id: viewerIdentity.id, legacyArchived: { $ne: true } },
              { projection: { id: 1, name: 1, handle: 1 } },
            )
          : viewer;
      if (!viewerActor) {
        return res.status(404).json({
          success: false,
          error: 'Viewer identity not found'
        });
      }

      const profileViews = Array.isArray(profileOwner.profileViews) ? [...profileOwner.profileViews] : [];
      const shouldAddProfileView = !profileViews.includes(authenticatedUserId);

      if (shouldAddProfileView) {
        profileViews.push(authenticatedUserId);

        await db.collection(ownerCollection).updateOne(
          { id: profileOwnerId },
          {
            $set: {
              profileViews,
              updatedAt: new Date().toISOString()
            }
          }
        );
      }

      const existingRecentViewNotice = await db.collection('notifications').findOne(
        {
          ownerType,
          ownerId: profileOwnerId,
          type: 'profile_view',
          'fromUser.id': String((viewerActor as any)?.id || ''),
          timestamp: { $gte: Date.now() - 60 * 60 * 1000 },
        },
        { projection: { id: 1 } },
      );

      if (existingRecentViewNotice) {
        return res.json({
          success: true,
          data: {
            profileOwnerId,
            viewerId: authenticatedUserId,
            totalViews: profileViews.length
          },
          message: 'Profile view already recorded recently'
        });
      }

      await createNotificationInDB(
        profileOwnerId,
        'profile_view',
        String((viewerActor as any)?.id || ''),
        'viewed your profile',
        undefined,
        undefined,
        {
          viewedBy: viewer.id,
          viewerUserId: viewer.id,
          viewerIdentityType: viewerIdentity.type,
          viewerCompanyId: viewerIdentity.type === 'company' ? viewerIdentity.id : undefined,
        },
        undefined,
        ownerType
      );
      if (ownerType === 'user') {
        await recordOpenToWorkProfileViewMetric({
          db,
          userId: profileOwnerId,
          viewerIdentityType: viewerIdentity.type,
        });
      }
      if (shouldAddProfileView) {
        emitAuthorInsightsUpdate(req.app, profileOwnerId, ownerType);
      }

      return res.json({
        success: true,
        data: {
          profileOwnerId,
          viewerId: authenticatedUserId,
          totalViews: profileViews.length
        },
        message: 'Profile view recorded successfully'
      });
    } catch (error) {
      console.error('Error recording profile view:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to record profile view',
        message: 'Internal server error'
      });
    }
  },
};
