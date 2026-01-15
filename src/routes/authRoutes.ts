import { Router, Request, Response } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { getDB } from '../db';
import { requireAuth, attachUser } from '../middleware/authMiddleware';
import { 
  generateAccessToken, 
  generateRefreshToken, 
  setTokenCookies, 
  clearTokenCookies, 
  verifyRefreshToken 
} from '../utils/jwtUtils';
import { logSecurityEvent } from '../utils/securityLogger';
import { User } from '../types';

const router = Router();

const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      req,
      type: 'rate_limit_triggered',
      route: '/login',
      metadata: {
        key: 'login',
        max: 5,
        windowMs: 60 * 1000
      }
    });

    res.status(429).json({
      success: false,
      error: 'Too many login attempts',
      message: 'Too many login attempts, please try again in a minute'
    });
  }
});

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
        
        let userToReturn: User;

        if (existingUser) {
          // Preserve immutable fields like handle; only update mutable profile fields and timestamps
          const preservedHandle = existingUser.handle;
          const updates: any = {
            // only update selected fields from OAuth
            firstName: userData.firstName,
            lastName: userData.lastName,
            name: userData.name,
            email: userData.email,
            avatar: userData.avatar,
            avatarType: userData.avatarType,
            googleId: userData.googleId,
            lastLogin: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          // Ensure handle never changes once assigned
          updates.handle = preservedHandle || existingUser.handle || userData.handle;

          await db.collection('users').updateOne(
            { id: existingUser.id },
            { $set: updates }
          );
          console.log('Updated existing user after OAuth:', existingUser.id);
          userToReturn = { ...existingUser, ...updates } as User;
        } else {
          // Create new user; generate and persist a handle once
          const newUser = {
            ...userData,
            handle: userData.handle, // assigned once here
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            auraCredits: 100, // Welcome credits
            trustScore: 10,
            activeGlow: 'none',
            acquaintances: [],
            blockedUsers: [],
            refreshTokens: []
          };
          
          await db.collection('users').insertOne(newUser);
          console.log('Created new user after OAuth:', newUser.id);
          userToReturn = newUser as User;
        }
      
        // Generate Tokens
        const accessToken = generateAccessToken(userToReturn);
        const refreshToken = generateRefreshToken(userToReturn);

        // Store Refresh Token in DB
        await db.collection('users').updateOne(
          { id: userToReturn.id },
          { 
            $push: { refreshTokens: refreshToken } as any
          }
        );

        // Set Cookies
        setTokenCookies(res, accessToken, refreshToken);

        // Successful authentication, redirect to frontend (cookies carry auth)
        const frontendUrl = process.env.VITE_FRONTEND_URL ||
          (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://auraradiance.vercel.app');
        
        console.log('[OAuth] Redirecting to:', `${frontendUrl}/feed`);
        res.redirect(`${frontendUrl}/feed`);
      }
    } catch (error) {
      console.error('Error in OAuth callback:', error);
      res.redirect('/login?error=oauth_failed');
    }
  }
);

// Refresh Token Endpoint
router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      logSecurityEvent({
        req,
        type: 'refresh_failed',
        metadata: {
          reason: 'missing_token'
        }
      });
      return res.status(401).json({ 
        success: false, 
        error: 'Refresh token required',
        message: 'Please log in again' 
      });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      clearTokenCookies(res);
      logSecurityEvent({
        req,
        type: 'refresh_failed',
        metadata: {
          reason: 'invalid_or_expired_token'
        }
      });
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid refresh token',
        message: 'Session expired, please log in again' 
      });
    }

    const db = getDB();
    const user = await db.collection('users').findOne({ id: decoded.id }) as unknown as User;

    if (!user || !user.refreshTokens || !user.refreshTokens.includes(refreshToken)) {
      clearTokenCookies(res);
      logSecurityEvent({
        req,
        type: 'refresh_failed',
        userId: decoded.id,
        metadata: {
          reason: 'token_not_found_for_user'
        }
      });
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid refresh token',
        message: 'Session invalid' 
      });
    }

    // Token Rotation: Remove old, add new
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    await db.collection('users').updateOne(
      { id: user.id },
      { 
        $pull: { refreshTokens: refreshToken } as any,
      }
    );
    
    await db.collection('users').updateOne(
        { id: user.id },
        {
            $push: { refreshTokens: newRefreshToken } as any
        }
    );

    setTokenCookies(res, newAccessToken, newRefreshToken);

    logSecurityEvent({
      req,
      type: 'refresh_success',
      userId: user.id
    });

    res.json({
      success: true,
      accessToken: newAccessToken, // Client might update memory state
      message: 'Token refreshed successfully'
    });

  } catch (error) {
    console.error('Error refreshing token:', error);
    clearTokenCookies(res);
    logSecurityEvent({
      req,
      type: 'refresh_failed',
      metadata: {
        reason: 'exception',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
    res.status(500).json({ 
      success: false, 
      error: 'Refresh failed',
      message: 'Internal server error' 
    });
  }
});

// Get current authenticated user (JWT or session)
router.get('/user', requireAuth, (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }
  res.json({
    success: true,
    user
  });
});

