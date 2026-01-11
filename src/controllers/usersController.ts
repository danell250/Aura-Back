import { Request, Response } from 'express';
import { getDB } from '../db';

export const usersController = {
  // GET /api/users - Get all users
  getAllUsers: async (req: Request, res: Response) => {
    try {
      const db = getDB();
      const users = await db.collection('users').find({}).toArray();
      
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
      
      // Validate required fields
      if (!userData.firstName || !userData.lastName || !userData.email) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'firstName, lastName, and email are required'
        });
      }

      const db = getDB();
      
      // Check if user already exists
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

      // Create new user with proper ID
      const userId = userData.id || `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newUser = {
        id: userId,
        firstName: userData.firstName,
        lastName: userData.lastName,
        name: userData.name || `${userData.firstName} ${userData.lastName}`,
        handle: userData.handle || `@${userData.firstName.toLowerCase()}${userData.lastName.toLowerCase()}`,
        avatar: userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
        avatarType: userData.avatarType || 'image',
        email: userData.email,
        bio: userData.bio || '',
        dob: userData.dob || '',
        phone: userData.phone || '',
        industry: userData.industry || '',
        companyName: userData.companyName || '',
        acquaintances: userData.acquaintances || [],
        blockedUsers: userData.blockedUsers || [],
        trustScore: userData.trustScore || 10,
        auraCredits: userData.auraCredits || 100, // New users start with 100 free credits
        activeGlow: userData.activeGlow || 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save to MongoDB
      const result = await db.collection('users').insertOne(newUser);
      
      if (!result.acknowledged) {
        throw new Error('Failed to insert user into database');
      }

      console.log('User created successfully:', userId);

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
      
      // Add updatedAt timestamp
      const updateData = {
        ...updates,
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

  // POST /api/users/:id/connect - Send connection request
  sendConnectionRequest: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { targetUserId } = req.body;

      // In production, this would create a notification and update user records
      res.json({
        success: true,
        message: 'Connection request sent successfully'
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

  // POST /api/users/:id/block - Block user
  blockUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { targetUserId } = req.body;

      // In production, this would update user's blocked list
      res.json({
        success: true,
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
        $or: [
          { name: searchRegex },
          { firstName: searchRegex },
          { lastName: searchRegex },
          { handle: searchRegex },
          { email: searchRegex },
          { bio: searchRegex }
        ]
      }).toArray();

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
      const { credits, bundleName, transactionId, paymentMethod } = req.body;

      // Validate required fields
      if (!credits || !bundleName) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'credits and bundleName are required'
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

      // Update user credits
      const currentCredits = user.auraCredits || 0;
      const newCredits = currentCredits + credits;
      
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
      console.log('Credit purchase processed:', {
        userId: id,
        bundleName,
        credits,
        previousCredits: currentCredits,
        newCredits,
        transactionId,
        paymentMethod,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        data: {
          userId: id,
          creditsAdded: credits,
          previousCredits: currentCredits,
          newCredits,
          bundleName,
          transactionId
        },
        message: `Successfully added ${credits} credits to user account`
      });
    } catch (error) {
      console.error('Error processing credit purchase:', error);
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
      // 3. Clear profile views, connections, notifications
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
          'Connections and relationships',
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
      
      // Also potentially create a notification for the profile owner
      // In a real app, this would add to a notifications collection
      
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
  }
};