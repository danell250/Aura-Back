import { Request, Response, NextFunction } from 'express';
import { getDB } from '../db';
import { User } from '../types';

// Middleware to check if user is authenticated via session
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  res.status(401).json({
    success: false,
    error: 'Authentication required',
    message: 'Please log in to access this resource'
  });
};

// Middleware to check if user is authenticated (optional - doesn't block)
export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
  // Just pass through - user info will be available if authenticated
  next();
};

// Middleware to get user data from session and attach to request
export const attachUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      // If we have a session user, try to get full user data from database
      const db = getDB();
      const userId = (req.user as any).id;
      
      if (userId) {
        const user = await db.collection('users').findOne({ id: userId });
        if (user) {
          // Convert MongoDB document to User type
          req.user = {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            name: user.name,
            handle: user.handle,
            avatar: user.avatar,
            avatarType: user.avatarType,
            bio: user.bio,
            email: user.email,
            phone: user.phone,
            trustScore: user.trustScore,
            auraCredits: user.auraCredits,
            activeGlow: user.activeGlow,
            acquaintances: user.acquaintances || [],
            blockedUsers: user.blockedUsers || [],
            isAdmin: user.isAdmin || false,
            ...user // Include any other fields
          } as User;
        }
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