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
const express_1 = require("express");
const passport_1 = __importDefault(require("passport"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const db_1 = require("../db");
const authMiddleware_1 = require("../middleware/authMiddleware");
const jwtUtils_1 = require("../utils/jwtUtils");
const securityLogger_1 = require("../utils/securityLogger");
const router = (0, express_1.Router)();
// ============ HANDLE GENERATION FUNCTION ============
const generateUniqueHandle = (firstName, lastName) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    // Sanitize input
    const firstNameSafe = (firstName || 'user').toLowerCase().trim().replace(/\s+/g, '');
    const lastNameSafe = (lastName || '').toLowerCase().trim().replace(/\s+/g, '');
    // Build base handle
    const baseHandle = `@${firstNameSafe}${lastNameSafe}`;
    // Try 1: Use base handle as-is
    try {
        let existingUser = yield db.collection('users').findOne({ handle: baseHandle });
        if (!existingUser) {
            console.log('✓ Handle available:', baseHandle);
            return baseHandle;
        }
    }
    catch (error) {
        console.error('Error checking base handle:', error);
    }
    // Try 2: Add random numbers until we find an available one
    for (let attempt = 0; attempt < 50; attempt++) {
        const randomNum = Math.floor(Math.random() * 100000);
        const candidateHandle = `${baseHandle}${randomNum}`;
        try {
            const existingUser = yield db.collection('users').findOne({ handle: candidateHandle });
            if (!existingUser) {
                console.log('✓ Handle available:', candidateHandle);
                return candidateHandle;
            }
        }
        catch (error) {
            console.error(`Error checking handle ${candidateHandle}:`, error);
            continue;
        }
    }
    // Fallback: Use timestamp + random string (guaranteed unique)
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 9);
    const fallbackHandle = `@user${timestamp}${randomStr}`;
    console.log('⚠ Using fallback handle:', fallbackHandle);
    return fallbackHandle;
});
// ============ RATE LIMITER ============
const loginRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        (0, securityLogger_1.logSecurityEvent)({
            req,
            type: 'rate_limit_triggered',
            route: '/login',
            metadata: {
                key: 'login',
                max: 5,
                windowMs: 60 * 1000
            }
        });
        res.status(429).json({
            success: false,
            error: 'Too many login attempts',
            message: 'Too many login attempts, please try again in a minute'
        });
    }
});
// ============ GOOGLE OAUTH ============
router.get('/google', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(503).json({
            success: false,
            message: 'Google login is not configured on the server.'
        });
    }
    next();
}, passport_1.default.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.redirect('/login?error=google_not_configured');
    }
    next();
}, passport_1.default.authenticate('google', { failureRedirect: '/login' }), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (req.user) {
            const db = (0, db_1.getDB)();
            const userData = req.user;
            const existingUser = yield db.collection('users').findOne({
                $or: [
                    { id: userData.id },
                    { googleId: userData.googleId },
                    { githubId: userData.githubId },
                    { email: userData.email }
                ]
            });
            let userToReturn;
            if (existingUser) {
                // PRESERVE existing handle - NEVER change it
                const updates = {
                    firstName: userData.firstName,
                    lastName: userData.lastName,
                    name: userData.name,
                    email: userData.email,
                    avatar: userData.avatar,
                    avatarType: userData.avatarType,
                    googleId: userData.googleId,
                    lastLogin: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                updates.handle = existingUser.handle; // CRITICAL: Keep original handle
                yield db.collection('users').updateOne({ id: existingUser.id }, { $set: updates });
                console.log('✓ Updated existing user after OAuth:', existingUser.id);
                userToReturn = Object.assign(Object.assign({}, existingUser), updates);
            }
            else {
                // NEW USER: Generate unique handle
                const uniqueHandle = yield generateUniqueHandle(userData.firstName || 'User', userData.lastName || '');
                const newUser = Object.assign(Object.assign({}, userData), { handle: uniqueHandle, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLogin: new Date().toISOString(), auraCredits: 100, trustScore: 10, activeGlow: 'none', acquaintances: [], blockedUsers: [], refreshTokens: [] });
                yield db.collection('users').insertOne(newUser);
                console.log('✓ Created new user after OAuth:', newUser.id, '| Handle:', uniqueHandle);
                userToReturn = newUser;
            }
            const accessToken = (0, jwtUtils_1.generateAccessToken)(userToReturn);
            const refreshToken = (0, jwtUtils_1.generateRefreshToken)(userToReturn);
            yield db.collection('users').updateOne({ id: userToReturn.id }, {
                $push: { refreshTokens: refreshToken }
            });
            (0, jwtUtils_1.setTokenCookies)(res, accessToken, refreshToken);
            const frontendUrl = process.env.VITE_FRONTEND_URL ||
                (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://auraradiance.vercel.app');
            console.log('[OAuth] Redirecting to:', `${frontendUrl}/feed`);
            res.redirect(`${frontendUrl}/feed`);
        }
    }
    catch (error) {
        console.error('Error in OAuth callback:', error);
        res.redirect('/login?error=oauth_failed');
    }
}));
// ============ REFRESH TOKEN ============
router.post('/refresh-token', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) {
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'refresh_failed',
                metadata: {
                    reason: 'missing_token'
                }
            });
            return res.status(401).json({
                success: false,
                error: 'Refresh token required',
                message: 'Please log in again'
            });
        }
        const decoded = (0, jwtUtils_1.verifyRefreshToken)(refreshToken);
        if (!decoded) {
            (0, jwtUtils_1.clearTokenCookies)(res);
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'refresh_failed',
                metadata: {
                    reason: 'invalid_or_expired_token'
                }
            });
            return res.status(403).json({
                success: false,
                error: 'Invalid refresh token',
                message: 'Session expired, please log in again'
            });
        }
        const db = (0, db_1.getDB)();
        const user = yield db.collection('users').findOne({ id: decoded.id });
        if (!user || !user.refreshTokens || !user.refreshTokens.includes(refreshToken)) {
            (0, jwtUtils_1.clearTokenCookies)(res);
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'refresh_failed',
                userId: decoded.id,
                metadata: {
                    reason: 'token_not_found_for_user'
                }
            });
            return res.status(403).json({
                success: false,
                error: 'Invalid refresh token',
                message: 'Session invalid'
            });
        }
        const newAccessToken = (0, jwtUtils_1.generateAccessToken)(user);
        const newRefreshToken = (0, jwtUtils_1.generateRefreshToken)(user);
        yield db.collection('users').updateOne({ id: user.id }, {
            $pull: { refreshTokens: refreshToken },
        });
        yield db.collection('users').updateOne({ id: user.id }, {
            $push: { refreshTokens: newRefreshToken }
        });
        (0, jwtUtils_1.setTokenCookies)(res, newAccessToken, newRefreshToken);
        (0, securityLogger_1.logSecurityEvent)({
            req,
            type: 'refresh_success',
            userId: user.id
        });
        res.json({
            success: true,
            accessToken: newAccessToken,
            user: user,
            message: 'Token refreshed successfully'
        });
    }
    catch (error) {
        console.error('Error refreshing token:', error);
        (0, jwtUtils_1.clearTokenCookies)(res);
        (0, securityLogger_1.logSecurityEvent)({
            req,
            type: 'refresh_failed',
            metadata: {
                reason: 'exception',
                errorMessage: error instanceof Error ? error.message : String(error)
            }
        });
        res.status(500).json({
            success: false,
            error: 'Refresh failed',
            message: 'Internal server error'
        });
    }
}));
// ============ GITHUB OAUTH ============
router.get('/github', (req, res, next) => {
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
        return res.status(503).json({
            success: false,
            message: 'GitHub login is not configured on the server.'
        });
    }
    next();
}, passport_1.default.authenticate('github', { scope: ['user:email'] }));
router.get('/github/callback', (req, res, next) => {
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
        return res.redirect('/login?error=github_not_configured');
    }
    next();
}, passport_1.default.authenticate('github', { failureRedirect: '/login' }), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (req.user) {
            const db = (0, db_1.getDB)();
            const userData = req.user;
            const existingUser = yield db.collection('users').findOne({
                $or: [
                    { id: userData.id },
                    { githubId: userData.githubId },
                    { email: userData.email }
                ]
            });
            let userToReturn;
            if (existingUser) {
                // PRESERVE existing handle - NEVER change it
                const updates = {
                    firstName: userData.firstName,
                    lastName: userData.lastName,
                    name: userData.name,
                    email: userData.email,
                    avatar: userData.avatar,
                    avatarType: userData.avatarType,
                    githubId: userData.githubId,
                    lastLogin: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                updates.handle = existingUser.handle; // CRITICAL: Keep original handle
                yield db.collection('users').updateOne({ id: existingUser.id }, { $set: updates });
                console.log('✓ Updated existing user after GitHub OAuth:', existingUser.id);
                userToReturn = Object.assign(Object.assign({}, existingUser), updates);
            }
            else {
                // NEW USER: Generate unique handle
                const uniqueHandle = yield generateUniqueHandle(userData.firstName || 'User', userData.lastName || '');
                const newUser = Object.assign(Object.assign({}, userData), { handle: uniqueHandle, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLogin: new Date().toISOString(), auraCredits: 100, trustScore: 10, activeGlow: 'none', acquaintances: [], blockedUsers: [], refreshTokens: [] });
                yield db.collection('users').insertOne(newUser);
                console.log('✓ Created new user after GitHub OAuth:', newUser.id, '| Handle:', uniqueHandle);
                userToReturn = newUser;
            }
            const accessToken = (0, jwtUtils_1.generateAccessToken)(userToReturn);
            const refreshToken = (0, jwtUtils_1.generateRefreshToken)(userToReturn);
            yield db.collection('users').updateOne({ id: userToReturn.id }, {
                $push: { refreshTokens: refreshToken }
            });
            (0, jwtUtils_1.setTokenCookies)(res, accessToken, refreshToken);
            const frontendUrl = process.env.VITE_FRONTEND_URL ||
                (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://auraradiance.vercel.app');
            console.log('[OAuth:GitHub] Redirecting to:', `${frontendUrl}/feed`);
            res.redirect(`${frontendUrl}/feed`);
        }
        else {
            res.redirect('/login');
        }
    }
    catch (error) {
        console.error('GitHub OAuth callback error:', error);
        res.redirect('/login');
    }
}));
// ============ GET CURRENT USER ============
router.get('/user', authMiddleware_1.requireAuth, (req, res) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({
            success: false,
            error: 'Not authenticated'
        });
    }
    res.json({
        success: true,
        user
    });
});
// ============ LOGOUT ============
router.post('/logout', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) {
            const db = (0, db_1.getDB)();
            const decoded = (0, jwtUtils_1.verifyRefreshToken)(refreshToken);
            if (decoded) {
                yield db.collection('users').updateOne({ id: decoded.id }, { $pull: { refreshTokens: refreshToken } });
            }
        }
        (0, jwtUtils_1.clearTokenCookies)(res);
        req.logout((err) => {
            if (err) {
                console.error('Error during passport logout:', err);
            }
            req.session.destroy((err) => {
                if (err) {
                    console.error('Error destroying session:', err);
                }
                res.json({
                    success: true,
                    message: 'Logged out successfully'
                });
            });
        });
    }
    catch (error) {
        console.error('Error in logout:', error);
        res.status(500).json({
            success: false,
            error: 'Logout error',
            message: 'Internal server error'
        });
    }
}));
// ============ GET USER INFO (ATTACHUSER) ============
router.get('/user-info', authMiddleware_1.attachUser, (req, res) => {
    if (req.user) {
        res.json({
            success: true,
            user: req.user,
            authenticated: true
        });
    }
    else {
        res.status(401).json({
            success: false,
            error: 'Not authenticated',
            authenticated: false
        });
    }
});
// ============ CHECK AUTHENTICATION STATUS ============
router.get('/status', authMiddleware_1.attachUser, (req, res) => {
    const isAuthenticated = !!req.user;
    res.json({
        success: true,
        authenticated: isAuthenticated,
        user: isAuthenticated ? req.user : null
    });
});
// ============ LOGIN ============
router.post('/login', loginRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'login_failed',
                identifier,
                metadata: {
                    reason: 'missing_credentials'
                }
            });
            return res.status(400).json({
                success: false,
                error: 'Missing credentials',
                message: 'Email/username and password are required'
            });
        }
        const db = (0, db_1.getDB)();
        const normalizedIdentifier = identifier.toLowerCase().trim();
        const user = yield db.collection('users').findOne({
            $or: [
                { email: normalizedIdentifier },
                { handle: normalizedIdentifier }
            ]
        });
        if (!user) {
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'login_failed',
                identifier: normalizedIdentifier,
                metadata: {
                    reason: 'user_not_found'
                }
            });
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                message: 'User not found'
            });
        }
        if (!user.passwordHash) {
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'login_failed',
                userId: user.id,
                identifier: normalizedIdentifier,
                metadata: {
                    reason: 'no_password_hash'
                }
            });
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                message: 'Please log in with Google or reset your password'
            });
        }
        const isValidPassword = yield bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isValidPassword) {
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'login_failed',
                userId: user.id,
                identifier: normalizedIdentifier,
                metadata: {
                    reason: 'invalid_password'
                }
            });
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                message: 'Invalid password'
            });
        }
        yield db.collection('users').updateOne({ id: user.id }, {
            $set: {
                lastLogin: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        });
        const accessToken = (0, jwtUtils_1.generateAccessToken)(user);
        const refreshToken = (0, jwtUtils_1.generateRefreshToken)(user);
        yield db.collection('users').updateOne({ id: user.id }, { $push: { refreshTokens: refreshToken } });
        (0, jwtUtils_1.setTokenCookies)(res, accessToken, refreshToken);
        req.login(user, (err) => {
            if (err) {
                console.error('Error creating session:', err);
            }
            (0, securityLogger_1.logSecurityEvent)({
                req,
                type: 'login_success',
                userId: user.id,
                identifier: normalizedIdentifier
            });
            res.json({
                success: true,
                user: user,
                token: accessToken,
                message: 'Login successful'
            });
        });
    }
    catch (error) {
        console.error('Error in manual login:', error);
        (0, securityLogger_1.logSecurityEvent)({
            req,
            type: 'login_failed',
            identifier: (_a = req.body) === null || _a === void 0 ? void 0 : _a.identifier,
            metadata: {
                reason: 'exception',
                errorMessage: error instanceof Error ? error.message : String(error)
            }
        });
        res.status(500).json({
            success: false,
            error: 'Login failed',
            message: 'Internal server error'
        });
    }
}));
// ============ REGISTER ============
router.post('/register', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, email, phone, dob, password } = req.body;
        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'firstName, lastName, email, and password are required'
            });
        }
        const db = (0, db_1.getDB)();
        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = yield db.collection('users').findOne({
            email: normalizedEmail
        });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'User already exists',
                message: 'An account with this email already exists'
            });
        }
        const passwordHash = yield bcryptjs_1.default.hash(password, 10);
        // GENERATE UNIQUE HANDLE
        const uniqueHandle = yield generateUniqueHandle(firstName, lastName);
        const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newUser = {
            id: userId,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: normalizedEmail,
            phone: (phone === null || phone === void 0 ? void 0 : phone.trim()) || '',
            dob: dob || '',
            handle: uniqueHandle,
            bio: 'New to Aura',
            industry: 'Other',
            companyName: '',
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
            avatarType: 'image',
            acquaintances: [],
            blockedUsers: [],
            trustScore: 10,
            auraCredits: 100,
            activeGlow: 'none',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            passwordHash: passwordHash,
            refreshTokens: []
        };
        yield db.collection('users').insertOne(newUser);
        const accessToken = (0, jwtUtils_1.generateAccessToken)(newUser);
        const refreshToken = (0, jwtUtils_1.generateRefreshToken)(newUser);
        yield db.collection('users').updateOne({ id: newUser.id }, { $push: { refreshTokens: refreshToken } });
        (0, jwtUtils_1.setTokenCookies)(res, accessToken, refreshToken);
        req.login(newUser, (err) => {
            if (err) {
                console.error('Error creating session for new user:', err);
            }
            res.status(201).json({
                success: true,
                user: newUser,
                token: accessToken,
                message: 'Registration successful'
            });
        });
    }
    catch (error) {
        console.error('Error in registration:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed',
            message: 'Internal server error'
        });
    }
}));
exports.default = router;
