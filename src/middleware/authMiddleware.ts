import { Request, Response, NextFunction } from 'express';
import { getDB } from '../db';
import { User } from '../types';
import admin from '../firebaseAdmin';
import { verifyAccessToken } from '../utils/jwtUtils';

// Middleware to check if user is authenticated via JWT or Firebase
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  // 1. Check JWT Token (Cookie or Header)
  let token = null;
  
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    const decoded = verifyAccessToken(token);
    
    if (decoded) {
      try {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: decoded.id });
        
        if (user) {
          req.user = user as unknown as User;
          req.isAuthenticated = (() => true) as any;
          return next();
        }
      } catch (error) {
        console.error('Error retrieving user from database:', error);
      }
    }
    
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      message: 'The provided token is invalid or expired'
    });
  }
  
  // 2. Check Session Auth (fallback)
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  // 3. Check Bearer Token (Firebase) - only if not handled by our JWT
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const firebaseToken = authHeader.split(' ')[1];
    
    try {
      // Verify Firebase token using Admin SDK
      const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
      
      // Token is valid, ensure user is attached
      if (!req.user) {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: decodedToken.uid });
        
        if (user) {
          req.user = user as unknown as User;
        } else {
          // User authenticated but not in DB yet
          req.user = {
            id: decodedToken.uid,
            email: decodedToken.email,
            // Add other required fields with defaults
            name: decodedToken.name || 'User',
            handle: decodedToken.uid.substring(0, 8),
            firstName: 'User',
            lastName: '',
            trustScore: 10,
            auraCredits: 0
          } as any;
        }
      }
      
      // Mock isAuthenticated for compatibility
      req.isAuthenticated = (() => true) as any;
      return next();
    } catch (error) {
      console.error('Error verifying Firebase token:', error);
      // Fall through to 401
    }
  }
  
  res.status(401).json({
    success: false,
    error: 'Authentication required',
    message: 'Please log in to access this resource'
  });
};

// Middleware to check if user is authenticated (optional - doesn't block)
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  // Try JWT first
  let token = null;
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  
  if (token) {
    const decoded = verifyAccessToken(token);
    
    if (decoded) {
      try {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: decoded.id });
        
        if (user) {
          req.user = user as unknown as User;
          req.isAuthenticated = (() => true) as any;
        }
      } catch (error) {
        console.error('Error retrieving user from database in optional auth:', error);
      }
    }
  }

  // Check if already authenticated via session
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  // Try to authenticate via Bearer token (Firebase) if not already authenticated
  if (!req.user && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    const firebaseToken = req.headers.authorization.split(' ')[1];
    
    try {
      const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
      
      if (decodedToken) {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: decodedToken.uid });
        
        if (user) {
          req.user = user as unknown as User;
          req.isAuthenticated = (() => true) as any;
        }
      }
    } catch (e) {
      // Ignore errors in optional auth
    }
  }
  
  next();
};

// Middleware to get user data from JWT and attach to request
export const attachUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. JWT Token Auth
    let token = null;
    if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
      
    if (token) {
      const decoded = verifyAccessToken(token);
      
      if (decoded) {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: decoded.id });
        
        if (user) {
          req.user = {
            ...user,
            id: user.id
          } as unknown as User;
          
          req.isAuthenticated = (() => true) as any;
        }
      }
    }

    // 2. Session Auth (fallback)
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      // If we have a session user, try to get full user data from database
      const db = getDB();
      const userId = (req.user as any).id;
      
      if (userId) {
        const user = await db.collection('users').findOne({ id: userId });
        if (user) {
          req.user = {
            ...user,
            id: user.id
          } as unknown as User;
        }
      }
      return next();
    }

    // 3. Bearer Token Auth (Firebase) - if not already handled
    if (!req.user && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const firebaseToken = req.headers.authorization.split(' ')[1];
      
      try {
        const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
        
        if (decodedToken) {
          const db = getDB();
          const user = await db.collection('users').findOne({ id: decodedToken.uid });
          
          if (user) {
            req.user = {
              ...user,
              id: user.id
            } as unknown as User;
          } else {
            // Minimal user object from token
            req.user = {
              id: decodedToken.uid,
              email: decodedToken.email
            } as any;
          }
          
          // Mock isAuthenticated
          req.isAuthenticated = (() => true) as any;
        }
      } catch (e) {
        // console.warn('Failed to verify token in attachUser:', e);
      }
    }

    // 4. Simple User ID Auth (for manually registered users)
    const userIdHeader = req.headers['x-user-id'] as string;
    if (userIdHeader && !req.user) {
      try {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: userIdHeader });
        
        if (user) {
          req.user = {
            ...user,
            id: user.id
          } as unknown as User;
          
          // Mock isAuthenticated
          req.isAuthenticated = (() => true) as any;
        }
      } catch (e) {
        console.warn('Failed to get user by ID in attachUser:', e);
      }
    }
    
    next();
  } catch (error) {
    console.error('Error attaching user data:', error);
    next(); // Continue without user data
  }
};

// Middleware to validate user owns resource
export const requireOwnership = (userIdParam: string = 'id') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please log in to access this resource'
      });
    }
    
    const resourceUserId = req.params[userIdParam];
    const currentUserId = (req.user as User).id;
    
    if (resourceUserId !== currentUserId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You can only access your own resources'
      });
    }
    
    next();
  };
};

// Middleware to check if user has admin privileges
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please log in to access this resource'
    });
  }

  const user = req.user as User;
  if (!user.isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
      message: 'You need admin privileges to access this resource'
    });
  }

  next();
};
