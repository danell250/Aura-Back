import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { getDB } from '../db';
import { User } from '../types';
import crypto from 'crypto';

const getRequiredJwtSecret = (envName: 'JWT_SECRET' | 'REFRESH_TOKEN_SECRET'): Secret => {
  const configured = process.env[envName];
  if (configured && configured.trim().length > 0) {
    return configured;
  }

  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  if (isProduction) {
    throw new Error(`${envName} is required in production`);
  }

  const ephemeral = crypto.randomBytes(32).toString('hex');
  console.warn(`[jwtUtils] ${envName} is not set. Using an ephemeral runtime secret for development only.`);
  return ephemeral;
};

const JWT_SECRET: Secret = getRequiredJwtSecret('JWT_SECRET');
const REFRESH_TOKEN_SECRET: Secret = getRequiredJwtSecret('REFRESH_TOKEN_SECRET');

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

// Shared Cookie Options
const getCookieOptions = (isProduction: boolean): any => {
  const options: any = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/'
  };

  // Only set domain if explicitly configured
  if (process.env.COOKIE_DOMAIN) {
    options.domain = process.env.COOKIE_DOMAIN;
  }

  return options;
};

// Set Token Cookies
export const setTokenCookies = (res: Response, accessToken: string, refreshToken: string) => {
  // Treat as production if NODE_ENV is production OR if running on Render
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  const options = getCookieOptions(isProduction);
  
  // Access Token Cookie
  res.cookie('accessToken', accessToken, {
    ...options,
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  // Refresh Token Cookie
  res.cookie('refreshToken', refreshToken, {
    ...options,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

// Clear Token Cookies
export const clearTokenCookies = (res: Response) => {
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  const options = getCookieOptions(isProduction);
  
  res.clearCookie('accessToken', options);
  res.clearCookie('refreshToken', options);
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
