import { Router, Request, Response } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
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
import { generateMagicToken, hashToken } from '../utils/tokenUtils';
import { sendMagicLinkEmail } from '../services/emailService';
import { logSecurityEvent } from '../utils/securityLogger';
import { transformUser } from '../utils/userUtils';
import { User } from '../types';

const router = Router();

const normalizeUserHandle = (rawHandle: string): string => {
  const base = (rawHandle || '').trim().toLowerCase();
  const withoutAt = base.startsWith('@') ? base.slice(1) : base;
  const cleaned = withoutAt.replace(/[^a-z0-9_-]/g, '');
  if (!cleaned) return '';
  return `@${cleaned}`;
};

const validateHandleFormat = (handle: string): { ok: boolean; message?: string } => {
  const normalized = normalizeUserHandle(handle);
  if (!normalized) {
    return { ok: false, message: 'Handle is required' };
  }
  const core = normalized.slice(1);
  if (core.length < 3 || core.length > 21) {
    return { ok: false, message: 'Handle must be between 3 and 21 characters' };
  }
  if (!/^[a-z0-9_-]+$/.test(core)) {
    return { ok: false, message: 'Handle can only use letters, numbers, underscores and hyphens' };
  }
  return { ok: true };
};

const generateUniqueHandle = async (firstName: string, lastName: string): Promise<string> => {
  const db = getDB();

  const firstNameSafe = (firstName || 'user').toLowerCase().trim().replace(/\s+/g, '');
  const lastNameSafe = (lastName || '').toLowerCase().trim().replace(/\s+/g, '');

  const baseHandle = `@${firstNameSafe}${lastNameSafe}`;

  try {
    let existingUser = await db.collection('users').findOne({ handle: baseHandle });
    if (!existingUser) {
      console.log('✓ Handle available:', baseHandle);
      return baseHandle;
    }
  } catch (error) {
    console.error('Error checking base handle:', error);
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const randomNum = Math.floor(Math.random() * 100000);
    const candidateHandle = `${baseHandle}${randomNum}`;

    try {
      const existingUser = await db.collection('users').findOne({ handle: candidateHandle });
      if (!existingUser) {
        console.log('✓ Handle available:', candidateHandle);
        return candidateHandle;
      }
    } catch (error) {
      console.error(`Error checking handle ${candidateHandle}:`, error);
      continue;
    }
  }

  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 9);
  const fallbackHandle = `@user${timestamp}${randomStr}`;
  console.log('⚠ Using fallback handle:', fallbackHandle);
  return fallbackHandle;
};

router.post('/check-handle', async (req: Request, res: Response) => {
  try {
    const { handle } = req.body || {};

    const validation = validateHandleFormat(handle || '');
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        available: false,
        error: 'Invalid handle',
        message: validation.message || 'Invalid handle'
      });
    }

    const normalizedHandle = normalizeUserHandle(handle);
    const db = getDB();

    const existingUser = await db.collection('users').findOne({ handle: normalizedHandle });

    return res.json({
      success: true,
      available: !existingUser,
      handle: normalizedHandle
    });
  } catch (error) {
    console.error('Error checking handle availability:', error);
    return res.status(500).json({
      success: false,
      available: false,
      error: 'Handle check failed',
      message: 'Internal server error'
    });
  }
});

// ============ RATE LIMITER ============
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

