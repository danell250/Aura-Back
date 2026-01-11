import { Request, Response, NextFunction } from 'express';
import { getDB } from '../db';
import { User } from '../types';
import admin from 'firebase-admin';

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.warn('Failed to initialize Firebase Admin (check .env):', error);
  }
}

// Middleware to check if user is authenticated via session or Bearer token
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  // 1. Check Session Auth
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  // 2. Check Bearer Token (Firebase)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    
    try {
      // Verify Firebase token using Admin SDK
      const decodedToken = await admin.auth().verifyIdToken(token);
      
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
  // Check if already authenticated via session
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  // Try to authenticate via Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      
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

// Middleware to get user data from session and attach to request
export const attachUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Session Auth
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

    // 2. Bearer Token Auth
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        
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
        console.warn('Failed to verify token in attachUser:', e);
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