import { Router, Request, Response } from 'express';
import passport from 'passport';
import { getDB } from '../db';
import { requireAuth, attachUser } from '../middleware/authMiddleware';

const router = Router();

// Google OAuth routes
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  async (req: Request, res: Response) => {
    try {
      // Save or update user in database after successful OAuth
      if (req.user) {
        const db = getDB();
        const userData = req.user as any;
        
        // Check if user exists
        const existingUser = await db.collection('users').findOne({ 
          $or: [
            { id: userData.id },
            { googleId: userData.googleId },
            { email: userData.email }
          ]
        });
        
        if (existingUser) {
          // Update existing user
          await db.collection('users').updateOne(
            { id: existingUser.id },
            { 
              $set: {
                ...userData,
                lastLogin: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            }
          );
          console.log('Updated existing user after OAuth:', existingUser.id);
        } else {
          // Create new user
          const newUser = {
            ...userData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            auraCredits: 100, // Welcome credits
            trustScore: 10,
            activeGlow: 'none',
            acquaintances: [],
            blockedUsers: []
          };
          
          await db.collection('users').insertOne(newUser);
          console.log('Created new user after OAuth:', newUser.id);
        }
      
      // Successful authentication, redirect to frontend
      const frontendUrl = process.env.VITE_FRONTEND_URL || 'https://auraradiance.vercel.app';
      res.redirect(frontendUrl);
      }
    } catch (error) {
      console.error('Error in OAuth callback:', error);
      res.redirect('/login?error=oauth_failed');
    }
  }
);

// Logout route
router.post('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      console.error('Error during logout:', err);
      return res.status(500).json({
        success: false,
        error: 'Logout failed',
        message: 'An error occurred during logout'
      });
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
        return res.status(500).json({
          success: false,
          error: 'Session cleanup failed',
          message: 'An error occurred cleaning up session'
        });
      }
      
      res.json({ 
        success: true, 
        message: 'Logged out successfully' 
      });
    });
  });
});

// Get current user info
router.get('/user', attachUser, (req: Request, res: Response) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    res.json({ 
      success: true,
      user: req.user,
      authenticated: true
    });
  } else {
    res.status(401).json({ 
      success: false,
      error: 'Not authenticated',
      authenticated: false
    });
  }
});

// Check authentication status
router.get('/status', (req: Request, res: Response) => {
  const isAuthenticated = req.isAuthenticated && req.isAuthenticated();
  res.json({
    success: true,
    authenticated: isAuthenticated,
    user: isAuthenticated ? req.user : null
  });
});

// Manual login endpoint (for email/password authentication)
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body;
    
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
        message: 'Email/username and password are required'
      });
    }
    
    const db = getDB();
    const normalizedIdentifier = identifier.toLowerCase().trim();
    
    // Find user by email or handle
    const user = await db.collection('users').findOne({
      $or: [
        { email: normalizedIdentifier },
        { handle: normalizedIdentifier }
      ]
    });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'User not found'
      });
    }
    
    // In production, you would verify the password hash here
    // For now, we'll accept any password for demo purposes
    // TODO: Implement proper password hashing with bcrypt
    
    // Update last login
    await db.collection('users').updateOne(
      { id: user.id },
      { 
        $set: { 
          lastLogin: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    );
    
    // Create session
    req.login(user, (err) => {
      if (err) {
        console.error('Error creating session:', err);
        return res.status(500).json({
          success: false,
          error: 'Session creation failed',
          message: 'Failed to create user session'
        });
      }
      
      res.json({
        success: true,
        user: user,
        message: 'Login successful'
      });
    });
    
  } catch (error) {
    console.error('Error in manual login:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      message: 'Internal server error'
    });
  }
});

// Manual registration endpoint
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, dob, password } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'firstName, lastName, email, and password are required'
      });
    }
    
    const db = getDB();
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if user already exists
    const existingUser = await db.collection('users').findOne({
      email: normalizedEmail
    });
    
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User already exists',
        message: 'An account with this email already exists'
      });
    }
    
    // Create new user
    const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const handle = `@${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s+/g, '')}${Math.floor(Math.random() * 10000)}`;
    
    const newUser = {
      id: userId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      email: normalizedEmail,
      phone: phone?.trim() || '',
      dob: dob || '',
      handle: handle,
      bio: 'New to Aura',
      industry: 'Other',
      companyName: '',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
      avatarType: 'image',
      acquaintances: [],
      blockedUsers: [],
      trustScore: 10,
      auraCredits: 100,
      activeGlow: 'none',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
      // TODO: Hash password with bcrypt before storing
      // passwordHash: await bcrypt.hash(password, 10)
    };
    
    await db.collection('users').insertOne(newUser);
    
    // Create session for new user
    req.login(newUser, (err) => {
      if (err) {
        console.error('Error creating session for new user:', err);
        return res.status(500).json({
          success: false,
          error: 'Registration successful but session creation failed',
          message: 'Please try logging in manually'
        });
      }
      
      res.status(201).json({
        success: true,
        user: newUser,
        message: 'Registration successful'
      });
    });
    
  } catch (error) {
    console.error('Error in registration:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      message: 'Internal server error'
    });
  }
});

export default router;