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
const crypto_1 = __importDefault(require("crypto"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../db");
const authMiddleware_1 = require("../middleware/authMiddleware");
const jwtUtils_1 = require("../utils/jwtUtils");
const tokenUtils_1 = require("../utils/tokenUtils");
const emailService_1 = require("../services/emailService");
const securityLogger_1 = require("../utils/securityLogger");
const userUtils_1 = require("../utils/userUtils");
const router = (0, express_1.Router)();
const normalizeUserHandle = (rawHandle) => {
    const base = (rawHandle || '').trim().toLowerCase();
    const withoutAt = base.startsWith('@') ? base.slice(1) : base;
    const cleaned = withoutAt.replace(/[^a-z0-9_-]/g, '');
    if (!cleaned)
        return '';
    return `@${cleaned}`;
};
const validateHandleFormat = (handle) => {
    const normalized = normalizeUserHandle(handle);
    if (!normalized) {
        return { ok: false, message: 'Handle is required' };
    }
    const core = normalized.slice(1);
    if (core.length < 3 || core.length > 21) {
        return { ok: false, message: 'Handle must be between 3 and 21 characters' };
    }
    if (!/^[a-z0-9_-]+$/.test(core)) {
        return { ok: false, message: 'Handle can only use letters, numbers, underscores and hyphens' };
    }
    return { ok: true };
};
const generateUniqueHandle = (firstName, lastName) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const firstNameSafe = (firstName || 'user').toLowerCase().trim().replace(/\s+/g, '');
    const lastNameSafe = (lastName || '').toLowerCase().trim().replace(/\s+/g, '');
    const baseHandle = `@${firstNameSafe}${lastNameSafe}`;
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
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 9);
    const fallbackHandle = `@user${timestamp}${randomStr}`;
    console.log('⚠ Using fallback handle:', fallbackHandle);
    return fallbackHandle;
});
router.post('/check-handle', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { handle } = req.body || {};
        const validation = validateHandleFormat(handle || '');
        if (!validation.ok) {
            return res.status(400).json({
                success: false,
                available: false,
                error: 'Invalid handle',
                message: validation.message || 'Invalid handle'
            });
        }
        const normalizedHandle = normalizeUserHandle(handle);
        const db = (0, db_1.getDB)();
        const existingUser = yield db.collection('users').findOne({ handle: normalizedHandle });
        return res.json({
            success: true,
            available: !existingUser,
            handle: normalizedHandle
        });
    }
    catch (error) {
        console.error('Error checking handle availability:', error);
        return res.status(500).json({
            success: false,
            available: false,
            error: 'Handle check failed',
            message: 'Internal server error'
        });
    }
}));
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
            console.log('🔍 Google OAuth - Checking for existing user with ID:', userData.id);
            // Identify-First: Check by EMAIL
            const existingUser = yield db.collection('users').findOne({
                email: userData.email
            });
            let userToReturn;
            if (existingUser) {
                console.log('✓ Found existing user by email:', existingUser.email);
                const updates = {
                    lastLogin: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    // Always link the ID of the current provider
                    googleId: userData.googleId || existingUser.googleId,
                };
                // DO NOT update these if they already exist
                // This keeps the user's chosen identity intact
                if (!existingUser.handle)
                    updates.handle = userData.handle;
                if (!existingUser.firstName)
                    updates.firstName = userData.firstName;
                if (!existingUser.avatar)
                    updates.avatar = userData.avatar;
                yield db.collection('users').updateOne({ id: existingUser.id }, { $set: updates });
                userToReturn = Object.assign(Object.assign({}, existingUser), updates);
            }
            else {
                console.log('➕ New user from Google OAuth');
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
                (req.headers.origin ? req.headers.origin.toString() :
                    (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://www.aura.net.za'));
            console.log('[OAuth] Redirecting to:', `${frontendUrl}/feed`);
            res.redirect(`${frontendUrl}/feed`);
        }
    }
    catch (error) {
        console.error('Error in OAuth callback:', error);
        res.redirect('/login?error=oauth_failed');
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
            console.log('🔍 GitHub OAuth - Checking for existing user with ID:', userData.id);
            // Identify-First: Check by EMAIL
            const existingUser = yield db.collection('users').findOne({
                email: userData.email
            });
            let userToReturn;
            if (existingUser) {
                console.log('✓ Found existing user by email:', existingUser.email);
                const updates = {
                    lastLogin: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    // Always link the ID of the current provider
                    githubId: userData.githubId || existingUser.githubId,
                };
                // DO NOT update these if they already exist
                if (!existingUser.firstName)
                    updates.firstName = userData.firstName;
                if (!existingUser.avatar)
                    updates.avatar = userData.avatar;
                yield db.collection('users').updateOne({ id: existingUser.id }, { $set: updates });
                userToReturn = Object.assign(Object.assign({}, existingUser), updates);
            }
            else {
                console.log('➕ New user from GitHub OAuth');
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
                (req.headers.origin ? req.headers.origin.toString() :
                    (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://www.aura.net.za'));
            console.log('[OAuth] Redirecting to:', `${frontendUrl}/feed`);
            res.redirect(`${frontendUrl}/feed`);
        }
    }
    catch (error) {
        console.error('Error in OAuth callback:', error);
        res.redirect('/login?error=oauth_failed');
    }
}));
// ============ LINKEDIN OAUTH ============
router.get('/linkedin', (req, res) => {
    if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
        return res.status(503).json({
            success: false,
            message: 'LinkedIn login is not configured on the server.'
        });
    }
    // 1. Generate a secure random state
    const state = crypto_1.default.randomBytes(16).toString('hex');
    // 2. Store state in a secure, httpOnly cookie (valid for 5 mins)
    res.cookie('linkedin_auth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // secure in prod
        sameSite: 'lax', // allows redirect from external site
        maxAge: 5 * 60 * 1000 // 5 minutes
    });
    // 3. Construct the authorization URL
    const redirectUri = process.env.LINKEDIN_CALLBACK_URL || 'https://www.aura.net.za/api/auth/linkedin/callback';
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const scope = 'openid profile email';
    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent(scope)}`;
    // 4. Redirect user to LinkedIn
    res.redirect(authUrl);
});
router.get('/linkedin/callback', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { code, state, error } = req.query;
    // Handle LinkedIn errors
    if (error) {
        console.error('LinkedIn OAuth Error:', error);
        return res.redirect('/login?error=linkedin_auth_failed');
    }
    if (!code) {
        return res.redirect('/login?error=no_code');
    }
    // 1. Validate State
    const storedState = req.cookies.linkedin_auth_state;
    if (!state || !storedState || state !== storedState) {
        console.error('LinkedIn OAuth State Mismatch:', { received: state, stored: storedState });
        return res.redirect('/login?error=state_mismatch');
    }
    // Clear the state cookie once used
    res.clearCookie('linkedin_auth_state');
    try {
        const redirectUri = process.env.LINKEDIN_CALLBACK_URL || 'https://www.aura.net.za/api/auth/linkedin/callback';
        // 2. Exchange code for access token
        const tokenResponse = yield axios_1.default.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
            params: {
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: process.env.LINKEDIN_CLIENT_ID,
                client_secret: process.env.LINKEDIN_CLIENT_SECRET
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        const accessToken = tokenResponse.data.access_token;
        // 3. Fetch user info
        const profileResponse = yield axios_1.default.get('https://api.linkedin.com/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        const profile = profileResponse.data;
        // LinkedIn profile structure: { sub, name, given_name, family_name, picture, email, ... }
        if (!profile.email_verified) {
            return res.redirect('/login?error=linkedin_email_not_verified');
        }
        const db = (0, db_1.getDB)();
        // 4. Find or Create User
        // Identify-First: Check by EMAIL
        const existingUser = yield db.collection('users').findOne({ email: profile.email });
        let userToReturn;
        if (existingUser) {
            console.log('✓ Found existing user by email:', existingUser.email);
            // 2. Account exists (could be from Google, Magic Link, or Password)
            // Simply "link" this LinkedIn sub ID to the existing account if not already there
            const updates = {
                lastLogin: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                // Always link the ID of the current provider
                linkedinId: profile.sub || existingUser.linkedinId,
            };
            // 3. DO NOT overwrite firstName, lastName, or handle if they already exist
            // Only fill them in if the existing record is missing them
            if (!existingUser.firstName)
                updates.firstName = profile.given_name;
            if (!existingUser.avatar)
                updates.avatar = profile.picture;
            // Also preserve handle
            if (!existingUser.handle) {
                // Generate one if really needed, though usually we won't need to do this here 
                // as we don't have userData.handle from LinkedIn usually.
                // But for consistency with the request:
                // LinkedIn profile doesn't always have a handle concept, so we skip unless we want to generate one.
            }
            yield db.collection('users').updateOne({ id: existingUser.id }, { $set: updates });
            userToReturn = Object.assign(Object.assign({}, existingUser), updates);
        }
        else {
            console.log('➕ New user from LinkedIn OAuth');
            const uniqueHandle = yield generateUniqueHandle(profile.given_name || 'User', profile.family_name || '');
            const newUser = {
                id: crypto_1.default.randomUUID(),
                linkedinId: profile.sub,
                firstName: profile.given_name || 'User',
                lastName: profile.family_name || '',
                name: profile.name || 'User',
                email: profile.email || '',
                avatar: profile.picture || `https://ui-avatars.com/api/?name=${profile.name}&background=random`,
                avatarType: 'url',
                handle: uniqueHandle,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastLogin: new Date().toISOString(),
                auraCredits: 100,
                trustScore: 10,
                activeGlow: 'none',
                acquaintances: [],
                blockedUsers: [],
                refreshTokens: []
            };
            yield db.collection('users').insertOne(newUser);
            userToReturn = newUser;
        }
        // 5. Session Management
        const newAccessToken = (0, jwtUtils_1.generateAccessToken)(userToReturn);
        const refreshToken = (0, jwtUtils_1.generateRefreshToken)(userToReturn);
        yield db.collection('users').updateOne({ id: userToReturn.id }, {
            $push: { refreshTokens: refreshToken }
        });
        (0, jwtUtils_1.setTokenCookies)(res, newAccessToken, refreshToken);
        const frontendUrl = process.env.VITE_FRONTEND_URL ||
            (req.headers.origin ? req.headers.origin.toString() :
                (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://www.aura.net.za'));
        console.log('[OAuth:LinkedIn] Redirecting to:', `${frontendUrl}/dashboard`);
        res.redirect(`${frontendUrl}/dashboard`);
    }
    catch (error) {
        console.error('LinkedIn OAuth callback error:', ((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        res.redirect('/login?error=linkedin_callback_error');
    }
}));
// ============ DISCORD OAUTH ============
router.get('/discord', (req, res) => {
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
        return res.status(503).json({
            success: false,
            message: 'Discord login is not configured on the server.'
        });
    }
    const state = crypto_1.default.randomBytes(16).toString('hex');
    const redirectUri = process.env.DISCORD_CALLBACK_URL ||
        `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/discord/callback`;
    const authUrl = `https://discord.com/oauth2/authorize` +
        `?client_id=${process.env.DISCORD_CLIENT_ID}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent('identify email')}` +
        `&state=${state}`;
    return res.redirect(authUrl);
});
router.get('/discord/callback', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { code, error } = req.query;
    if (error)
        return res.redirect('/login?error=discord_auth_failed');
    if (!code)
        return res.redirect('/login?error=discord_no_code');
    try {
        const redirectUri = process.env.DISCORD_CALLBACK_URL ||
            `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/discord/callback`;
        // Exchange code for token
        const body = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: String(code),
            redirect_uri: redirectUri,
        });
        const tokenRes = yield axios_1.default.post('https://discord.com/api/oauth2/token', body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const accessToken = tokenRes.data.access_token;
        // Fetch user
        const userRes = yield axios_1.default.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const discord = userRes.data;
        const email = (discord.email || '').trim().toLowerCase();
        if (!email)
            return res.redirect('/login?error=discord_no_email');
        if (discord.verified === false)
            return res.redirect('/login?error=discord_email_not_verified');
        const db = (0, db_1.getDB)();
        const existingUser = yield db.collection('users').findOne({ email });
        // Build Discord avatar URL (optional)
        const discordAvatar = discord.avatar
            ? `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.png?size=256`
            : null;
        let userToReturn;
        if (existingUser) {
            // ✅ Do NOT overwrite profile fields; only link provider + lastLogin
            const updates = {
                discordId: discord.id,
                lastLogin: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            // Only fill missing profile fields (optional, safe)
            if (!existingUser.name)
                updates.name = discord.global_name || discord.username;
            if (!existingUser.firstName)
                updates.firstName = (discord.global_name || discord.username || 'User').split(' ')[0];
            if (!existingUser.avatar && discordAvatar) {
                updates.avatar = discordAvatar;
                updates.avatarType = 'url';
            }
            yield db.collection('users').updateOne({ id: existingUser.id }, { $set: updates });
            userToReturn = Object.assign(Object.assign({}, existingUser), updates);
        }
        else {
            const displayName = discord.global_name || discord.username || 'User';
            const uniqueHandle = yield generateUniqueHandle(displayName, '');
            const newUser = {
                id: crypto_1.default.randomUUID(),
                discordId: discord.id,
                firstName: displayName.split(' ')[0] || 'User',
                lastName: '',
                name: displayName,
                email,
                avatar: discordAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`,
                avatarType: 'url',
                handle: uniqueHandle,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastLogin: new Date().toISOString(),
                auraCredits: 100,
                trustScore: 10,
                activeGlow: 'none',
                acquaintances: [],
                blockedUsers: [],
                refreshTokens: []
            };
            yield db.collection('users').insertOne(newUser);
            userToReturn = newUser;
        }
        const newAccessToken = (0, jwtUtils_1.generateAccessToken)(userToReturn);
        const newRefreshToken = (0, jwtUtils_1.generateRefreshToken)(userToReturn);
        yield db.collection('users').updateOne({ id: userToReturn.id }, { $push: { refreshTokens: newRefreshToken } });
        (0, jwtUtils_1.setTokenCookies)(res, newAccessToken, newRefreshToken);
        const frontendUrl = process.env.VITE_FRONTEND_URL ||
            (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://www.aura.net.za');
        return res.redirect(`${frontendUrl}/feed`);
    }
    catch (e) {
        console.error('Discord OAuth callback error:', ((_a = e === null || e === void 0 ? void 0 : e.response) === null || _a === void 0 ? void 0 : _a.data) || e.message);
        return res.redirect('/login?error=discord_callback_error');
    }
}));
// ============ MAGIC LINK ============
router.post("/magic-link", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('🔹 POST /magic-link hit with body:', req.body);
    try {
        const { email, inviteToken } = req.body || {};
        if (!email) {
            console.log('❌ Email missing in request body');
            return res.status(400).json({ success: false, message: "Email is required" });
        }
        const db = (0, db_1.getDB)();
        const normalizedEmail = String(email).toLowerCase().trim();
        console.log('🔍 Searching for user:', normalizedEmail);
        let user = yield db.collection("users").findOne({ email: normalizedEmail });
        // Create user if not exists (Sign Up via Magic Link)
        if (!user) {
            console.log('➕ User not found. Creating new user for email:', normalizedEmail);
            const firstName = normalizedEmail.split('@')[0];
            const uniqueHandle = yield generateUniqueHandle(firstName, '');
            const newUser = {
                id: crypto_1.default.randomUUID(),
                email: normalizedEmail,
                firstName: firstName,
                lastName: '',
                name: firstName,
                handle: uniqueHandle,
                avatar: `https://ui-avatars.com/api/?name=${firstName}&background=random`,
                avatarType: 'url',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastLogin: new Date().toISOString(),
                auraCredits: 100,
                trustScore: 10,
                activeGlow: 'none',
                acquaintances: [],
                blockedUsers: [],
                refreshTokens: []
            };
            yield db.collection("users").insertOne(newUser);
            user = newUser;
            console.log('✓ Created new user for magic link:', user.id);
        }
        else {
            console.log('✅ User found:', user.id);
        }
        const token = (0, tokenUtils_1.generateMagicToken)();
        const tokenHash = (0, tokenUtils_1.hashToken)(token);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
        const updates = {
            magicLinkTokenHash: tokenHash,
            magicLinkExpiresAt: expiresAt.toISOString(),
            updatedAt: new Date().toISOString(),
        };
        // Store invite token if provided so it can be processed on verify
        if (inviteToken) {
            updates.pendingInviteToken = inviteToken;
        }
        yield db.collection("users").updateOne({ id: user.id }, { $set: updates });
        const frontendUrl = process.env.VITE_FRONTEND_URL ||
            (req.headers.origin ? req.headers.origin.toString() :
                (process.env.NODE_ENV === "development" ? "http://localhost:5173" : "https://www.aura.net.za"));
        const magicLink = `${frontendUrl}/magic-login?token=${token}&email=${encodeURIComponent(normalizedEmail)}`;
        console.log('📧 Attempting to send magic link email to:', normalizedEmail);
        yield (0, emailService_1.sendMagicLinkEmail)(normalizedEmail, magicLink);
        console.log('✅ sendMagicLinkEmail completed');
        return res.json({ success: true, message: "If that email exists, a link was sent." });
    }
    catch (e) {
        console.error("❌ magic-link error:", e);
        return res.status(500).json({
            success: false,
            message: e.message || "Internal server error"
        });
    }
}));
router.post("/magic-link/verify", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, token } = req.body || {};
        if (!email || !token) {
            return res.status(400).json({ success: false, message: "Email and token are required" });
        }
        const db = (0, db_1.getDB)();
        const normalizedEmail = String(email).toLowerCase().trim();
        const user = yield db.collection("users").findOne({ email: normalizedEmail });
        if (!(user === null || user === void 0 ? void 0 : user.magicLinkTokenHash) || !(user === null || user === void 0 ? void 0 : user.magicLinkExpiresAt)) {
            return res.status(401).json({ success: false, message: "Invalid or expired link" });
        }
        const expiresAt = new Date(user.magicLinkExpiresAt);
        if (Date.now() > expiresAt.getTime()) {
            return res.status(401).json({ success: false, message: "Link expired" });
        }
        const tokenHash = (0, tokenUtils_1.hashToken)(String(token));
        if (tokenHash !== user.magicLinkTokenHash) {
            return res.status(401).json({ success: false, message: "Invalid or expired link" });
        }
        // one-time use
        const unsetFields = { magicLinkTokenHash: "", magicLinkExpiresAt: "" };
        if (user.pendingInviteToken) {
            unsetFields.pendingInviteToken = "";
        }
        yield db.collection("users").updateOne({ id: user.id }, {
            $unset: unsetFields,
            $set: { lastLogin: new Date().toISOString() }
        });
        // If there was a pending invite, automatically accept it
        if (user.pendingInviteToken) {
            console.log(`🔗 Processing pending invite ${user.pendingInviteToken} for user ${user.id}`);
            try {
                const invite = yield db.collection('company_invites').findOne({
                    token: user.pendingInviteToken,
                    expiresAt: { $gt: new Date() },
                    acceptedAt: { $exists: false }
                });
                if (invite) {
                    // Add to members
                    yield db.collection('company_members').updateOne({ companyId: invite.companyId, userId: user.id }, {
                        $set: {
                            companyId: invite.companyId,
                            userId: user.id,
                            role: invite.role,
                            joinedAt: new Date()
                        }
                    }, { upsert: true });
                    // Mark invite as accepted
                    yield db.collection('company_invites').updateOne({ _id: invite._id }, { $set: { acceptedAt: new Date(), acceptedByUserId: user.id } });
                    console.log(`✅ Automatically accepted invite for user ${user.id}`);
                }
            }
            catch (inviteErr) {
                console.error('Error auto-accepting invite:', inviteErr);
            }
        }
        const accessToken = (0, jwtUtils_1.generateAccessToken)(user);
        const refreshToken = (0, jwtUtils_1.generateRefreshToken)(user);
        yield db.collection("users").updateOne({ id: user.id }, { $push: { refreshTokens: refreshToken } });
        (0, jwtUtils_1.setTokenCookies)(res, accessToken, refreshToken);
        return res.json({ success: true, user: (0, userUtils_1.transformUser)(user), token: accessToken });
    }
    catch (e) {
        console.error("magic-link verify error:", e);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
}));
// ============ REFRESH TOKEN ============
router.post('/refresh-token', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('🔄 POST /refresh-token hit');
    console.log('   - Cookies:', req.cookies);
    console.log('   - Origin:', req.headers.origin);
    try {
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) {
            console.log('❌ No refresh token in cookies');
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
            user: (0, userUtils_1.transformUser)(user),
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
            console.log('🔍 GitHub OAuth - Checking for existing user with ID:', userData.id);
            // Identify-First: Check by EMAIL
            const existingUser = yield db.collection('users').findOne({
                email: userData.email
            });
            let userToReturn;
            if (existingUser) {
                console.log('✓ Found existing user by email:', existingUser.email);
                const updates = {
                    lastLogin: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    // Always link the ID of the current provider
                    githubId: userData.githubId || existingUser.githubId,
                };
                // DO NOT update these if they already exist
                // This keeps the user's chosen identity intact
                if (!existingUser.handle)
                    updates.handle = userData.handle;
                if (!existingUser.firstName)
                    updates.firstName = userData.firstName;
                if (!existingUser.avatar)
                    updates.avatar = userData.avatar;
                yield db.collection('users').updateOne({ id: existingUser.id }, { $set: updates });
                userToReturn = Object.assign(Object.assign({}, existingUser), updates);
            }
            else {
                console.log('➕ New user from GitHub OAuth');
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
                (req.headers.origin ? req.headers.origin.toString() :
                    (process.env.NODE_ENV === 'development' ? 'http://localhost:5003' : 'https://www.aura.net.za'));
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
        user: (0, userUtils_1.transformUser)(user)
    });
});
// ============ LOGOUT ============
router.post('/logout', authMiddleware_1.attachUser, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const refreshToken = req.cookies.refreshToken;
        const user = req.user;
        if (refreshToken) {
            const db = (0, db_1.getDB)();
            // Try to find user ID from token or request
            let userId = user === null || user === void 0 ? void 0 : user.id;
            if (!userId) {
                const decoded = (0, jwtUtils_1.verifyRefreshToken)(refreshToken);
                if (decoded) {
                    userId = decoded.id;
                }
            }
            if (userId) {
                yield db.collection('users').updateOne({ id: userId }, {
                    $set: {
                        refreshTokens: [],
                        lastActive: new Date().toISOString()
                    }
                });
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
            user: (0, userUtils_1.transformUser)(req.user),
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
        user: isAuthenticated ? (0, userUtils_1.transformUser)(req.user) : null
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
                user: (0, userUtils_1.transformUser)(user),
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
// ============ COMPLETE OAUTH PROFILE ============
router.post('/complete-oauth-profile', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { firstName, lastName, bio, industry, companyName, handle } = req.body;
        const tempOAuthData = (_a = req.session) === null || _a === void 0 ? void 0 : _a.tempOAuthData;
        if (!tempOAuthData) {
            return res.status(400).json({
                success: false,
                error: 'Missing OAuth data',
                message: 'Session expired. Please log in again.'
            });
        }
        const db = (0, db_1.getDB)();
        const handleValidation = validateHandleFormat(handle);
        if (!handleValidation.ok) {
            return res.status(400).json({
                success: false,
                error: 'Invalid handle',
                message: handleValidation.message || 'Invalid handle'
            });
        }
        const normalizedHandle = normalizeUserHandle(handle);
        const existingHandleUser = yield db.collection('users').findOne({ handle: normalizedHandle });
        if (existingHandleUser) {
            return res.status(409).json({
                success: false,
                error: 'Handle taken',
                message: 'This handle is already taken. Please try another one.'
            });
        }
        const newUser = {
            id: tempOAuthData.id,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: tempOAuthData.email,
            avatar: tempOAuthData.avatar,
            avatarType: tempOAuthData.avatarType || 'image',
            googleId: tempOAuthData.googleId,
            githubId: tempOAuthData.githubId,
            handle: normalizedHandle,
            bio: (bio === null || bio === void 0 ? void 0 : bio.trim()) || '',
            industry: industry || 'Other',
            companyName: (companyName === null || companyName === void 0 ? void 0 : companyName.trim()) || '',
            trustScore: 10,
            auraCredits: 100,
            activeGlow: 'none',
            acquaintances: [],
            blockedUsers: [],
            refreshTokens: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
        };
        yield db.collection('users').insertOne(newUser);
        console.log('✓ Completed OAuth profile for new user:', newUser.id, '| Handle:', normalizedHandle);
        const accessToken = (0, jwtUtils_1.generateAccessToken)(newUser);
        const refreshToken = (0, jwtUtils_1.generateRefreshToken)(newUser);
        yield db.collection('users').updateOne({ id: newUser.id }, { $push: { refreshTokens: refreshToken } });
        (0, jwtUtils_1.setTokenCookies)(res, accessToken, refreshToken);
        req.session.tempOAuthData = null;
        res.json({
            success: true,
            user: newUser,
            token: accessToken,
            message: 'Profile completed successfully'
        });
    }
    catch (error) {
        console.error('Error completing OAuth profile:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to complete profile',
            message: 'Internal server error'
        });
    }
}));
router.post('/register', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, email, phone, dob, password, handle } = req.body;
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
        let normalizedHandle = null;
        if (handle) {
            const handleValidation = validateHandleFormat(handle);
            if (!handleValidation.ok) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid handle',
                    message: handleValidation.message || 'Invalid handle'
                });
            }
            normalizedHandle = normalizeUserHandle(handle);
            const existingByHandle = yield db.collection('users').findOne({ handle: normalizedHandle });
            if (existingByHandle) {
                return res.status(409).json({
                    success: false,
                    error: 'Handle taken',
                    message: 'This handle is already taken. Please try another one.'
                });
            }
        }
        const passwordHash = yield bcryptjs_1.default.hash(password, 10);
        const finalHandle = normalizedHandle || (yield generateUniqueHandle(firstName, lastName));
        const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newUser = {
            id: userId,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: normalizedEmail,
            phone: (phone === null || phone === void 0 ? void 0 : phone.trim()) || '',
            handle: finalHandle,
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
