import { Request, Response } from 'express';
import { getDB } from '../db';
import { User } from '../types';

export const dataExportController = {
  // GET /api/data-export/request/:userId - Request data export
  requestDataExport: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const db = getDB();
      
      const user = await db.collection('users').findOne({ id: userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${userId} does not exist`
        });
      }

      // Generate export request ID
      const exportRequestId = `export-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Create export request record
      const exportRequest = {
        id: exportRequestId,
        userId: userId,
        status: 'processing',
        requestedAt: new Date().toISOString(),
        completedAt: null,
        downloadUrl: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      };

      // In production, you'd store this in a separate exports collection
      // For now, we'll process it immediately
      console.log('Data export requested:', exportRequest);

      // Process the export immediately (in production, this would be queued)
      const exportData = await generateUserDataExport(userId, db);
      
      // Update export request
      exportRequest.status = 'completed';
      exportRequest.completedAt = new Date().toISOString();
      exportRequest.downloadUrl = `/api/data-export/download/${exportRequestId}`;

      // Store the export data temporarily (in production, save to file storage)
      // For demo purposes, we'll store in memory or database
      await db.collection('dataExports').insertOne({
        ...exportRequest,
        data: exportData
      });

      res.json({
        success: true,
        data: {
          exportRequestId,
          status: 'completed',
          downloadUrl: exportRequest.downloadUrl,
          expiresAt: exportRequest.expiresAt,
          dataSize: JSON.stringify(exportData).length,
          recordCount: calculateRecordCount(exportData)
        },
        message: 'Data export completed successfully'
      });
    } catch (error) {
      console.error('Error requesting data export:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to request data export',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/data-export/download/:exportId - Download exported data
  downloadDataExport: async (req: Request, res: Response) => {
    try {
      const { exportId } = req.params;
      const db = getDB();
      
      const exportRecord = await db.collection('dataExports').findOne({ id: exportId });
      if (!exportRecord) {
        return res.status(404).json({
          success: false,
          error: 'Export not found',
          message: 'The requested data export does not exist or has expired'
        });
      }

      // Check if export has expired
      if (new Date() > new Date(exportRecord.expiresAt)) {
        return res.status(410).json({
          success: false,
          error: 'Export expired',
          message: 'This data export has expired and is no longer available'
        });
      }

      // Set headers for file download
      const filename = `aura-data-export-${exportRecord.userId}-${new Date().toISOString().split('T')[0]}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache');

      // Send the export data
      res.json(exportRecord.data);
    } catch (error) {
      console.error('Error downloading data export:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to download data export',
        message: 'Internal server error'
      });
    }
  },

  // GET /api/data-export/status/:exportId - Check export status
  getExportStatus: async (req: Request, res: Response) => {
    try {
      const { exportId } = req.params;
      const db = getDB();
      
      const exportRecord = await db.collection('dataExports').findOne({ id: exportId });
      if (!exportRecord) {
        return res.status(404).json({
          success: false,
          error: 'Export not found',
          message: 'The requested data export does not exist'
        });
      }

      res.json({
        success: true,
        data: {
          exportRequestId: exportRecord.id,
          status: exportRecord.status,
          requestedAt: exportRecord.requestedAt,
          completedAt: exportRecord.completedAt,
          downloadUrl: exportRecord.downloadUrl,
          expiresAt: exportRecord.expiresAt,
          dataSize: exportRecord.data ? JSON.stringify(exportRecord.data).length : 0,
          recordCount: exportRecord.data ? calculateRecordCount(exportRecord.data) : 0
        },
        message: 'Export status retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting export status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get export status',
        message: 'Internal server error'
      });
    }
  },

  // DELETE /api/data-export/:exportId - Delete export data
  deleteExport: async (req: Request, res: Response) => {
    try {
      const { exportId } = req.params;
      const db = getDB();
      
      const result = await db.collection('dataExports').deleteOne({ id: exportId });
      
      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'Export not found',
          message: 'The requested data export does not exist'
        });
      }

      res.json({
        success: true,
        message: 'Data export deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting export:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete export',
        message: 'Internal server error'
      });
    }
  }
};

// Helper function to generate comprehensive user data export
async function generateUserDataExport(userId: string, db: any): Promise<any> {
  const exportData = {
    exportInfo: {
      userId: userId,
      exportedAt: new Date().toISOString(),
      exportVersion: '1.0',
      format: 'JSON',
      description: 'Complete personal data export from Aura Social Platform'
    },
    personalInformation: {},
    accountData: {},
    contentData: {
      posts: [],
      comments: [],
      reactions: []
    },
    socialData: {
      connections: [],
      blockedUsers: [],
      profileViews: [],
      sentConnectionRequests: []
    },
    privacyData: {
      settings: {},
      consentRecords: [],
      dataProcessingHistory: []
    },
    activityData: {
      loginHistory: [],
      analyticsEvents: [],
      interactions: []
    },
    systemData: {
      notifications: [],
      messages: [],
      subscriptions: []
    }
  };

  try {
    // 1. Get user's personal information
    const user = await db.collection('users').findOne({ id: userId });
    if (user) {
      exportData.personalInformation = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        dob: user.dob || '',
        bio: user.bio || '',
        handle: user.handle,
        avatar: user.avatar,
        avatarType: user.avatarType,
        coverImage: user.coverImage,
        coverType: user.coverType,
        zodiacSign: user.zodiacSign,
        industry: user.industry,
        companyName: user.companyName,
        employeeCount: user.employeeCount,
        isCompany: user.isCompany || false,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLogin: user.lastLogin
      };

      exportData.accountData = {
        trustScore: user.trustScore,
        auraCredits: user.auraCredits,
        activeGlow: user.activeGlow,
        isPrivate: user.isPrivate || false,
        googleId: user.googleId
      };

      exportData.socialData = {
        connections: user.acquaintances || [],
        blockedUsers: user.blockedUsers || [],
        profileViews: user.profileViews || [],
        sentConnectionRequests: user.sentConnectionRequests || []
      };

      exportData.privacyData.settings = user.privacySettings || {};
    }

    // 2. Get user's posts
    const posts = await db.collection('posts').find({ 'author.id': userId }).toArray();
    exportData.contentData.posts = posts.map(post => ({
      id: post.id,
      content: post.content,
      mediaUrl: post.mediaUrl,
      mediaType: post.mediaType,
      energy: post.energy,
      radiance: post.radiance,
      timestamp: post.timestamp,
      reactions: post.reactions || {},
      hashtags: post.hashtags || [],
      isTimeCapsule: post.isTimeCapsule || false,
      unlockDate: post.unlockDate,
      timeCapsuleType: post.timeCapsuleType,
      timeCapsuleTitle: post.timeCapsuleTitle,
      createdAt: post.createdAt || new Date(post.timestamp).toISOString()
    }));

    // 3. Get user's comments
    const comments = await db.collection('comments').find({ 'author.id': userId }).toArray();
    exportData.contentData.comments = comments.map(comment => ({
      id: comment.id,
      postId: comment.postId,
      text: comment.text,
      timestamp: comment.timestamp,
      parentId: comment.parentId,
      reactions: comment.reactions || {},
      createdAt: comment.createdAt || new Date(comment.timestamp).toISOString()
    }));

    // 4. Get user's reactions (from posts and comments they reacted to)
    const postsWithUserReactions = await db.collection('posts').find({
      [`userReactions.${userId}`]: { $exists: true }
    }).toArray();
    
    const commentsWithUserReactions = await db.collection('comments').find({
      [`userReactions.${userId}`]: { $exists: true }
    }).toArray();

    exportData.contentData.reactions = [
      ...postsWithUserReactions.map(post => ({
        type: 'post',
        targetId: post.id,
        reaction: post.userReactions[userId],
        timestamp: new Date().toISOString() // In production, store reaction timestamps
      })),
      ...commentsWithUserReactions.map(comment => ({
        type: 'comment',
        targetId: comment.id,
        postId: comment.postId,
        reaction: comment.userReactions[userId],
        timestamp: new Date().toISOString()
      }))
    ];

    // 5. Get user's notifications
    const notifications = await db.collection('notifications').find({ userId: userId }).toArray();
    exportData.systemData.notifications = notifications.map(notification => ({
      id: notification.id,
      type: notification.type,
      message: notification.message,
      timestamp: notification.timestamp,
      isRead: notification.isRead,
      fromUserId: notification.fromUser?.id,
      postId: notification.postId,
      createdAt: notification.createdAt || new Date(notification.timestamp).toISOString()
    }));

    // 6. Get user's messages
    const sentMessages = await db.collection('messages').find({ senderId: userId }).toArray();
    const receivedMessages = await db.collection('messages').find({ receiverId: userId }).toArray();
    
    exportData.systemData.messages = {
      sent: sentMessages.map(msg => ({
        id: msg.id,
        receiverId: msg.receiverId,
        text: msg.text,
        timestamp: msg.timestamp,
        messageType: msg.messageType,
        mediaUrl: msg.mediaUrl,
        isRead: msg.isRead,
        createdAt: msg.createdAt || new Date(msg.timestamp).toISOString()
      })),
      received: receivedMessages.map(msg => ({
        id: msg.id,
        senderId: msg.senderId,
        text: msg.text,
        timestamp: msg.timestamp,
        messageType: msg.messageType,
        mediaUrl: msg.mediaUrl,
        isRead: msg.isRead,
        createdAt: msg.createdAt || new Date(msg.timestamp).toISOString()
      }))
    };

    // 7. Get analytics events (if user consented)
    if (user?.privacySettings?.analyticsConsent) {
      // In production, you'd have an analytics collection
      exportData.activityData.analyticsEvents = [
        {
          note: 'Analytics events would be included here if available',
          consentGiven: true,
          dataTypes: ['page_views', 'user_interactions', 'feature_usage']
        }
      ];
    }

    // 8. Add privacy and consent records
    exportData.privacyData.consentRecords = [
      {
        type: 'data_processing',
        consent: user?.privacySettings?.dataProcessingConsent || false,
        timestamp: user?.privacySettings?.updatedAt || user?.createdAt
      },
      {
        type: 'analytics',
        consent: user?.privacySettings?.analyticsConsent || false,
        timestamp: user?.privacySettings?.updatedAt || user?.createdAt
      },
      {
        type: 'marketing',
        consent: user?.privacySettings?.marketingConsent || false,
        timestamp: user?.privacySettings?.updatedAt || user?.createdAt
      },
      {
        type: 'third_party_sharing',
        consent: user?.privacySettings?.thirdPartySharing || false,
        timestamp: user?.privacySettings?.updatedAt || user?.createdAt
      }
    ];

    // 9. Add data processing history
    exportData.privacyData.dataProcessingHistory = [
      {
        action: 'account_created',
        timestamp: user?.createdAt,
        description: 'User account created with initial data processing consent'
      },
      {
        action: 'privacy_settings_updated',
        timestamp: user?.privacySettings?.updatedAt || user?.createdAt,
        description: 'Privacy settings last updated by user'
      },
      {
        action: 'data_export_requested',
        timestamp: new Date().toISOString(),
        description: 'User requested complete data export (GDPR Article 20)'
      }
    ];

    // 10. Add summary statistics
    exportData.exportInfo.summary = {
      totalPosts: exportData.contentData.posts.length,
      totalComments: exportData.contentData.comments.length,
      totalReactions: exportData.contentData.reactions.length,
      totalConnections: exportData.socialData.connections.length,
      totalNotifications: exportData.systemData.notifications.length,
      totalMessages: exportData.systemData.messages.sent.length + exportData.systemData.messages.received.length,
      accountAge: user?.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0,
      lastActivity: user?.lastLogin
    };

  } catch (error) {
    console.error('Error generating user data export:', error);
    exportData.exportInfo.errors = [
      {
        message: 'Some data could not be exported due to technical issues',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    ];
  }

  return exportData;
}

// Helper function to calculate record count
function calculateRecordCount(exportData: any): number {
  let count = 0;
  
  if (exportData.personalInformation) count += 1;
  if (exportData.accountData) count += 1;
  if (exportData.contentData?.posts) count += exportData.contentData.posts.length;
  if (exportData.contentData?.comments) count += exportData.contentData.comments.length;
  if (exportData.contentData?.reactions) count += exportData.contentData.reactions.length;
  if (exportData.socialData?.connections) count += exportData.socialData.connections.length;
  if (exportData.systemData?.notifications) count += exportData.systemData.notifications.length;
  if (exportData.systemData?.messages?.sent) count += exportData.systemData.messages.sent.length;
  if (exportData.systemData?.messages?.received) count += exportData.systemData.messages.received.length;
  if (exportData.privacyData?.consentRecords) count += exportData.privacyData.consentRecords.length;
  
  return count;
}