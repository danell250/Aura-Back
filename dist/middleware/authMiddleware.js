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
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = exports.requireOwnership = exports.attachUser = exports.optionalAuth = exports.requireAuth = void 0;
const db_1 = require("../db");
// Helper to verify Firebase ID Token
const verifyFirebaseToken = (token) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Verify token with Google's public endpoint
        const response = yield fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
        if (!response.ok) {
            console.warn('Token verification failed:', yield response.text());
            return null;
        }
        const data = yield response.json();
        return {
            uid: data.sub,
            email: data.email
        };
    }
    catch (error) {
        console.error('Error verifying Firebase token:', error);
        return null;
    }
});
// Middleware to check if user is authenticated via session or Bearer token
const requireAuth = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    // 1. Check Session Auth
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    // 2. Check Bearer Token (Firebase)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decoded = yield verifyFirebaseToken(token);
        if (decoded) {
            // Token is valid, ensure user is attached
            if (!req.user) {
                const db = (0, db_1.getDB)();
                const user = yield db.collection('users').findOne({ id: decoded.uid });
                if (user) {
                    req.user = user;
                }
                else {
                    // User authenticated but not in DB yet (e.g. during creation/first sync)
                    // Create a temporary user object with the ID from token
                    req.user = {
                        id: decoded.uid,
                        email: decoded.email,
                        // Add other required fields with defaults if necessary
                    };
                }
            }
            // Mock isAuthenticated for compatibility
            req.isAuthenticated = (() => true);
            return next();
        }
    }
    res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please log in to access this resource'
    });
});
exports.requireAuth = requireAuth;
// Middleware to check if user is authenticated (optional - doesn't block)
const optionalAuth = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    // Check if already authenticated via session
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    // Try to authenticate via Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decoded = yield verifyFirebaseToken(token);
        if (decoded) {
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: decoded.uid });
            if (user) {
                req.user = user;
                req.isAuthenticated = (() => true);
            }
        }
    }
    next();
});
exports.optionalAuth = optionalAuth;
// Middleware to get user data from session and attach to request
const attachUser = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Session Auth
        if (req.isAuthenticated && req.isAuthenticated() && req.user) {
            // If we have a session user, try to get full user data from database
            const db = (0, db_1.getDB)();
            const userId = req.user.id;
            if (userId) {
                const user = yield db.collection('users').findOne({ id: userId });
                if (user) {
                    req.user = Object.assign(Object.assign({}, user), { id: user.id });
                }
            }
            return next();
        }
        // 2. Bearer Token Auth
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = yield verifyFirebaseToken(token);
            if (decoded) {
                const db = (0, db_1.getDB)();
                const user = yield db.collection('users').findOne({ id: decoded.uid });
                if (user) {
                    req.user = Object.assign(Object.assign({}, user), { id: user.id });
                }
                else {
                    // Minimal user object from token
                    req.user = {
                        id: decoded.uid,
                        email: decoded.email
                    };
                }
                // Mock isAuthenticated
                req.isAuthenticated = (() => true);
            }
        }
        next();
    }
    catch (error) {
        console.error('Error attaching user data:', error);
        next(); // Continue without user data
    }
});
exports.attachUser = attachUser;
// Middleware to validate user owns resource
const requireOwnership = (userIdParam = 'id') => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please log in to access this resource'
            });
        }
        const resourceUserId = req.params[userIdParam];
        const currentUserId = req.user.id;
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
exports.requireOwnership = requireOwnership;
// Middleware to check if user has admin privileges
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            message: 'Please log in to access this resource'
        });
    }
    const user = req.user;
    if (!user.isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Admin access required',
            message: 'You need admin privileges to access this resource'
        });
    }
    next();
};
exports.requireAdmin = requireAdmin;
