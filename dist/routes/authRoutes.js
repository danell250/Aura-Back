"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const db_1 = require("../db");
const authUtils_1 = require("../utils/authUtils");
const router = (0, express_1.Router)();
// Google OAuth routes - JWT version
router.get('/google', passport_1.default.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport_1.default.authenticate('google', { failureRedirect: '/login' }), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Save or update user in database after successful OAuth
        if (req.user) {
            const db = (0, db_1.getDB)();
            const userData = req.user;
            // Check if user exists
            const existingUser = yield db.collection('users').findOne({
                $or: [
                    { id: userData.id },
                    { googleId: userData.googleId },
                    { email: userData.email }
                ]
            });
            let finalUser;
            if (existingUser) {
                // Update existing user
                yield db.collection('users').updateOne({ id: existingUser.id }, {
                    $set: Object.assign(Object.assign({}, userData), { lastLogin: new Date().toISOString(), updatedAt: new Date().toISOString() })
                });
                finalUser = Object.assign(Object.assign({}, existingUser), userData);
                console.log('Updated existing user after OAuth:', existingUser.id);
            }
            else {
                // Create new user
                const newUser = Object.assign(Object.assign({}, userData), { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLogin: new Date().toISOString(), auraCredits: 100, trustScore: 10, activeGlow: 'none', acquaintances: [], blockedUsers: [] });
                yield db.collection('users').insertOne(newUser);
                finalUser = newUser;
                console.log('Created new user after OAuth:', newUser.id);
            }
            // Generate JWT token
            const token = (0, authUtils_1.generateToken)(finalUser);
            const refreshToken = (0, authUtils_1.generateRefreshToken)(finalUser);
            // Store refresh token in database for this user
            yield db.collection('users').updateOne({ id: finalUser.id }, { $set: { refreshToken } });
            // Redirect to frontend with token
            const frontendUrl = process.env.VITE_FRONTEND_URL || 'https://auraradiance.vercel.app';
            // Append the token to the URL as a query parameter
            const redirectUrl = `${frontendUrl}?token=${token}&refreshToken=${refreshToken}`;
            res.redirect(redirectUrl);
        }
    }
    catch (error) {
        console.error('Error in OAuth callback:', error);
        res.redirect('/login?error=oauth_failed');
    }
}));
// Token refresh endpoint
router.post('/refresh-token', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(401).json({
                success: false,
                error: 'Refresh token required',
                message: 'No refresh token provided'
            });
        }
        // Verify the refresh token
        const decoded = yield Promise.resolve().then(() => __importStar(require('../utils/authUtils'))).then(utils => utils.verifyRefreshToken(refreshToken));
        if (!decoded) {
            return res.status(403).json({
                success: false,
                error: 'Invalid refresh token',
                message: 'The refresh token is invalid or has expired'
            });
        }
        const db = (0, db_1.getDB)();
        const user = yield db.collection('users').findOne({
            id: decoded.id,
            refreshToken: refreshToken // Verify the refresh token matches the one stored
        });
        if (!user) {
            return res.status(403).json({
                success: false,
                error: 'Invalid refresh token',
                message: 'The refresh token does not match the user record'
            });
        }
        // Generate new tokens
        const newToken = (0, authUtils_1.generateToken)(user);
        const newRefreshToken = (0, authUtils_1.generateRefreshToken)(user);
        // Update the refresh token in the database
        yield db.collection('users').updateOne({ id: user.id }, { $set: { refreshToken: newRefreshToken } });
        res.json({
            success: true,
            token: newToken,
            refreshToken: newRefreshToken
        });
    }
    catch (error) {
        console.error('Error refreshing token:', error);
        res.status(500).json({
            success: false,
            error: 'Token refresh failed',
            message: 'An error occurred while refreshing the token'
        });
    }
}));
// Logout route - JWT version (just clears client-side token)
router.post('/logout', (req, res) => {
    var _a;
    // For JWT, logout is typically handled client-side by clearing the token
    // But we can still invalidate sessions if they exist
    req.logout((err) => {
        if (err) {
            console.error('Error during logout:', err);
        }
    });
    (_a = req.session) === null || _a === void 0 ? void 0 : _a.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
    });
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});
// Get current user info - JWT version
router.get('/user', (req, res) => {
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
// Check authentication status - JWT version
router.get('/status', (req, res) => {
    const isAuthenticated = !!req.user;
    res.json({
        success: true,
        authenticated: isAuthenticated,
        user: isAuthenticated ? req.user : null
    });
});
// Manual login endpoint (for email/password authentication) - JWT version
router.post('/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                error: 'Missing credentials',
                message: 'Email/username and password are required'
            });
        }
        const db = (0, db_1.getDB)();
        const normalizedIdentifier = identifier.toLowerCase().trim();
        // Find user by email or handle
        const user = yield db.collection('users').findOne({
            $or: [
                { email: normalizedIdentifier },
                { handle: normalizedIdentifier }
            ]
        });
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                message: 'User not found'
            });
        }
        // In production, you would verify the password hash here
        // For now, we'll accept any password for demo purposes
        // TODO: Implement proper password hashing with bcrypt
        // Update last login
        yield db.collection('users').updateOne({ id: user.id }, {
            $set: {
                lastLogin: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        });
        // Generate JWT token
        const token = (0, authUtils_1.generateToken)(user);
        const refreshToken = (0, authUtils_1.generateRefreshToken)(user);
        // Store refresh token in database for this user
        yield db.collection('users').updateOne({ id: user.id }, { $set: { refreshToken } });
        res.json({
            success: true,
            user: user,
            token: token, // Include token in response
            refreshToken: refreshToken, // Include refresh token in response
            message: 'Login successful'
        });
    }
    catch (error) {
        console.error('Error in manual login:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed',
            message: 'Internal server error'
        });
    }
}));
// Manual registration endpoint - JWT version
router.post('/register', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, email, phone, dob, password } = req.body;
        // Validate required fields
        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'firstName, lastName, email, and password are required'
            });
        }
        const db = (0, db_1.getDB)();
        const normalizedEmail = email.toLowerCase().trim();
        // Check if user already exists
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
        // Create new user
        const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const handle = `@${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s+/g, '')}${Math.floor(Math.random() * 10000)}`;
        const newUser = {
            id: userId,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: normalizedEmail,
            phone: (phone === null || phone === void 0 ? void 0 : phone.trim()) || '',
            dob: dob || '',
            handle: handle,
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
            lastLogin: new Date().toISOString()
            // TODO: Hash password with bcrypt before storing
            // passwordHash: await bcrypt.hash(password, 10)
        };
        yield db.collection('users').insertOne(newUser);
        // Generate JWT token
        const token = (0, authUtils_1.generateToken)(newUser);
        const refreshToken = (0, authUtils_1.generateRefreshToken)(newUser);
        // Store refresh token in database for this user
        yield db.collection('users').updateOne({ id: newUser.id }, { $set: { refreshToken } });
        res.status(201).json({
            success: true,
            user: newUser,
            token: token, // Include token in response
            refreshToken: refreshToken, // Include refresh token in response
            message: 'Registration successful'
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
