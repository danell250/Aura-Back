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
const db_1 = require("../db");
const authMiddleware_1 = require("../middleware/authMiddleware");
const jwtUtils_1 = require("../utils/jwtUtils");
const router = (0, express_1.Router)();
// Google OAuth routes
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
            if (existingUser) {
                // Preserve immutable fields like handle; only update mutable profile fields and timestamps
                const preservedHandle = existingUser.handle;
                const updates = {
                    // only update selected fields from OAuth
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
                // Ensure handle never changes once assigned
                updates.handle = preservedHandle || existingUser.handle || userData.handle;
                yield db.collection('users').updateOne({ id: existingUser.id }, { $set: updates });
                console.log('Updated existing user after OAuth:', existingUser.id);
            }
            else {
                // Create new user; generate and persist a handle once
                const newUser = Object.assign(Object.assign({}, userData), { handle: userData.handle, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLogin: new Date().toISOString(), auraCredits: 100, trustScore: 10, activeGlow: 'none', acquaintances: [], blockedUsers: [] });
                yield db.collection('users').insertOne(newUser);
                console.log('Created new user after OAuth:', newUser.id);
            }
            // Successful authentication, redirect to frontend with token
            const frontendUrl = process.env.VITE_FRONTEND_URL ||
                (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://auraradiance.vercel.app');
            const token = (0, jwtUtils_1.generateToken)(req.user);
            console.log('[OAuth] Redirecting to:', `${frontendUrl}/feed?token=${token}`);
            res.redirect(`${frontendUrl}/feed?token=${token}`);
        }
    }
    catch (error) {
        console.error('Error in OAuth callback:', error);
        res.redirect('/login?error=oauth_failed');
    }
}));
// Logout route
router.post('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Error during logout:', err);
            return res.status(500).json({
                success: false,
                error: 'Logout failed',
                message: 'An error occurred during logout'
            });
        }
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Session cleanup failed',
                    message: 'An error occurred cleaning up session'
                });
            }
            res.json({
                success: true,
                message: 'Logged out successfully'
            });
        });
    });
});
// Get current user info
router.get('/user', authMiddleware_1.attachUser, (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
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
// Check authentication status
router.get('/status', (req, res) => {
    const isAuthenticated = req.isAuthenticated && req.isAuthenticated();
    res.json({
        success: true,
        authenticated: isAuthenticated,
        user: isAuthenticated ? req.user : null
    });
});
// Manual login endpoint (for email/password authentication)
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
        // Create session
        req.login(user, (err) => {
            if (err) {
                console.error('Error creating session:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Session creation failed',
                    message: 'Failed to create user session'
                });
            }
            res.json({
                success: true,
                user: user,
                token: (0, jwtUtils_1.generateToken)(user),
                message: 'Login successful'
            });
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
// Manual registration endpoint
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
        // Create session for new user
        req.login(newUser, (err) => {
            if (err) {
                console.error('Error creating session for new user:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Registration successful but session creation failed',
                    message: 'Please try logging in manually'
                });
            }
            res.status(201).json({
                success: true,
                user: newUser,
                token: (0, jwtUtils_1.generateToken)(newUser),
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
