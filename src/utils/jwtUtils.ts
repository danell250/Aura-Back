import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { getDB } from '../db';
import { User } from '../types';

const JWT_SECRET: Secret = process.env.JWT_SECRET || 'fallback_jwt_secret_for_dev';
const REFRESH_TOKEN_SECRET: Secret = process.env.REFRESH_TOKEN_SECRET || 'fallback_refresh_token_secret_for_dev';

const ACCESS_TOKEN_EXPIRES_IN = (process.env.ACCESS_TOKEN_EXPIRES_IN || '15m') as SignOptions['expiresIn'];
const REFRESH_TOKEN_EXPIRES_IN = (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d') as SignOptions['expiresIn'];

// Generate Access Token (Short-lived)
export const generateAccessToken = (user: User): string => {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    type: 'access'
  };

  return jwt.sign(payload, JWT_SECRET, { 
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_EXPIRES_IN
  });
};

// Generate Refresh Token (Long-lived)
export const generateRefreshToken = (user: User): string => {
  const payload = {
    id: user.id,
    type: 'refresh'
  };

  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { 
    algorithm: 'HS256',
    expiresIn: REFRESH_TOKEN_EXPIRES_IN
  });
};

// Verify Access Token
export const verifyAccessToken = (token: string): { id: string; email: string; name: string } | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as any;
    if (decoded.type !== 'access' && decoded.type !== undefined) return null; // Ensure it's an access token (or legacy token without type)
    return decoded;
  } catch (error) {
    // console.error('JWT verification error:', error);
    return null;
  }
};

// Verify Refresh Token
export const verifyRefreshToken = (token: string): { id: string } | null => {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET, { algorithms: ['HS256'] }) as any;
    if (decoded.type !== 'refresh') return null;
    return decoded;
  } catch (error) {
    console.error('Refresh token verification error:', error);
    return null;
  }
};

// Set Token Cookies
export const setTokenCookies = (res: Response, accessToken: string, refreshToken: string) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Access Token Cookie
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  // Refresh Token Cookie
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

// Clear Token Cookies
export const clearTokenCookies = (res: Response) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.clearCookie('accessToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  });

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  });
};

// Middleware to protect routes with JWT (Updated to check cookies)
export const authenticateJWT = async (req: Request, res: Response, next: NextFunction) => {
  let token = null;

  // 1. Check Cookies first
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }
  // 2. Check Authorization Header (fallback)
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please provide a valid authorization token'
    });
  }
  
  const decoded = verifyAccessToken(token);
  
  if (!decoded) {
    return res.status(401).json({
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
