import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { getDB } from '../db';
import { User } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_for_dev';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // 7 days by default

// Generate JWT token
export const generateToken = (user: User): string => {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    iat: Math.floor(Date.now() / 1000), // issued at time
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // expires in 7 days
  };

  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
};

// Verify JWT token
export const verifyToken = (token: string): { id: string; email: string; name: string } | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { id: string; email: string; name: string };
    return decoded;
  } catch (error) {
    console.error('JWT verification error:', error);
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