// Logout route
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (refreshToken) {
      const db = getDB();
      // Try to find user with this refresh token and remove it
      // Since we don't have user ID in request guaranteed if token expired, we search by token
      // But efficiently we might need ID. Let's try verify first.
      const decoded = verifyRefreshToken(refreshToken);
      if (decoded) {
        await db.collection('users').updateOne(
          { id: decoded.id },
          { $pull: { refreshTokens: refreshToken } as any }
        );
      }
    }

    clearTokenCookies(res);

    req.logout((err) => {
      if (err) {
        console.error('Error during passport logout:', err);
      }
      
      req.session.destroy((err) => {
        if (err) {
          console.error('Error destroying session:', err);
        }
        res.json({ 
          success: true, 
          message: 'Logged out successfully' 
        });
      });
    });
  } catch (error) {
    console.error('Error in logout:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Logout error',
      message: 'Internal server error' 
    });
  }
});

// Get current user info
router.get('/user', attachUser, (req: Request, res: Response) => {
  if ((req as any).user) {
    res.json({ 
      success: true,
      user: (req as any).user,
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
router.get('/status', attachUser, (req: Request, res: Response) => {
  const isAuthenticated = !!(req as any).user;
  res.json({
    success: true,
    authenticated: isAuthenticated,
    user: isAuthenticated ? (req as any).user : null
  });
});

router.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body;
    
    if (!identifier || !password) {
      logSecurityEvent({
        req,
        type: 'login_failed',
        identifier,
        metadata: {
          reason: 'missing_credentials'
        }
      });
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
        message: 'Email/username and password are required'
      });
    }
    
    const db = getDB();
    const normalizedIdentifier = identifier.toLowerCase().trim();
    
    const user = await db.collection('users').findOne({
      $or: [
        { email: normalizedIdentifier },
        { handle: normalizedIdentifier }
      ]
    }) as unknown as User;
    
    if (!user) {
      logSecurityEvent({
        req,
        type: 'login_failed',
        identifier: normalizedIdentifier,
        metadata: {
          reason: 'user_not_found'
        }
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'User not found'
      });
    }
    
    if (!user.passwordHash) {
      logSecurityEvent({
        req,
        type: 'login_failed',
        userId: user.id,
        identifier: normalizedIdentifier,
        metadata: {
          reason: 'no_password_hash'
        }
      });
       return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Please log in with Google or reset your password'
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValidPassword) {
      logSecurityEvent({
        req,
        type: 'login_failed',
        userId: user.id,
        identifier: normalizedIdentifier,
        metadata: {
          reason: 'invalid_password'
        }
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Invalid password'
      });
    }
    
    await db.collection('users').updateOne(
      { id: user.id },
      { 
        $set: { 
          lastLogin: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    );
    
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await db.collection('users').updateOne(
      { id: user.id },
      { $push: { refreshTokens: refreshToken } as any }
    );

    setTokenCookies(res, accessToken, refreshToken);

    req.login(user, (err) => {
      if (err) {
        console.error('Error creating session:', err);
      }

      logSecurityEvent({
        req,
        type: 'login_success',
        userId: user.id,
        identifier: normalizedIdentifier
      });
      
      res.json({
        success: true,
        user: user,
        token: accessToken, // Return access token for immediate use if needed
        message: 'Login successful'
      });
    });
    
  } catch (error) {
    console.error('Error in manual login:', error);
    logSecurityEvent({
      req,
      type: 'login_failed',
      identifier: req.body?.identifier,
      metadata: {
        reason: 'exception',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
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

    // Hash Password
    const passwordHash = await bcrypt.hash(password, 10);
    
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
      lastLogin: new Date().toISOString(),
      passwordHash: passwordHash, // Store hashed password
      refreshTokens: []
    };
    
    await db.collection('users').insertOne(newUser);

    // Generate Tokens
    const accessToken = generateAccessToken(newUser as unknown as User);
    const refreshToken = generateRefreshToken(newUser as unknown as User);

    // Store Refresh Token
    await db.collection('users').updateOne(
      { id: newUser.id },
      { $push: { refreshTokens: refreshToken } as any }
    );

    // Set Cookies
    setTokenCookies(res, accessToken, refreshToken);
    
    // Create session for new user
    req.login(newUser, (err) => {
      if (err) {
        console.error('Error creating session for new user:', err);
      }
      
      res.status(201).json({
        success: true,
        user: newUser,
        token: accessToken,
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
