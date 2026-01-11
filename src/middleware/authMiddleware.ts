import { Request, Response, NextFunction } from 'express';
import { getDB } from '../db';
import { User } from '../types';

// Helper to verify Firebase ID Token
const verifyFirebaseToken = async (token: string): Promise<{ uid: string; email: string } | null> => {
  try {
    // Verify token with Google's public endpoint
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    
    if (!response.ok) {
      console.warn('Token verification failed:', await response.text());
      return null;
    }
    
    const data = await response.json();
    return {
      uid: data.sub,
      email: data.email
    };
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return null;
  }
};

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
    const decoded = await verifyFirebaseToken(token);
    
    if (decoded) {
      // Token is valid, ensure user is attached
      if (!req.user) {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: decoded.uid });
        
        if (user) {
          req.user = user as unknown as User;
        } else {
          // User authenticated but not in DB yet (e.g. during creation/first sync)
          // Create a temporary user object with the ID from token
          req.user = {
            id: decoded.uid,
            email: decoded.email,
            // Add other required fields with defaults if necessary
          } as any;
        }
      }
      
      // Mock isAuthenticated for compatibility
      req.isAuthenticated = (() => true) as any;
      return next();
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
    const decoded = await verifyFirebaseToken(token);
    
    if (decoded) {
      const db = getDB();
      const user = await db.collection('users').findOne({ id: decoded.uid });
      
      if (user) {
        req.user = user as unknown as User;
        req.isAuthenticated = (() => true) as any;
      }
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
      const decoded = await verifyFirebaseToken(token);
      
      if (decoded) {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: decoded.uid });
        
        if (user) {
          req.user = {
            ...user,
            id: user.id
          } as unknown as User;
        } else {
          // Minimal user object from token
          req.user = {
            id: decoded.uid,
            email: decoded.email
          } as any;
        }
        
        // Mock isAuthenticated
        req.isAuthenticated = (() => true) as any;
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