// ============ GOOGLE OAUTH ============
router.get('/google',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({
        success: false,
        message: 'Google login is not configured on the server.'
      });
    }
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect('/login?error=google_not_configured');
    }
    next();
  },
  passport.authenticate('google', { failureRedirect: '/login' }),
  async (req: Request, res: Response) => {
    try {
      if (req.user) {
        const db = getDB();
        const userData = req.user as any;

        console.log('🔍 Google OAuth - Checking for existing user with ID:', userData.id);

        // FIX: Check by EMAIL to link accounts
        const existingUser = await db.collection('users').findOne({
          email: userData.email
        });

        let userToReturn: User;

        if (existingUser) {
          console.log('✓ Found existing user:', existingUser.id);
          // PRESERVE existing handle - NEVER change it
          const updates: any = {
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
          updates.handle = existingUser.handle; // CRITICAL: Keep original handle

          await db.collection('users').updateOne(
            { id: existingUser.id },
            { $set: updates }
          );
          console.log('✓ Updated existing user after OAuth:', existingUser.id, '| Handle preserved:', existingUser.handle);
          userToReturn = { ...existingUser, ...updates } as User;
        } else {
          console.log('➕ New user from Google OAuth');
          // NEW USER: Generate unique handle
          const uniqueHandle = await generateUniqueHandle(
            userData.firstName || 'User',
            userData.lastName || ''
          );

          const newUser = {
            ...userData,
            handle: uniqueHandle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            auraCredits: 100,
            trustScore: 10,
            activeGlow: 'none',
            acquaintances: [],
            blockedUsers: [],
            refreshTokens: []
          };

          await db.collection('users').insertOne(newUser);
          console.log('✓ Created new user after OAuth:', newUser.id, '| Handle:', uniqueHandle);
          userToReturn = newUser as User;
        }

        const accessToken = generateAccessToken(userToReturn);
        const refreshToken = generateRefreshToken(userToReturn);

        await db.collection('users').updateOne(
          { id: userToReturn.id },
          {
            $push: { refreshTokens: refreshToken } as any
          }
        );

        setTokenCookies(res, accessToken, refreshToken);

        const frontendUrl = process.env.VITE_FRONTEND_URL ||
          (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://www.aura.net.za');

        console.log('[OAuth] Redirecting to:', `${frontendUrl}/feed`);
        res.redirect(`${frontendUrl}/feed`);
      }
    } catch (error) {
      console.error('Error in OAuth callback:', error);
      res.redirect('/login?error=oauth_failed');
    }
  }
);

// ============ MAGIC LINK ============

router.post("/magic-link", async (req: Request, res: Response) => {
  console.log('🔹 POST /magic-link hit with body:', req.body);
  try {
    const { email } = req.body || {};
    if (!email) {
      console.log('❌ Email missing in request body');
      return res.status(400).json({ success: false, message: "Email is required" });
    }
    const db = getDB();
    const normalizedEmail = String(email).toLowerCase().trim();
    console.log('🔍 Searching for user:', normalizedEmail);
    let user = await db.collection("users").findOne({ email: normalizedEmail });
    
    // Create user if not exists (Sign Up via Magic Link)
    if (!user) {
      console.log('➕ User not found. Creating new user for email:', normalizedEmail);
      const firstName = normalizedEmail.split('@')[0];
      const uniqueHandle = await generateUniqueHandle(firstName, '');
      
      const newUser = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        firstName: firstName,
        lastName: '',
        name: firstName,
        handle: uniqueHandle,
        avatar: `https://ui-avatars.com/api/?name=${firstName}&background=random`,
        avatarType: 'url',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        auraCredits: 100,
        trustScore: 10,
        activeGlow: 'none',
        acquaintances: [],
        blockedUsers: [],
        refreshTokens: []
      };
      
      await db.collection("users").insertOne(newUser);
      user = newUser as any;
      console.log('✓ Created new user for magic link:', user!.id);
    } else {
      console.log('✅ User found:', user!.id);
    }

    const token = generateMagicToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await db.collection("users").updateOne(
      { id: user!.id },
      {
        $set: {
          magicLinkTokenHash: tokenHash,
          magicLinkExpiresAt: expiresAt.toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    );

    const frontendUrl = process.env.VITE_FRONTEND_URL || (process.env.NODE_ENV === "development" ? "http://localhost:5173" : "https://www.aura.net.za");
    const magicLink = `${frontendUrl}/magic-login?token=${token}&email=${encodeURIComponent(normalizedEmail)}`;
    
    console.log('📧 Attempting to send magic link email to:', normalizedEmail);
    await sendMagicLinkEmail(normalizedEmail, magicLink);
    console.log('✅ sendMagicLinkEmail completed');

    return res.json({ success: true, message: "If that email exists, a link was sent." });
  } catch (e: any) {
    console.error("❌ magic-link error:", e);
    return res.status(500).json({ 
      success: false, 
      message: e.message || "Internal server error" 
    });
  }
});

router.post("/magic-link/verify", async (req: Request, res: Response) => {
  try {
    const { email, token } = req.body || {};
    if (!email || !token) {
      return res.status(400).json({ success: false, message: "Email and token are required" });
    }

    const db = getDB();
    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await db.collection("users").findOne({ email: normalizedEmail }) as any;

    if (!user?.magicLinkTokenHash || !user?.magicLinkExpiresAt) {
      return res.status(401).json({ success: false, message: "Invalid or expired link" });
    }

    const expiresAt = new Date(user.magicLinkExpiresAt);
    if (Date.now() > expiresAt.getTime()) {
      return res.status(401).json({ success: false, message: "Link expired" });
    }

    const tokenHash = hashToken(String(token));
    if (tokenHash !== user.magicLinkTokenHash) {
      return res.status(401).json({ success: false, message: "Invalid or expired link" });
    }

    // one-time use
    await db.collection("users").updateOne(
      { id: user.id },
      { 
        $unset: { magicLinkTokenHash: "", magicLinkExpiresAt: "" },
        $set: { lastLogin: new Date().toISOString() }
      }
    );

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await db.collection("users").updateOne(
      { id: user.id },
      { $push: { refreshTokens: refreshToken } as any }
    );

    setTokenCookies(res, accessToken, refreshToken);
    
    return res.json({ success: true, user: transformUser(user), token: accessToken });
  } catch (e) {
    console.error("magic-link verify error:", e);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ============ REFRESH TOKEN ============
router.post('/refresh-token', async (req: Request, res: Response) => {
  console.log('🔄 POST /refresh-token hit');
  console.log('   - Cookies:', req.cookies);
  console.log('   - Origin:', req.headers.origin);
  
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      console.log('❌ No refresh token in cookies');
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
      accessToken: newAccessToken,
      user: transformUser(user),
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

// ============ GITHUB OAUTH ============
router.get('/github',
  (req, res, next) => {
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
      return res.status(503).json({
        success: false,
        message: 'GitHub login is not configured on the server.'
      });
    }
    next();
  },
  passport.authenticate('github', { scope: ['user:email'] })
);

router.get('/github/callback',
  (req, res, next) => {
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
      return res.redirect('/login?error=github_not_configured');
    }
    next();
  },
  passport.authenticate('github', { failureRedirect: '/login' }),
  async (req: Request, res: Response) => {
    try {
      if (req.user) {
        const db = getDB();
        const userData = req.user as any;

        console.log('🔍 GitHub OAuth - Checking for existing user with ID:', userData.id);

        // FIX: Check by EMAIL to link accounts
        const existingUser = await db.collection('users').findOne({
          email: userData.email
        });

        let userToReturn: User;

        if (existingUser) {
          console.log('✓ Found existing user:', existingUser.id);
          // PRESERVE existing handle - NEVER change it
          const updates: any = {
            firstName: userData.firstName,
            lastName: userData.lastName,
            name: userData.name,
            email: userData.email,
            avatar: userData.avatar,
            avatarType: userData.avatarType,
            githubId: userData.githubId,
            lastLogin: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updates.handle = existingUser.handle; // CRITICAL: Keep original handle

          await db.collection('users').updateOne(
            { id: existingUser.id },
            { $set: updates }
          );
          console.log('✓ Updated existing user after GitHub OAuth:', existingUser.id, '| Handle preserved:', existingUser.handle);
          userToReturn = { ...existingUser, ...updates } as User;
        } else {
          console.log('➕ New user from GitHub OAuth');
          // NEW USER: Generate unique handle
          const uniqueHandle = await generateUniqueHandle(
            userData.firstName || 'User',
            userData.lastName || ''
          );

          const newUser = {
            ...userData,
            handle: uniqueHandle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            auraCredits: 100,
            trustScore: 10,
            activeGlow: 'none',
            acquaintances: [],
            blockedUsers: [],
            refreshTokens: []
          };

          await db.collection('users').insertOne(newUser);
          console.log('✓ Created new user after GitHub OAuth:', newUser.id, '| Handle:', uniqueHandle);
          userToReturn = newUser as User;
        }

        const accessToken = generateAccessToken(userToReturn);
        const refreshToken = generateRefreshToken(userToReturn);

        await db.collection('users').updateOne(
          { id: userToReturn.id },
          {
            $push: { refreshTokens: refreshToken } as any
          }
        );

        setTokenCookies(res, accessToken, refreshToken);

        const frontendUrl = process.env.VITE_FRONTEND_URL ||
          (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://www.aura.net.za');

        console.log('[OAuth:GitHub] Redirecting to:', `${frontendUrl}/feed`);
        res.redirect(`${frontendUrl}/feed`);
      } else {
        res.redirect('/login');
      }
    } catch (error) {
      console.error('GitHub OAuth callback error:', error);
      res.redirect('/login');
    }
  }
);

// ============ GET CURRENT USER ============
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
    user: transformUser(user)
  });
});

// ============ LOGOUT ============
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const db = getDB();
      const decoded = verifyRefreshToken(refreshToken);
      if (decoded) {
        await db.collection('users').updateOne(
          { id: decoded.id },
          { 
            $pull: { refreshTokens: refreshToken } as any,
            $set: { lastActive: new Date().toISOString() }
          }
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

// ============ GET USER INFO (ATTACHUSER) ============
router.get('/user-info', attachUser, (req: Request, res: Response) => {
  if ((req as any).user) {
    res.json({
      success: true,
      user: transformUser((req as any).user),
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

// ============ CHECK AUTHENTICATION STATUS ============
router.get('/status', attachUser, (req: Request, res: Response) => {
  const isAuthenticated = !!(req as any).user;
  res.json({
    success: true,
    authenticated: isAuthenticated,
    user: isAuthenticated ? transformUser((req as any).user) : null
  });
});

// ============ LOGIN ============
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
        user: transformUser(user),
        token: accessToken,
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

// ============ COMPLETE OAUTH PROFILE ============
router.post('/complete-oauth-profile', async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, bio, industry, companyName, handle } = req.body;
    const tempOAuthData = (req.session as any)?.tempOAuthData;

    if (!tempOAuthData) {
      return res.status(400).json({
        success: false,
        error: 'Missing OAuth data',
        message: 'Session expired. Please log in again.'
      });
    }

    const db = getDB();

    const handleValidation = validateHandleFormat(handle);
    if (!handleValidation.ok) {
      return res.status(400).json({
        success: false,
        error: 'Invalid handle',
        message: handleValidation.message || 'Invalid handle'
      });
    }

    const normalizedHandle = normalizeUserHandle(handle);

    const existingHandleUser = await db.collection('users').findOne({ handle: normalizedHandle });
    if (existingHandleUser) {
      return res.status(409).json({
        success: false,
        error: 'Handle taken',
        message: 'This handle is already taken. Please try another one.'
      });
    }

    const newUser = {
      id: tempOAuthData.id,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      email: tempOAuthData.email,
      avatar: tempOAuthData.avatar,
      avatarType: tempOAuthData.avatarType || 'image',
      googleId: tempOAuthData.googleId,
      githubId: tempOAuthData.githubId,
      handle: normalizedHandle,
      bio: bio?.trim() || '',
      industry: industry || 'Other',
      companyName: companyName?.trim() || '',
      trustScore: 10,
      auraCredits: 100,
      activeGlow: 'none',
      acquaintances: [],
      blockedUsers: [],
      refreshTokens: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };

    await db.collection('users').insertOne(newUser);
    console.log('✓ Completed OAuth profile for new user:', newUser.id, '| Handle:', normalizedHandle);

    const accessToken = generateAccessToken(newUser as unknown as User);
    const refreshToken = generateRefreshToken(newUser as unknown as User);
    await db.collection('users').updateOne(
      { id: newUser.id },
      { $push: { refreshTokens: refreshToken } as any }
    );

    setTokenCookies(res, accessToken, refreshToken);
    (req.session as any).tempOAuthData = null;

    res.json({
      success: true,
      user: newUser,
      token: accessToken,
      message: 'Profile completed successfully'
    });
  } catch (error) {
    console.error('Error completing OAuth profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete profile',
      message: 'Internal server error'
    });
  }
});


router.post('/register', async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, dob, password, handle } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'firstName, lastName, email, and password are required'
      });
    }

    const db = getDB();
    const normalizedEmail = email.toLowerCase().trim();

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

    let normalizedHandle: string | null = null;

    if (handle) {
      const handleValidation = validateHandleFormat(handle);
      if (!handleValidation.ok) {
        return res.status(400).json({
          success: false,
          error: 'Invalid handle',
          message: handleValidation.message || 'Invalid handle'
        });
      }
      normalizedHandle = normalizeUserHandle(handle);

      const existingByHandle = await db.collection('users').findOne({ handle: normalizedHandle });
      if (existingByHandle) {
        return res.status(409).json({
          success: false,
          error: 'Handle taken',
          message: 'This handle is already taken. Please try another one.'
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const finalHandle = normalizedHandle || await generateUniqueHandle(firstName, lastName);

    const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newUser = {
      id: userId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      email: normalizedEmail,
      phone: phone?.trim() || '',
      handle: finalHandle,
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
      passwordHash: passwordHash,
      refreshTokens: []
    };

    await db.collection('users').insertOne(newUser);

    const accessToken = generateAccessToken(newUser as unknown as User);
    const refreshToken = generateRefreshToken(newUser as unknown as User);

    await db.collection('users').updateOne(
      { id: newUser.id },
      { $push: { refreshTokens: refreshToken } as any }
    );

    setTokenCookies(res, accessToken, refreshToken);

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
