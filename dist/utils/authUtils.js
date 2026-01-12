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
exports.optionalAuthJWT = exports.authenticateJWT = exports.verifyRefreshToken = exports.verifyToken = exports.generateRefreshToken = exports.generateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_for_dev';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // 7 days by default
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'fallback_refresh_secret_for_dev';
// Generate JWT token
const generateToken = (user) => {
    const payload = {
        id: user.id,
        email: user.email,
        name: user.name
    };
    const options = { expiresIn: JWT_EXPIRES_IN };
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, options);
};
exports.generateToken = generateToken;
// Generate refresh token
const generateRefreshToken = (user) => {
    const payload = {
        id: user.id,
        email: user.email
    };
    // Refresh token expires in 30 days
    const options = { expiresIn: '30d' };
    return jsonwebtoken_1.default.sign(payload, REFRESH_TOKEN_SECRET, options);
};
exports.generateRefreshToken = generateRefreshToken;
// Verify JWT token
const verifyToken = (token) => {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        return decoded;
    }
    catch (error) {
        console.error('JWT verification error:', error);
        return null;
    }
};
exports.verifyToken = verifyToken;
// Verify refresh token
const verifyRefreshToken = (token) => {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, REFRESH_TOKEN_SECRET);
        return decoded;
    }
    catch (error) {
        console.error('Refresh token verification error:', error);
        return null;
    }
};
exports.verifyRefreshToken = verifyRefreshToken;
// Middleware to protect routes with JWT
const authenticateJWT = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            message: 'Please provide a valid authorization token'
        });
    }
    const token = authHeader.split(' ')[1]; // Extract token after "Bearer "
    const decoded = (0, exports.verifyToken)(token);
    if (!decoded) {
        return res.status(403).json({
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
// Optional authentication middleware
const optionalAuthJWT = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decoded = (0, exports.verifyToken)(token);
        if (decoded) {
            try {
                const db = (0, db_1.getDB)();
                const user = yield db.collection('users').findOne({ id: decoded.id });
                if (user) {
                    req.user = user;
                    req.isAuthenticated = () => true;
                }
            }
            catch (error) {
                console.error('Error retrieving user from database in optional auth:', error);
            }
        }
    }
    next();
});
exports.optionalAuthJWT = optionalAuthJWT;
