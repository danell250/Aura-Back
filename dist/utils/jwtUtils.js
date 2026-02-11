"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateJWT = exports.clearTokenCookies = exports.setTokenCookies = exports.verifyRefreshToken = exports.verifyAccessToken = exports.generateRefreshToken = exports.generateAccessToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_for_dev';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'fallback_refresh_token_secret_for_dev';
const ACCESS_TOKEN_EXPIRES_IN = (process.env.ACCESS_TOKEN_EXPIRES_IN || '15m');
const REFRESH_TOKEN_EXPIRES_IN = (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d');
// Generate Access Token (Short-lived)
const generateAccessToken = (user) => {
    const payload = {
        id: user.id,
        email: user.email,
        name: user.name,
        type: 'access'
    };
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: ACCESS_TOKEN_EXPIRES_IN
    });
};
exports.generateAccessToken = generateAccessToken;
// Generate Refresh Token (Long-lived)
const generateRefreshToken = (user) => {
    const payload = {
        id: user.id,
        type: 'refresh'
    };
    return jsonwebtoken_1.default.sign(payload, REFRESH_TOKEN_SECRET, {
        algorithm: 'HS256',
        expiresIn: REFRESH_TOKEN_EXPIRES_IN
    });
};
exports.generateRefreshToken = generateRefreshToken;
// Verify Access Token
const verifyAccessToken = (token) => {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        if (decoded.type !== 'access' && decoded.type !== undefined)
            return null; // Ensure it's an access token (or legacy token without type)
        return decoded;
    }
    catch (error) {
        // console.error('JWT verification error:', error);
        return null;
    }
};
exports.verifyAccessToken = verifyAccessToken;
// Verify Refresh Token
const verifyRefreshToken = (token) => {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, REFRESH_TOKEN_SECRET, { algorithms: ['HS256'] });
        if (decoded.type !== 'refresh')
            return null;
        return decoded;
    }
    catch (error) {
        console.error('Refresh token verification error:', error);
        return null;
    }
};
exports.verifyRefreshToken = verifyRefreshToken;
// Shared Cookie Options
const getCookieOptions = (isProduction) => {
    const options = {
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
const setTokenCookies = (res, accessToken, refreshToken) => {
    // Treat as production if NODE_ENV is production OR if running on Render
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
    const options = getCookieOptions(isProduction);
    // Access Token Cookie
    res.cookie('accessToken', accessToken, Object.assign(Object.assign({}, options), { maxAge: 15 * 60 * 1000 // 15 minutes
     }));
    // Refresh Token Cookie
    res.cookie('refreshToken', refreshToken, Object.assign(Object.assign({}, options), { maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
     }));
};
exports.setTokenCookies = setTokenCookies;
// Clear Token Cookies
const clearTokenCookies = (res) => {
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
    const options = getCookieOptions(isProduction);
    res.clearCookie('accessToken', options);
    res.clearCookie('refreshToken', options);
};
exports.clearTokenCookies = clearTokenCookies;
// Middleware to protect routes with JWT (Updated to check cookies)
const authenticateJWT = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
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
    const decoded = (0, exports.verifyAccessToken)(token);
    if (!decoded) {
        return res.status(401).json({
            success: false,
            error: 'Invalid token',
            message: 'The provided token is invalid or expired'
        });
    }
    // Attach user to request
    try {
        const db = (0, db_1.getDB)();
        const user = yield db.collection('users').findOne({ id: decoded.id });
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User not found',
                message: 'The user associated with this token does not exist'
            });
        }
        req.user = user;
        req.isAuthenticated = () => true;
        next();
    }
    catch (error) {
        console.error('Error retrieving user from database:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while verifying your authentication'
        });
    }
});
exports.authenticateJWT = authenticateJWT;
