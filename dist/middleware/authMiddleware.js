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
exports.requireAdmin = exports.requireOwnership = exports.attachUser = exports.optionalAuth = exports.requireAuth = void 0;
const db_1 = require("../db");
const firebaseAdmin_1 = __importDefault(require("../firebaseAdmin"));
const jwtUtils_1 = require("../utils/jwtUtils");
const userUtils_1 = require("../utils/userUtils");
const logFirebaseTokenVerificationError = (context, error) => {
    const normalizedError = error;
    const fallbackMessage = error instanceof Error ? error.message : String(error);
    const errorInfo = {
        code: (normalizedError === null || normalizedError === void 0 ? void 0 : normalizedError.code) || 'unknown',
        message: (normalizedError === null || normalizedError === void 0 ? void 0 : normalizedError.message) || fallbackMessage
    };
    console.error(`[Auth] ${context} Firebase token verification failed`, { errorInfo });
};
// Middleware to check if user is authenticated via JWT or Firebase
const requireAuth = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    // Check database connection first
    if (!(0, db_1.isDBConnected)()) {
        return res.status(503).json({
            success: false,
            error: 'Service Unavailable',
            message: 'Database service is currently unavailable'
        });
    }
    // 1. Check JWT Token (Cookie or Header)
    let token = null;
    let decoded = null;
    if (req.cookies && req.cookies.accessToken) {
        token = req.cookies.accessToken;
        decoded = (0, jwtUtils_1.verifyAccessToken)(token);
    }
    // If cookie token is missing or invalid, try Authorization header
    if ((!decoded || !token) && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        const headerToken = req.headers.authorization.split(' ')[1];
        // Avoid re-verifying the same token
        if (!token || headerToken !== token) {
            const headerDecoded = (0, jwtUtils_1.verifyAccessToken)(headerToken);
            if (headerDecoded) {
                token = headerToken;
                decoded = headerDecoded;
            }
        }
    }
    if (decoded && token) {
        try {
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: decoded.id });
            if (user) {
                if (user.isSuspended) {
                    return res.status(403).json({
                        success: false,
                        error: 'Account suspended',
                        message: user.suspensionReason
                            ? `Your account is suspended: ${user.suspensionReason}`
                            : 'Your account is suspended. Please contact support.'
                    });
                }
                req.user = (0, userUtils_1.transformUser)(user);
                req.isAuthenticated = (() => true);
                return next();
            }
        }
        catch (error) {
            console.error('Error retrieving user from database:', error);
        }
        return res.status(401).json({
            success: false,
            error: 'Invalid token',
            message: 'The provided token is invalid or expired'
        });
    }
    // 2. Check Session Auth (fallback)
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    // 3. Check Bearer Token (Firebase) - only if not handled by our JWT
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const firebaseToken = authHeader.split(' ')[1];
        try {
            // Verify Firebase token using Admin SDK
            const decodedToken = yield firebaseAdmin_1.default.auth().verifyIdToken(firebaseToken);
            // Token is valid, ensure user is attached
            if (!req.user) {
                const db = (0, db_1.getDB)();
                const user = yield db.collection('users').findOne({ id: decodedToken.uid });
                if (user) {
                    if (user.isSuspended) {
                        return res.status(403).json({
                            success: false,
                            error: 'Account suspended',
                            message: user.suspensionReason
                                ? `Your account is suspended: ${user.suspensionReason}`
                                : 'Your account is suspended. Please contact support.'
                        });
                    }
                    req.user = (0, userUtils_1.transformUser)(user);
                }
                else {
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
                    };
                }
            }
            // Mock isAuthenticated for compatibility
            req.isAuthenticated = (() => true);
            return next();
        }
        catch (error) {
            logFirebaseTokenVerificationError('requireAuth', error);
            // Fall through to 401
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
    // Try JWT first
    let token = null;
    if (req.cookies && req.cookies.accessToken) {
        token = req.cookies.accessToken;
    }
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (token) {
        const decoded = (0, jwtUtils_1.verifyAccessToken)(token);
        if (decoded) {
            try {
                const db = (0, db_1.getDB)();
                const user = yield db.collection('users').findOne({ id: decoded.id });
                if (user) {
                    req.user = (0, userUtils_1.transformUser)(user);
                    req.isAuthenticated = (() => true);
                }
            }
            catch (error) {
                console.error('Error retrieving user from database in optional auth:', error);
            }
        }
    }
    // Check if already authenticated via session
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    // Try to authenticate via Bearer token (Firebase) if not already authenticated
    if (!req.user && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        const firebaseToken = req.headers.authorization.split(' ')[1];
        try {
            const decodedToken = yield firebaseAdmin_1.default.auth().verifyIdToken(firebaseToken);
            if (decodedToken) {
                const db = (0, db_1.getDB)();
                const user = yield db.collection('users').findOne({ id: decodedToken.uid });
                if (user) {
                    req.user = (0, userUtils_1.transformUser)(user);
                    req.isAuthenticated = (() => true);
                }
            }
        }
        catch (e) {
            // Ignore errors in optional auth
        }
    }
    next();
});
exports.optionalAuth = optionalAuth;
// Middleware to get user data from JWT and attach to request
const attachUser = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. JWT Token Auth
        let token = null;
        if (req.cookies && req.cookies.accessToken) {
            token = req.cookies.accessToken;
        }
        else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            token = req.headers.authorization.split(' ')[1];
        }
        if (token) {
            const decoded = (0, jwtUtils_1.verifyAccessToken)(token);
            if (decoded) {
                const db = (0, db_1.getDB)();
                const user = yield db.collection('users').findOne({ id: decoded.id });
                if (user) {
                    req.user = (0, userUtils_1.transformUser)(user);
                    req.isAuthenticated = (() => true);
                }
            }
        }
        // 2. Session Auth (fallback)
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
        // 3. Bearer Token Auth (Firebase) - if not already handled
        if (!req.user && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            const firebaseToken = req.headers.authorization.split(' ')[1];
            try {
                const decodedToken = yield firebaseAdmin_1.default.auth().verifyIdToken(firebaseToken);
                if (decodedToken) {
                    const db = (0, db_1.getDB)();
                    const user = yield db.collection('users').findOne({ id: decodedToken.uid });
                    if (user) {
                        req.user = Object.assign(Object.assign({}, user), { id: user.id });
                    }
                    else {
                        // Minimal user object from token
                        req.user = {
                            id: decodedToken.uid,
                            email: decodedToken.email
                        };
                    }
                    // Mock isAuthenticated
                    req.isAuthenticated = (() => true);
                }
            }
            catch (e) {
                // console.warn('Failed to verify token in attachUser:', e);
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
