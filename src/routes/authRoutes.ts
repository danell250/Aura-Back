import { Router, Request, Response } from 'express';
import passport from 'passport';
import { getDB } from '../db';
import { generateToken } from '../utils/jwtUtils';

const router = Router();

// Google OAuth routes - Fresh JWT version
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
        
        let finalUser: any;
        
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
          finalUser = { ...existingUser, ...userData };
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
          finalUser = newUser;
          console.log('Created new user after OAuth:', newUser.id);
        }
      
        // Generate JWT token
        const token = generateToken(finalUser);
        
        // Redirect to frontend with token
        // Use the referer host if available, otherwise use environment variable, fallback to production URL
        const referer = req.get('referer');
        let frontendUrl = process.env.VITE_FRONTEND_URL || 'https://auraradiance.vercel.app';
        
        // Check if we're in development and coming from localhost
        if (referer && referer.includes('localhost')) {
          frontendUrl = 'http://localhost:5001'; // Updated to match the actual dev server port
        } else if (referer && referer.includes('192.168.')) {
          // For local network access
          const refererUrl = new URL(referer);
          frontendUrl = `${refererUrl.protocol}//${refererUrl.host}`;
        }
        
        // Append the token to the URL as a query parameter
        const redirectUrl = `${frontendUrl}?token=${token}`;
        res.redirect(redirectUrl);
      }
    } catch (error) {
      console.error('Error in OAuth callback:', error);
      res.redirect('/login?error=oauth_failed');
    }
  }
);



// Logout route - JWT version (just clears client-side token)
router.post('/logout', (req: Request, res: Response) => {
  // For JWT, logout is typically handled client-side by clearing the token
  // But we can still invalidate sessions if they exist
  req.logout((err) => {
    if (err) {
      console.error('Error during logout:', err);
    }
  });
  
  req.session?.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
  });
  
  res.json({ 
    success: true, 
    message: 'Logged out successfully' 
  });
});

// Get current user info - JWT version
router.get('/user', (req: Request, res: Response) => {
  if (req.user) {
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

// Check authentication status - JWT version
router.get('/status', (req: Request, res: Response) => {
  const isAuthenticated = !!req.user;
  res.json({
    success: true,
    authenticated: isAuthenticated,
    user: isAuthenticated ? req.user : null
  });
});

// Manual login endpoint (for email/password authentication) - JWT version
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
    
    // Generate JWT token
    const token = generateToken(user as any);
    
    res.json({
      success: true,
      user: user,
      token: token, // Include token in response
      message: 'Login successful'
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

// Manual registration endpoint - JWT version
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
      avatarType: 'image' as const,
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
    
    // Generate JWT token
    const token = generateToken(newUser as any);
    
    res.status(201).json({
      success: true,
      user: newUser,
      token: token, // Include token in response
      message: 'Registration successful'
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