import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { getDB } from '../db';
import { User } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_for_dev';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // 7 days by default
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'fallback_refresh_secret_for_dev';

// Generate JWT token
export const generateToken = (user: User): string => {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name
  };
  
  const options = { expiresIn: JWT_EXPIRES_IN };
  
  return jwt.sign(payload, JWT_SECRET, options as jwt.SignOptions);
};

// Generate refresh token
export const generateRefreshToken = (user: User): string => {
  const payload = {
    id: user.id,
    email: user.email
  };
  
  // Refresh token expires in 30 days
  const options = { expiresIn: '30d' };
  
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, options as jwt.SignOptions);
};

// Verify JWT token
export const verifyToken = (token: string): { id: string; email: string; name: string } | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; name: string };
    return decoded;
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
};

// Verify refresh token
export const verifyRefreshToken = (token: string): { id: string; email: string } | null => {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET) as { id: string; email: string };
    return decoded;
  } catch (error) {
    console.error('Refresh token verification error:', error);
    return null;
  }
};

// Middleware to protect routes with JWT
export const authenticateJWT = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please provide a valid authorization token'
    });
  }

  const token = authHeader.split(' ')[1]; // Extract token after "Bearer "
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(403).json({
      success: false,
      error: 'Invalid token',
      message: 'The provided token is invalid or expired'
    });
  }

  // Attach user to request
  try {
    const db = getDB();
    const user = await db.collection('users').findOne({ id: decoded.id });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
        message: 'The user associated with this token does not exist'
      });
    }

    (req as any).user = user;
    (req as any).isAuthenticated = () => true;
    
    next();
  } catch (error) {
    console.error('Error retrieving user from database:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'An error occurred while verifying your authentication'
    });
  }
};

// Optional authentication middleware
export const optionalAuthJWT = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (decoded) {
      try {
        const db = getDB();
        const user = await db.collection('users').findOne({ id: decoded.id });
        
        if (user) {
          (req as any).user = user;
          (req as any).isAuthenticated = () => true;
        }
      } catch (error) {
        console.error('Error retrieving user from database in optional auth:', error);
      }
    }
  }
  
  next();
};