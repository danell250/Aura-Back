import { Request, Response } from 'express';

// Mock data - in production this would come from database
const mockUsers = [
  {
    id: '1',
    firstName: 'James',
    lastName: 'Mitchell',
    name: 'James Mitchell',
    handle: '@jamesmitchell',
    avatar: 'https://picsum.photos/id/64/150/150',
    acquaintances: ['2', '3', '4', '6', '7', '8', '9', '10', '11', '12'],
    email: 'james@leadership.io',
    dob: '1985-03-15',
    blockedUsers: [],
    trustScore: 98,
    auraCredits: 0,
    activeGlow: 'emerald',
    bio: 'CEO at Global Leadership Institute. Author of "The Adaptive Leader". Helping executives navigate complexity.',
    zodiacSign: 'Pisces ♓'
  },
  {
    id: '2',
    firstName: 'Sarah',
    lastName: 'Williams',
    name: 'Sarah Williams',
    handle: '@sarahwilliams',
    avatar: 'https://picsum.photos/id/65/150/150',
    acquaintances: ['1', '3', '5', '9', '11', '13', '14', '15'],
    email: 'sarah@careergrowth.com',
    dob: '1988-07-22',
    blockedUsers: [],
    trustScore: 95,
    auraCredits: 0,
    activeGlow: 'none',
    bio: 'Executive Career Coach. 15+ years helping professionals unlock their potential. TEDx speaker.',
    zodiacSign: 'Cancer ♋'
  }
];

export const usersController = {
  // GET /api/users - Get all users
  getAllUsers: async (req: Request, res: Response) => {
    try {
      // In production, this would query the database
      res.json({
        success: true,
        data: mockUsers,
        count: mockUsers.length
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
      const user = mockUsers.find(u => u.id === id);
      
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

      // Check if user already exists
      const existingUser = mockUsers.find(u => u.email === userData.email);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'User already exists',
          message: 'A user with this email already exists'
        });
      }

      // Create new user
      const newUser = {
        id: `user-${Date.now()}`,
        firstName: userData.firstName,
        lastName: userData.lastName,
        name: `${userData.firstName} ${userData.lastName}`,
        handle: userData.handle || `@${userData.firstName.toLowerCase()}${userData.lastName.toLowerCase()}`,
        avatar: userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userData.firstName}`,
        email: userData.email,
        bio: userData.bio || '',
        dob: userData.dob || '',
        acquaintances: [],
        blockedUsers: [],
        trustScore: 10,
        auraCredits: 50,
        activeGlow: 'none',
        ...userData
      };

      // In production, save to database
      mockUsers.push(newUser);

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
      
      const userIndex = mockUsers.findIndex(u => u.id === id);
      if (userIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // Update user
      mockUsers[userIndex] = { ...mockUsers[userIndex], ...updates };

      res.json({
        success: true,
        data: mockUsers[userIndex],
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
      
      const userIndex = mockUsers.findIndex(u => u.id === id);
      if (userIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: `User with ID ${id} does not exist`
        });
      }

      // Remove user
      mockUsers.splice(userIndex, 1);

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
  }
};