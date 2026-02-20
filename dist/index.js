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
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const passport_1 = __importDefault(require("passport"));
const express_session_1 = __importDefault(require("express-session"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const multer_1 = __importDefault(require("multer"));
const passport_google_oauth20_1 = require("passport-google-oauth20");
const passport_github2_1 = require("passport-github2");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const geminiRoutes_1 = __importDefault(require("./routes/geminiRoutes"));
const uploadRoutes_1 = __importDefault(require("./routes/uploadRoutes"));
const postsRoutes_1 = __importDefault(require("./routes/postsRoutes"));
const usersRoutes_1 = __importDefault(require("./routes/usersRoutes"));
const adsRoutes_1 = __importDefault(require("./routes/adsRoutes"));
const commentsRoutes_1 = __importDefault(require("./routes/commentsRoutes"));
const notificationsRoutes_1 = __importDefault(require("./routes/notificationsRoutes"));
const messagesRoutes_1 = __importDefault(require("./routes/messagesRoutes"));
const subscriptionsRoutes_1 = __importDefault(require("./routes/subscriptionsRoutes"));
const adSubscriptionsRoutes_1 = __importDefault(require("./routes/adSubscriptionsRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const privacyRoutes_1 = __importDefault(require("./routes/privacyRoutes"));
const shareRoutes_1 = __importDefault(require("./routes/shareRoutes"));
const mediaRoutes_1 = __importDefault(require("./routes/mediaRoutes"));
const companyRoutes_1 = __importDefault(require("./routes/companyRoutes"));
const reportsRoutes_1 = __importStar(require("./routes/reportsRoutes"));
const ownerControlRoutes_1 = __importDefault(require("./routes/ownerControlRoutes"));
const jobsRoutes_1 = __importDefault(require("./routes/jobsRoutes"));
const authMiddleware_1 = require("./middleware/authMiddleware");
const csrfMiddleware_1 = require("./middleware/csrfMiddleware");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("./db");
const trustService_1 = require("./services/trustService");
const migrationService_1 = require("./services/migrationService");
const socket_io_1 = require("socket.io");
const userUtils_1 = require("./utils/userUtils");
const jwtUtils_1 = require("./utils/jwtUtils");
const identityUtils_1 = require("./utils/identityUtils");
const socketHub_1 = require("./realtime/socketHub");
const CallLog_1 = require("./models/CallLog");
dotenv_1.default.config();
// Debug: Check SendGrid Config
if (process.env.SENDGRID_API_KEY) {
    const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aura.net.za'}>`;
    console.log(`✅ SendGrid configured with API Key and From: "${from}"`);
}
else {
    console.warn('⚠️ SendGrid NOT configured:');
    if (!process.env.SENDGRID_API_KEY)
        console.warn('   - Missing SENDGRID_API_KEY');
}
// Passport Google OAuth Strategy Configuration
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport_1.default.use(new passport_google_oauth20_1.Strategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`
    }, (_accessToken, _refreshToken, profile, done) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        try {
            // Parse name from profile
            const displayName = profile.displayName || '';
            const nameParts = displayName.trim().split(/\s+/);
            const firstName = nameParts[0] || 'User';
            const lastName = nameParts.slice(1).join(' ') || '';
            const email = (_b = (_a = profile.emails) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.value;
            const isVerified = (_d = (_c = profile.emails) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.verified;
            if (!email) {
                return done(new Error('Google account does not have an email address'), undefined);
            }
            if (isVerified === false) {
                return done(new Error('Google email is not verified. Please verify your email on Google.'), undefined);
            }
            // Create user object with Google profile data
            const user = {
                id: profile.id,
                googleId: profile.id,
                firstName: firstName,
                lastName: lastName,
                name: displayName || `${firstName} ${lastName}`.trim(),
                email: email.toLowerCase().trim(),
                avatar: ((_f = (_e = profile.photos) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.value) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
                avatarType: 'image',
                handle: `@${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s+/g, '')}${Math.floor(Math.random() * 10000)}`,
                bio: 'New to Aura©',
                industry: 'Other',
                companyName: '',
                phone: '',
                dob: '',
                acquaintances: [],
                blockedUsers: [],
                trustScore: 10,
                auraCredits: 100,
                activeGlow: 'none'
            };
            return done(null, user);
        }
        catch (error) {
            console.error('Error in Google OAuth strategy:', error);
            return done(error, undefined);
        }
    })));
}
else {
    console.warn('⚠️ Google OAuth environment variables not found. Google login will not be available.');
}
// Serialize user for session - store user ID
passport_1.default.serializeUser((user, done) => {
    done(null, user.id);
});
// Deserialize user from session - fetch full user data from database
passport_1.default.deserializeUser((id, done) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = (0, db_1.getDB)();
        const user = yield db.collection('users').findOne({ id });
        if (user) {
            done(null, (0, userUtils_1.transformUser)(user));
        }
        else {
            done(null, false);
        }
    }
    catch (error) {
        console.error('Error deserializing user:', error);
        done(error, null);
    }
}));
const app = (0, express_1.default)();
exports.app = app;
const PORT = process.env.PORT || 5000;
// Security & Optimization Middleware
// Ensure uploads directory exists
const uploadsDir = path_1.default.join(process.cwd(), 'uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
// Enable trust proxy for secure cookies behind load balancers (like Render/Heroku)
app.set("trust proxy", 1);
// CORS Configuration
const normalizeOrigin = (origin) => origin.trim().replace(/\/$/, '').toLowerCase();
const parseEnvOriginList = (value) => {
    if (!value)
        return [];
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map(normalizeOrigin);
};
const STATIC_ALLOWED_ORIGINS = [
    "https://www.aura.net.za",
    "https://aura.net.za",
    "https://auraso.vercel.app",
    "https://www.auraso.vercel.app",
    "https://auraradiance.vercel.app",
    "https://www.auraradiance.vercel.app",
    "https://aura-front-s1bw.onrender.com",
    "http://localhost:5173",
    "http://localhost:5003",
].map(normalizeOrigin);
const allowedOrigins = Array.from(new Set([
    ...STATIC_ALLOWED_ORIGINS,
    ...parseEnvOriginList(process.env.CORS_ALLOWED_ORIGINS),
    ...(process.env.VITE_FRONTEND_URL ? [normalizeOrigin(process.env.VITE_FRONTEND_URL)] : []),
    ...(process.env.FRONTEND_URL ? [normalizeOrigin(process.env.FRONTEND_URL)] : []),
]));
const corsOptions = {
    origin: (origin, cb) => {
        // allow non-browser tools (no origin) and allow your frontends
        if (!origin)
            return cb(null, true);
        // Normalize origin by removing trailing slash
        const normalizedOrigin = normalizeOrigin(origin);
        // Strict allowlist with explicit origins only.
        if (allowedOrigins.includes(normalizedOrigin)) {
            return cb(null, true);
        }
        console.error("❌ Blocked by CORS:", origin);
        // Important: call with null, false instead of Error to avoid breaking pre-flight
        return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Accept",
        "Origin",
        "x-owner-control-token",
        "X-Owner-Control-Token",
        "x-identity-type",
        "x-identity-id",
        "X-Identity-Type",
        "X-Identity-Id"
    ],
    exposedHeaders: ["Set-Cookie"],
    optionsSuccessStatus: 204
};
// Apply CORS before ANY other middleware
app.use((0, cors_1.default)(corsOptions));
app.options(/.*/, (0, cors_1.default)(corsOptions));
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Security & Optimization Middleware
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false, // Disabled to avoid breaking external resources (images, scripts)
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use((0, compression_1.default)());
app.use((0, morgan_1.default)(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// Global Rate Limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter);
app.use((0, cookie_parser_1.default)());
app.use('/api', (0, csrfMiddleware_1.createCsrfProtection)({ allowedOrigins }));
// Passport GitHub OAuth Strategy Configuration
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport_1.default.use(new passport_github2_1.Strategy({
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: process.env.GITHUB_CALLBACK_URL || "https://aura-back-s1bw.onrender.com/api/auth/github/callback",
        scope: ['user:email']
    }, (_accessToken, _refreshToken, profile, done) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const displayName = profile.displayName || '';
            const username = profile.username || 'githubuser';
            const nameParts = displayName.trim().split(/\s+/);
            const firstName = nameParts[0] || username;
            const lastName = nameParts.slice(1).join(' ') || '';
            const emailObj = (_a = profile.emails) === null || _a === void 0 ? void 0 : _a[0];
            const email = (emailObj && emailObj.value) || `${username}@github`;
            // Enforce email verification if available
            if (emailObj && emailObj.verified === false) {
                return done(new Error('GitHub email is not verified. Please verify your email on GitHub.'), undefined);
            }
            const user = {
                id: profile.id,
                githubId: profile.id,
                firstName,
                lastName,
                name: displayName || username,
                email: email.toLowerCase().trim(),
                avatar: (profile.photos && profile.photos[0] && profile.photos[0].value) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
                avatarType: 'image',
                handle: `@${username.toLowerCase()}${Math.floor(Math.random() * 10000)}`,
                bio: 'New to Aura©',
                industry: 'Other',
                companyName: '',
                phone: '',
                dob: '',
                acquaintances: [],
                blockedUsers: [],
                trustScore: 10,
                auraCredits: 100,
                activeGlow: 'none'
            };
            return done(null, user);
        }
        catch (error) {
            console.error('Error in GitHub OAuth strategy:', error);
            return done(error, undefined);
        }
    })));
}
else {
    console.warn('⚠️ GitHub OAuth environment variables not found. GitHub login will not be available.');
}
// Session middleware
const configuredSessionSecret = (process.env.SESSION_SECRET || '').trim();
const jwtSecretFallback = (process.env.JWT_SECRET || '').trim();
const isProductionRuntime = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || !!process.env.RENDER;
const sessionSecret = configuredSessionSecret || jwtSecretFallback;
if (!sessionSecret && isProductionRuntime) {
    throw new Error('SESSION_SECRET is required in production');
}
if (!configuredSessionSecret && jwtSecretFallback && isProductionRuntime) {
    console.warn('⚠️ SESSION_SECRET is not set. Falling back to JWT_SECRET for session signing.');
}
app.use((0, express_session_1.default)({
    secret: sessionSecret || 'fallback_secret_for_development',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production' || process.env.RENDER === 'true', // Secure in production or on Render
        sameSite: (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
// Passport middleware
app.use(passport_1.default.initialize());
app.use(passport_1.default.session());
// Apply security headers for PayPal SDK compatibility
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.paypal.com https://www.paypalobjects.com https://js.braintreegateway.com https://*.paypal.com;");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Permissions-Policy', 'unload=*');
    next();
});
// Middleware for general request processing
app.use((req, res, next) => {
    // Set headers to fix Cross-Origin-Opener-Policy issues with popups
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Permissions-Policy', 'unload=*');
    next();
});
// Pre-flight handling is managed by CORS middleware above
app.use((0, cookie_parser_1.default)());
// Debug middleware to log all requests in non-production environments
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`🔍 Request: ${req.method} ${req.path} - ${new Date().toISOString()}`);
        next();
    });
}
// Serve uploaded files statically
app.use('/uploads', express_1.default.static(uploadsDir));
// Routes
console.log('Registering routes...');
// Authentication routes (should come first)
app.use('/api/auth', authRoutes_1.default);
// Privacy routes
app.use('/api/privacy', privacyRoutes_1.default);
// Share routes (public, no auth required, serves HTML for crawlers)
app.use('/share', shareRoutes_1.default);
// Apply user attachment middleware to all API routes
app.use('/api', authMiddleware_1.attachUser);
app.use('/api/users', (req, res, next) => {
    console.log(`Users route hit: ${req.method} ${req.path}`);
    next();
}, usersRoutes_1.default);
// Logout route (legacy - moved to /auth)
app.get('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Error during logout:', err);
        }
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
            }
            // Clear the session object properly
            req.session = undefined;
            res.json({ success: true, message: 'Logged out successfully' });
        });
    });
});
// Get current user info (legacy - moved to /auth)
app.get('/auth/user', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        res.json({ user: (0, userUtils_1.transformUser)(req.user) });
    }
    else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});
app.get('/api/debug/env', (req, res) => {
    const actor = req.user;
    const isAdmin = !!(actor && (actor.role === 'admin' || actor.isAdmin === true));
    if (process.env.NODE_ENV === 'production' && !isAdmin) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({
        frontendUrl: process.env.VITE_FRONTEND_URL,
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        hasGoogleOAuthConfig: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        hasGitHubOAuthConfig: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
        allowedOrigins: [
            process.env.VITE_FRONTEND_URL,
            "https://auraso.vercel.app",
            "https://www.auraso.vercel.app",
            "http://localhost:5173"
        ].filter(Boolean)
    });
});
app.get('/api/debug/cookies', (req, res) => {
    const actor = req.user;
    const isAdmin = !!(actor && (actor.role === 'admin' || actor.isAdmin === true));
    if (process.env.NODE_ENV === 'production' && !isAdmin) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({
        cookies: req.cookies,
        signedCookies: req.signedCookies,
        headers: req.headers
    });
});
app.get('/api/debug/sendgrid', (req, res) => {
    const actor = req.user;
    const isAdmin = !!(actor && (actor.role === 'admin' || actor.isAdmin === true));
    if (process.env.NODE_ENV === 'production' && !isAdmin) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM || 'no-reply@aura.net.za';
    res.json({
        hasApiKey: !!apiKey,
        apiKeyPreview: apiKey ? `${apiKey.substring(0, 5)}...` : null,
        fromEmail: fromEmail,
        env: process.env.NODE_ENV
    });
});
app.get('/api/credits/history/:userId', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        const actor = req.user;
        const isAdmin = !!(actor && (actor.role === 'admin' || actor.isAdmin === true));
        if (!(actor === null || actor === void 0 ? void 0 : actor.id)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        if (!isAdmin && actor.id !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden'
            });
        }
        if (!(0, db_1.isDBConnected)()) {
            return res.status(503).json({
                success: false,
                error: 'Service Unavailable',
                message: 'Database service is currently unavailable'
            });
        }
        const db = (0, db_1.getDB)();
        const transactions = yield db
            .collection('transactions')
            .find({ userId, type: 'credit_purchase' })
            .sort({ createdAt: -1 })
            .limit(100)
            .toArray();
        res.json({
            success: true,
            data: transactions
        });
    }
    catch (error) {
        console.error('Error fetching credit history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch credit history',
            message: 'Internal server error'
        });
    }
}));
// Direct test route for debugging
app.post('/api/users/direct-test', (req, res) => {
    console.log('Direct test route hit!');
    res.json({ success: true, message: 'Direct route working!' });
});
app.use('/api/gemini', geminiRoutes_1.default);
app.use('/api/upload', uploadRoutes_1.default);
app.use('/api/posts', postsRoutes_1.default);
app.use('/api/ads', adsRoutes_1.default);
// Mount comments routes at /api so routes like /api/posts/:postId/comments work
app.use('/api', commentsRoutes_1.default);
app.use('/api/notifications', notificationsRoutes_1.default);
app.use('/api/messages', messagesRoutes_1.default);
app.use('/api/subscriptions', subscriptionsRoutes_1.default);
app.use('/api/ad-subscriptions', adSubscriptionsRoutes_1.default);
app.use('/api', jobsRoutes_1.default);
app.use('/api', mediaRoutes_1.default);
app.use('/api/companies', companyRoutes_1.default);
app.use('/api/reports', reportsRoutes_1.default);
app.use('/api/owner-control', ownerControlRoutes_1.default);
app.get('/payment-success', (req, res) => {
    const pkg = typeof req.query.pkg === 'string' ? req.query.pkg : undefined;
    const pkgParam = pkg ? `&pkg=${encodeURIComponent(pkg)}` : '';
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Successful - Aura©</title>
          <meta http-equiv="refresh" content="3;url=/?payment=success${pkgParam}">
          <style>
            body { font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0fdf4; }
            .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); text-align: center; max-width: 400px; }
            h1 { color: #166534; margin-bottom: 1rem; }
            p { color: #374151; margin-bottom: 2rem; }
            .btn { background: #16a34a; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 500; }
          </style>
        </head>
        <body>
          <div class="success">✅ Payment Successful!</div>
          <div class="message">If your payment was completed, your access will be activated shortly after verification.</div>
          <div class="message">Redirecting you back to Aura©...</div>
          <script>
            setTimeout(function() {
              window.location.href = '/?payment=success${pkgParam}';
            }, 3000);
          </script>
        </body>
        </html>
      `);
});
app.get('/payment-cancelled', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('❌ Payment cancelled by user');
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled - Aura©</title>
      <meta http-equiv="refresh" content="3;url=/">
      <style>
        body { font-family: system-ui; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; text-align: center; padding: 4rem; }
        .cancelled { font-size: 3rem; margin-bottom: 1rem; }
        .message { font-size: 1.2rem; opacity: 0.9; }
      </style>
    </head>
    <body>
      <div class="cancelled">❌ Payment Cancelled</div>
      <div class="message">You can return to the app anytime to complete your purchase.</div>
    </body>
    </html>
  `);
}));
console.log('Routes registered successfully');
// Health check endpoints
app.get('/health', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const dbHealthy = yield (0, db_1.checkDBHealth)();
    const status = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: {
            connected: (0, db_1.isDBConnected)(),
            healthy: dbHealthy,
            status: dbHealthy ? 'connected' : 'disconnected'
        },
        memory: process.memoryUsage(),
        version: process.version
    };
    res.status(dbHealthy ? 200 : 503).json(status);
}));
app.get('/health/db', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const dbHealthy = yield (0, db_1.checkDBHealth)();
    res.status(dbHealthy ? 200 : 503).json({
        database: {
            connected: (0, db_1.isDBConnected)(),
            healthy: dbHealthy,
            status: dbHealthy ? 'connected' : 'disconnected',
            timestamp: new Date().toISOString()
        }
    });
}));
// Test route
app.get('/api/test', (_req, res) => {
    res.json({
        message: 'API routes are working!',
        timestamp: new Date(),
        database: (0, db_1.isDBConnected)() ? 'connected' : 'disconnected'
    });
});
// Test POST route
app.post('/api/test-post', (_req, res) => {
    console.log('Test POST route hit!');
    res.json({
        message: 'POST route working!',
        timestamp: new Date(),
        database: (0, db_1.isDBConnected)() ? 'connected' : 'disconnected'
    });
});
// Simple POST route at root level
app.post('/test-simple', (_req, res) => {
    console.log('Simple POST route hit!');
    res.json({ message: 'Simple POST working!' });
});
// Direct users test route
app.get('/api/users-direct', (_req, res) => {
    res.json({
        message: 'Direct users route working!',
        database: (0, db_1.isDBConnected)() ? 'connected' : 'disconnected'
    });
});
app.get('/', (_req, res) => {
    res.json({
        message: 'Aura© Social Backend is running',
        status: 'ok',
        database: (0, db_1.isDBConnected)() ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});
// Enhanced error handling middleware
app.use((err, _req, res, _next) => {
    if (err instanceof multer_1.default.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({
            success: false,
            error: 'Invalid upload',
            message: err.code === 'LIMIT_FILE_SIZE'
                ? 'Uploaded file exceeds the 15MB limit'
                : err.message
        });
    }
    if (err instanceof Error && err.message.startsWith('Unsupported file type:')) {
        return res.status(400).json({
            success: false,
            error: 'Invalid upload',
            message: err.message
        });
    }
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});
// 404 handler
app.use((_req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not found',
        message: `Route ${_req.method} ${_req.originalUrl} not found`
    });
});
function loadDemoPostsIfEmpty() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)())
                return;
            const db = (0, db_1.getDB)();
            const count = yield db.collection('posts').countDocuments({});
            if (count > 0)
                return;
            const now = Date.now();
            const authors = [
                {
                    id: 'demo-editorial',
                    firstName: 'Aura',
                    lastName: 'Editorial',
                    name: 'Aura© Editorial Desk',
                    handle: '@auranews',
                    avatar: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=256&auto=format&fit=crop',
                    avatarType: 'image',
                    bio: 'Curated news and insights for modern creators and operators.',
                    trustScore: 90,
                    auraCredits: 0,
                    activeGlow: 'emerald'
                },
                {
                    id: 'demo-founder',
                    firstName: 'Nova',
                    lastName: 'Reyes',
                    name: 'Nova Reyes',
                    handle: '@novabuilds',
                    avatar: 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?q=80&w=256&auto=format&fit=crop',
                    avatarType: 'image',
                    bio: 'Bootstrapped founder sharing playbooks from the trenches.',
                    trustScore: 82,
                    auraCredits: 0,
                    activeGlow: 'none'
                },
                {
                    id: 'demo-leadership',
                    firstName: 'Elena',
                    lastName: 'Kho',
                    name: 'Elena Kho',
                    handle: '@elenaleads',
                    avatar: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?q=80&w=256&auto=format&fit=crop',
                    avatarType: 'image',
                    bio: 'Leadership coach for high-signal teams and creators.',
                    trustScore: 88,
                    auraCredits: 0,
                    activeGlow: 'amber'
                },
                {
                    id: 'demo-agency',
                    firstName: 'Signal',
                    lastName: 'Studio',
                    name: 'Signal Studio',
                    handle: '@signalstudio',
                    avatar: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?q=80&w=256&auto=format&fit=crop',
                    avatarType: 'image',
                    bio: 'Creative performance agency for ambitious brands.',
                    trustScore: 76,
                    auraCredits: 0,
                    activeGlow: 'none'
                }
            ];
            const [editorial, founder, leadership, agency] = authors;
            const posts = [
                {
                    id: 'demo-news-1',
                    author: editorial,
                    content: 'News: Independent creators just overtook legacy agencies on total campaign volume for the first time this quarter. Brands are reallocating up to 32% of paid media into creator-led storytelling.\n\nKey shifts:\n• Briefs are shorter, but context is deeper\n• Performance is measured in conversations, not just clicks\n• Creative approval cycles dropped from 21 days to 4\n\n#News #CreatorEconomy #Marketing',
                    mediaUrl: 'https://images.unsplash.com/photo-1522199755839-a2bacb67c546?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    energy: '💡 Deep Dive',
                    radiance: 180,
                    viewCount: 1243,
                    timestamp: now - 2 * 24 * 60 * 60 * 1000,
                    reactions: { '💡': 38, '📈': 21 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#News', '#CreatorEconomy', '#Marketing'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-news-2',
                    author: editorial,
                    content: 'Market Update: Short-form business explainers are now the fastest growing category on Aura©, outpacing lifestyle and entertainment in week-over-week growth.\n\nIf you can teach clearly for 60 seconds, you can open an entirely new acquisition channel.\n\n#News #Business #Education',
                    mediaUrl: 'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    energy: '⚡ High Energy',
                    radiance: 132,
                    viewCount: 986,
                    timestamp: now - 7 * 24 * 60 * 60 * 1000,
                    reactions: { '⚡': 44, '💬': 17 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#News', '#Business', '#ShortForm'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-founder-1',
                    author: founder,
                    content: 'Entrepreneurship: I turned a freelance editing habit into a productized “creator ops” studio doing $45k/m with a 3-person remote team.\n\nSimple playbook:\n1) Pick one painful workflow creators avoid\n2) Productize it into a clear package with a fixed scope\n3) Layer in async check-ins instead of endless calls\n4) Let your own content be the top-of-funnel\n\nIt is easier to scale a boring, repeatable service than a clever idea.\n\n#Entrepreneurship #CreatorOps #Playbook',
                    energy: '💡 Deep Dive',
                    radiance: 210,
                    viewCount: 2113,
                    timestamp: now - 5 * 24 * 60 * 60 * 1000,
                    reactions: { '💡': 61, '🔥': 24 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: true,
                    hashtags: ['#Entrepreneurship', '#CreatorOps', '#Playbook'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-founder-2',
                    author: founder,
                    content: 'Thread: 7 systems that took my content business from “posting randomly” to “running a proper company”.\n\n1) Monday: “pipeline” review instead of inbox review\n2) A single Notion board shared with all collaborators\n3) One analytics dashboard per offer, not per platform\n4) Weekly “kill meeting” to end weak experiments\n5) 90-minute deep work block reserved for writing\n6) Quarterly price review for every product\n7) Written operating principles so new hires onboard themselves\n\n#Entrepreneur #Systems #Execution',
                    energy: '🪐 Neutral',
                    radiance: 164,
                    viewCount: 1542,
                    timestamp: now - 10 * 24 * 60 * 60 * 1000,
                    reactions: { '📌': 33, '🧠': 29 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#Entrepreneur', '#Systems', '#Execution'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-leadership-1',
                    author: leadership,
                    content: 'Leadership note: Your team does not need more dashboards, they need more clarity.\n\nAsk this in your next standup:\n\n“What are we definitely not doing this week?”\n\nRemoving noise is the highest form of leadership inside a high-signal organization.\n\n#Leadership #Focus #Teams',
                    energy: '🌿 Calm',
                    radiance: 142,
                    viewCount: 879,
                    timestamp: now - 15 * 24 * 60 * 60 * 1000,
                    reactions: { '🌿': 47, '💡': 19 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#Leadership', '#Focus', '#Teams'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-leadership-2',
                    author: leadership,
                    content: 'The strongest leaders in 2026 will behave like great editors, not great managers.\n\nThey will:\n• Cut confusing projects\n• Trim bloated meetings\n• Rewrite vague goals into sharp sentences\n• Protect deep work like a scarce resource\n\nEdit the environment and your people will surprise you.\n\n#Leadership #Culture #Editing',
                    energy: '💡 Deep Dive',
                    radiance: 188,
                    viewCount: 1324,
                    timestamp: now - 30 * 24 * 60 * 60 * 1000,
                    reactions: { '✂️': 21, '✨': 34 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#Leadership', '#Culture', '#Editing'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-ad-business-1',
                    author: agency,
                    content: 'Ad: Launching a B2B podcast but worried it will become an expensive hobby?\n\nSignal Studio builds end-to-end “revenue podcasts” for SaaS and professional services.\n\nWhat we handle:\n• Strategy and show positioning\n• Guest pipeline and outreach\n• Recording, editing and clipping\n• Distribution across Aura©, LinkedIn and email\n• Revenue attribution dashboard\n\nReply “PODCAST” below and we will DM you a full case study.\n\n#B2B #Podcasting #LeadGen',
                    mediaUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    energy: '⚡ High Energy',
                    radiance: 96,
                    viewCount: 1967,
                    timestamp: now - 20 * 24 * 60 * 60 * 1000,
                    reactions: { '🎙️': 18, '📈': 12 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: true,
                    hashtags: ['#B2B', '#Podcasting', '#LeadGen'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-ad-business-2',
                    author: agency,
                    content: 'Ad: Running paid social for your business but stuck on creative?\n\nOur “Done-For-You Creative Sprint” gives you:\n• 12 ready-to-run ad concepts\n• 36 hooks tested against your audience\n• 1 brand-safe script library your team can reuse\n\nMost clients see their first winning creative within 21 days.\n\nDM “SPRINT” for the full breakdown.\n\n#Ads #BusinessGrowth #Creative',
                    energy: '🪐 Neutral',
                    radiance: 104,
                    viewCount: 743,
                    timestamp: now - 45 * 24 * 60 * 60 * 1000,
                    reactions: { '🚀': 27, '💰': 15 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#Ads', '#BusinessGrowth', '#Creative'],
                    taggedUserIds: []
                }
            ];
            yield db.collection('posts').insertMany(posts);
            console.log(`✅ Loaded ${posts.length} dummy posts into MongoDB`);
        }
        catch (error) {
            console.error('⚠️ Failed to bootstrap dummy posts:', error);
        }
    });
}
function loadDemoAdsIfEmpty() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)())
                return;
            const db = (0, db_1.getDB)();
            const count = yield db.collection('ads').countDocuments({});
            if (count > 0)
                return;
            const now = Date.now();
            const ads = [
                {
                    id: 'demo-ad-b2b-podcast',
                    ownerId: 'business-demo-1',
                    ownerName: 'Signal Studio',
                    ownerAvatar: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?q=80&w=256&auto=format&fit=crop',
                    ownerAvatarType: 'image',
                    ownerEmail: 'hello@signalstudio.io',
                    headline: 'Turn Your B2B Podcast Into a Sales Channel',
                    description: 'We build “revenue podcasts” for B2B teams. Strategy, booking, editing, clipping, and distribution across Aura© + LinkedIn, all handled for you.\n\nClients see their first SQLs within 60–90 days of launch.\n\nTap to see the full case study.',
                    mediaUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    ctaText: 'View Case Study',
                    ctaLink: 'https://example.com/b2b-podcast',
                    isSponsored: true,
                    placement: 'feed',
                    status: 'active',
                    expiryDate: now + 60 * 24 * 60 * 60 * 1000,
                    subscriptionTier: 'Aura© Radiance',
                    subscriptionId: undefined,
                    timestamp: now - 3 * 24 * 60 * 60 * 1000,
                    reactions: { '🎙️': 21, '📈': 12 },
                    reactionUsers: {},
                    hashtags: ['#B2B', '#Podcast', '#LeadGen']
                },
                {
                    id: 'demo-ad-saas-demos',
                    ownerId: 'business-demo-2',
                    ownerName: 'Pipeline Cloud',
                    ownerAvatar: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?q=80&w=256&auto=format&fit=crop',
                    ownerAvatarType: 'image',
                    ownerEmail: 'growth@pipelinecloud.io',
                    headline: 'Book 40% More Qualified Demos From the Same Traffic',
                    description: 'Pipeline Cloud turns your existing traffic into qualified demos using interactive product stories.\n\nNo redesign, no new funnel – we plug into what you already have.\n\nSee how a SaaS team lifted demo volume by 42% in 45 days.',
                    mediaUrl: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    ctaText: 'See SaaS Playbook',
                    ctaLink: 'https://example.com/saas-playbook',
                    isSponsored: true,
                    placement: 'feed',
                    status: 'active',
                    expiryDate: now + 45 * 24 * 60 * 60 * 1000,
                    subscriptionTier: 'Universal Signal',
                    subscriptionId: undefined,
                    timestamp: now - 9 * 24 * 60 * 60 * 1000,
                    reactions: { '🚀': 34, '💰': 15 },
                    reactionUsers: {},
                    hashtags: ['#SaaS', '#DemandGen', '#Revenue']
                },
                {
                    id: 'demo-ad-founder-coaching',
                    ownerId: 'business-demo-3',
                    ownerName: 'Nova Reyes',
                    ownerAvatar: 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?q=80&w=256&auto=format&fit=crop',
                    ownerAvatarType: 'image',
                    ownerEmail: 'nova@novabuilds.io',
                    headline: 'Founder Operating System for Solo and Small Teams',
                    description: 'A 6-week live program that helps founders install a simple operating system: weekly pipeline reviews, clear scorecards, and one-page strategy docs.\n\nBuilt for content-first founders and agencies who feel “busy but blurry”.',
                    mediaUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    ctaText: 'Join the Next Cohort',
                    ctaLink: 'https://example.com/founder-os',
                    isSponsored: true,
                    placement: 'feed',
                    status: 'active',
                    expiryDate: now + 30 * 24 * 60 * 60 * 1000,
                    subscriptionTier: 'Creator Pro',
                    subscriptionId: undefined,
                    timestamp: now - 14 * 24 * 60 * 60 * 1000,
                    reactions: { '💡': 18, '🌿': 9 },
                    reactionUsers: {},
                    hashtags: ['#Founder', '#Systems', '#Coaching']
                }
            ];
            yield db.collection('ads').insertMany(ads);
            console.log(`✅ Loaded ${ads.length} dummy ads into MongoDB`);
        }
        catch (error) {
            console.error('⚠️ Failed to bootstrap dummy ads:', error);
        }
    });
}
// Enhanced server startup with database connection management
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('🚀 Starting Aura© Social Backend...');
            console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔧 Port: ${PORT}`);
            const server = app.listen(PORT, () => {
                console.log(`🚀 Server is running on port ${PORT}`);
                console.log(`🌐 Health check available at: http://localhost:${PORT}/health`);
            });
            const io = new socket_io_1.Server(server, {
                cors: {
                    origin: allowedOrigins,
                    credentials: true,
                    methods: ["GET", "POST"]
                },
                transports: ['websocket', 'polling'],
                path: '/socket.io/',
                pingInterval: 25000,
                pingTimeout: 20000,
            });
            app.set('io', io);
            (0, socketHub_1.registerSocketServer)(io);
            // Socket authentication middleware
            io.use((socket, next) => {
                var _a;
                let token = (_a = socket.handshake.auth) === null || _a === void 0 ? void 0 : _a.token;
                // Fallback to cookie if token missing from auth object (for session-based logins)
                if (!token && socket.handshake.headers.cookie) {
                    const cookies = socket.handshake.headers.cookie.split(';').reduce((acc, cookie) => {
                        const [key, value] = cookie.trim().split('=');
                        acc[key] = value;
                        return acc;
                    }, {});
                    token = cookies.accessToken;
                }
                if (!token) {
                    return next(new Error('Authentication error: Token missing'));
                }
                const decoded = (0, jwtUtils_1.verifyAccessToken)(token);
                if (!decoded) {
                    return next(new Error('Authentication error: Invalid token'));
                }
                socket.user = decoded;
                next();
            });
            const identityRoom = (identityType, identityId) => `identity:${identityType}:${identityId}`;
            io.on('connection', socket => {
                const user = socket.user;
                console.log(`🔌 Socket.IO client connected: ${socket.id} (User: ${user === null || user === void 0 ? void 0 : user.id})`);
                const identityRooms = new Set();
                const joinIdentity = (identityType, identityId) => {
                    const room = identityRoom(identityType, identityId);
                    identityRooms.add(room);
                    socket.join(room);
                    return room;
                };
                if (user === null || user === void 0 ? void 0 : user.id) {
                    joinIdentity('user', user.id);
                }
                socket.on('join_user_room', (userId) => {
                    // Security: Only allow users to join their own room
                    if (user && user.id === userId) {
                        socket.join(userId);
                        console.log(`🏠 User ${user.id} joined their private room`);
                    }
                    else {
                        console.warn(`⚠️ User ${user === null || user === void 0 ? void 0 : user.id} tried to join room for ${userId}`);
                    }
                });
                socket.on('join_company_room', (companyId) => __awaiter(this, void 0, void 0, function* () {
                    if (!(user === null || user === void 0 ? void 0 : user.id) || typeof companyId !== 'string' || !companyId.trim())
                        return;
                    try {
                        const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(user.id, companyId);
                        if (!hasAccess) {
                            console.warn(`⚠️ User ${user.id} denied join_company_room for ${companyId}`);
                            return;
                        }
                        socket.join(`company_${companyId}`);
                        joinIdentity('company', companyId);
                        console.log(`🏢 User ${user.id} joined company room ${companyId}`);
                    }
                    catch (error) {
                        console.error('Failed to join company room:', error);
                    }
                }));
                socket.on('leave_user_room', (userId) => {
                    if (typeof userId === 'string' && userId.trim()) {
                        socket.leave(userId);
                    }
                });
                socket.on('leave_company_room', (companyId) => {
                    if (typeof companyId !== 'string' || !companyId.trim())
                        return;
                    socket.leave(`company_${companyId}`);
                    identityRooms.delete(identityRoom('company', companyId));
                    socket.leave(identityRoom('company', companyId));
                });
                socket.on('join_identity_room', (payload, ack) => __awaiter(this, void 0, void 0, function* () {
                    const identityType = payload === null || payload === void 0 ? void 0 : payload.identityType;
                    const identityId = payload === null || payload === void 0 ? void 0 : payload.identityId;
                    if (!identityType || !identityId) {
                        ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'identityType and identityId are required' });
                        return;
                    }
                    try {
                        if (identityType === 'user' && identityId !== (user === null || user === void 0 ? void 0 : user.id)) {
                            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized identity room' });
                            return;
                        }
                        if (identityType === 'company') {
                            const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(user === null || user === void 0 ? void 0 : user.id, identityId);
                            if (!hasAccess) {
                                ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized identity room' });
                                return;
                            }
                        }
                        const room = joinIdentity(identityType, identityId);
                        ack === null || ack === void 0 ? void 0 : ack({ success: true, room });
                    }
                    catch (error) {
                        console.error('Failed to join identity room:', error);
                        ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Failed to join identity room' });
                    }
                }));
                socket.on('leave_identity_room', (payload, ack) => {
                    const identityType = payload === null || payload === void 0 ? void 0 : payload.identityType;
                    const identityId = payload === null || payload === void 0 ? void 0 : payload.identityId;
                    if (!identityType || !identityId) {
                        ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'identityType and identityId are required' });
                        return;
                    }
                    // Keep personal room persistent while connected.
                    if (identityType === 'user' && identityId === (user === null || user === void 0 ? void 0 : user.id)) {
                        ack === null || ack === void 0 ? void 0 : ack({ success: true });
                        return;
                    }
                    const room = identityRoom(identityType, identityId);
                    identityRooms.delete(room);
                    socket.leave(room);
                    ack === null || ack === void 0 ? void 0 : ack({ success: true });
                });
                const normalizeCallPayload = (payload) => {
                    const callId = typeof (payload === null || payload === void 0 ? void 0 : payload.callId) === 'string' ? payload.callId.trim() : '';
                    const fromType = payload === null || payload === void 0 ? void 0 : payload.fromType;
                    const fromId = typeof (payload === null || payload === void 0 ? void 0 : payload.fromId) === 'string' ? payload.fromId.trim() : '';
                    const toType = payload === null || payload === void 0 ? void 0 : payload.toType;
                    const toId = typeof (payload === null || payload === void 0 ? void 0 : payload.toId) === 'string' ? payload.toId.trim() : '';
                    const callType = (payload === null || payload === void 0 ? void 0 : payload.callType) === 'video' ? 'video' : 'audio';
                    if (!callId || !fromType || !fromId || !toType || !toId) {
                        return null;
                    }
                    return {
                        callId,
                        fromType,
                        fromId,
                        toType,
                        toId,
                        callType,
                        offer: payload.offer,
                        answer: payload.answer,
                        candidate: payload.candidate,
                        reason: payload.reason,
                    };
                };
                const recordCallInvite = (call) => __awaiter(this, void 0, void 0, function* () {
                    if (!call || !(0, db_1.isDBConnected)())
                        return;
                    try {
                        const now = new Date();
                        yield (0, CallLog_1.getCallLogsCollection)().updateOne({ callId: call.callId }, {
                            $set: {
                                callType: call.callType,
                                fromType: call.fromType,
                                fromId: call.fromId,
                                toType: call.toType,
                                toId: call.toId,
                                initiatedByUserId: user === null || user === void 0 ? void 0 : user.id,
                                status: 'ringing',
                                updatedAt: now,
                            },
                            $setOnInsert: {
                                callId: call.callId,
                                startedAt: now,
                                createdAt: now,
                                seenBy: [],
                            },
                        }, { upsert: true });
                    }
                    catch (error) {
                        console.error('Failed to record call invite:', error);
                    }
                });
                const recordCallAccepted = (call) => __awaiter(this, void 0, void 0, function* () {
                    if (!call || !(0, db_1.isDBConnected)())
                        return;
                    try {
                        const now = new Date();
                        yield (0, CallLog_1.getCallLogsCollection)().updateOne({ callId: call.callId }, {
                            $set: {
                                callType: call.callType,
                                fromType: call.fromType,
                                fromId: call.fromId,
                                toType: call.toType,
                                toId: call.toId,
                                status: 'accepted',
                                acceptedAt: now,
                                updatedAt: now,
                            },
                            $setOnInsert: {
                                callId: call.callId,
                                startedAt: now,
                                createdAt: now,
                                seenBy: [],
                                initiatedByUserId: user === null || user === void 0 ? void 0 : user.id,
                            },
                        }, { upsert: true });
                    }
                    catch (error) {
                        console.error('Failed to record accepted call:', error);
                    }
                });
                const recordCallRejected = (call) => __awaiter(this, void 0, void 0, function* () {
                    if (!call || !(0, db_1.isDBConnected)())
                        return;
                    try {
                        const now = new Date();
                        const reason = typeof call.reason === 'string' && call.reason.trim() ? call.reason.trim() : 'rejected';
                        yield (0, CallLog_1.getCallLogsCollection)().updateOne({ callId: call.callId }, {
                            $set: {
                                callType: call.callType,
                                fromType: call.fromType,
                                fromId: call.fromId,
                                toType: call.toType,
                                toId: call.toId,
                                status: reason === 'busy' ? 'missed' : 'rejected',
                                endReason: reason,
                                endedAt: now,
                                updatedAt: now,
                            },
                            $setOnInsert: {
                                callId: call.callId,
                                startedAt: now,
                                createdAt: now,
                                seenBy: [],
                                initiatedByUserId: user === null || user === void 0 ? void 0 : user.id,
                            },
                        }, { upsert: true });
                    }
                    catch (error) {
                        console.error('Failed to record rejected call:', error);
                    }
                });
                const recordCallEnded = (call) => __awaiter(this, void 0, void 0, function* () {
                    if (!call || !(0, db_1.isDBConnected)())
                        return;
                    try {
                        const now = new Date();
                        const callLogs = (0, CallLog_1.getCallLogsCollection)();
                        const existing = yield callLogs.findOne({ callId: call.callId });
                        const accepted = !!(existing === null || existing === void 0 ? void 0 : existing.acceptedAt) || (existing === null || existing === void 0 ? void 0 : existing.status) === 'accepted' || (existing === null || existing === void 0 ? void 0 : existing.status) === 'ended';
                        const reason = typeof call.reason === 'string' && call.reason.trim() ? call.reason.trim() : 'ended';
                        let status = 'ended';
                        if (!accepted) {
                            if (reason === 'no-answer' || reason === 'timeout') {
                                status = 'missed';
                            }
                            else if (reason === 'cancelled') {
                                status = 'cancelled';
                            }
                            else {
                                status = 'missed';
                            }
                        }
                        else if (reason === 'failed') {
                            status = 'failed';
                        }
                        const connectedAt = (existing === null || existing === void 0 ? void 0 : existing.acceptedAt) || (existing === null || existing === void 0 ? void 0 : existing.startedAt);
                        const durationSeconds = accepted && connectedAt
                            ? Math.max(0, Math.round((now.getTime() - new Date(connectedAt).getTime()) / 1000))
                            : undefined;
                        yield callLogs.updateOne({ callId: call.callId }, {
                            $set: Object.assign(Object.assign({ callType: call.callType, fromType: call.fromType, fromId: call.fromId, toType: call.toType, toId: call.toId, status, endReason: reason, endedAt: now }, (typeof durationSeconds === 'number' ? { durationSeconds } : {})), { updatedAt: now }),
                            $setOnInsert: {
                                callId: call.callId,
                                startedAt: now,
                                createdAt: now,
                                seenBy: [],
                                initiatedByUserId: user === null || user === void 0 ? void 0 : user.id,
                            },
                        }, { upsert: true });
                    }
                    catch (error) {
                        console.error('Failed to record ended call:', error);
                    }
                });
                const routeCallEvent = (eventName, payload) => {
                    const call = normalizeCallPayload(payload);
                    if (!call) {
                        return { call: null, error: 'Invalid call payload' };
                    }
                    const fromRoom = identityRoom(call.fromType, call.fromId);
                    if (!identityRooms.has(fromRoom)) {
                        console.warn(`⚠️ Blocked call event from non-joined identity ${call.fromType}:${call.fromId}`);
                        return { call: null, error: 'Identity room is not joined' };
                    }
                    const targetRoom = identityRoom(call.toType, call.toId);
                    io.to(targetRoom).emit(eventName, {
                        callId: call.callId,
                        fromType: call.fromType,
                        fromId: call.fromId,
                        toType: call.toType,
                        toId: call.toId,
                        callType: call.callType,
                        offer: call.offer,
                        answer: call.answer,
                        candidate: call.candidate,
                        reason: call.reason,
                        fromUserId: user === null || user === void 0 ? void 0 : user.id,
                        timestamp: Date.now(),
                    });
                    return { call, error: null };
                };
                socket.on('call:invite', (payload, ack) => __awaiter(this, void 0, void 0, function* () {
                    const { call, error } = routeCallEvent('call:incoming', payload);
                    if (!call) {
                        ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route call invite' });
                        return;
                    }
                    yield recordCallInvite(call);
                    ack === null || ack === void 0 ? void 0 : ack({ success: true });
                }));
                socket.on('call:accept', (payload, ack) => __awaiter(this, void 0, void 0, function* () {
                    const { call, error } = routeCallEvent('call:accepted', payload);
                    if (!call) {
                        ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route call accept' });
                        return;
                    }
                    yield recordCallAccepted(call);
                    ack === null || ack === void 0 ? void 0 : ack({ success: true });
                }));
                socket.on('call:reject', (payload, ack) => __awaiter(this, void 0, void 0, function* () {
                    const { call, error } = routeCallEvent('call:rejected', payload);
                    if (!call) {
                        ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route call reject' });
                        return;
                    }
                    yield recordCallRejected(call);
                    ack === null || ack === void 0 ? void 0 : ack({ success: true });
                }));
                socket.on('call:ice-candidate', (payload, ack) => {
                    const { call, error } = routeCallEvent('call:ice-candidate', payload);
                    if (!call) {
                        ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route ICE candidate' });
                        return;
                    }
                    ack === null || ack === void 0 ? void 0 : ack({ success: true });
                });
                socket.on('call:end', (payload, ack) => __awaiter(this, void 0, void 0, function* () {
                    const { call, error } = routeCallEvent('call:ended', payload);
                    if (!call) {
                        ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route call end' });
                        return;
                    }
                    yield recordCallEnded(call);
                    ack === null || ack === void 0 ? void 0 : ack({ success: true });
                }));
                socket.on('disconnect', () => {
                    console.log('❌ Socket.IO client disconnected', socket.id);
                });
            });
            // Then attempt database connection (non-blocking)
            console.log('🔄 Attempting database connection...');
            try {
                const db = yield (0, db_1.connectDB)();
                const isProduction = process.env.NODE_ENV === 'production';
                if (!db) {
                    if (isProduction) {
                        throw new Error('Database connection is required in production.');
                    }
                    console.warn('⚠️  Database connection not available. Some features will be unavailable until DB reconnects.');
                }
                else {
                    console.log('✅ Database connection established');
                    (0, reportsRoutes_1.startReportScheduleWorker)();
                    console.log('📬 Scheduled report worker started');
                    const shouldLoadDemoData = process.env.NODE_ENV !== 'production' &&
                        process.env.DISABLE_DEMO_BOOTSTRAP !== 'true';
                    if (shouldLoadDemoData) {
                        yield loadDemoPostsIfEmpty();
                        yield loadDemoAdsIfEmpty();
                    }
                    // Run legacy company migration
                    yield (0, migrationService_1.migrateLegacyCompanies)();
                }
            }
            catch (error) {
                console.error('❌ Database initialization failed:', error);
                throw error;
            }
            // Set up periodic health checks
            setInterval(() => __awaiter(this, void 0, void 0, function* () {
                const isHealthy = yield (0, db_1.checkDBHealth)();
                if (!isHealthy && (0, db_1.isDBConnected)()) {
                    console.warn('⚠️  Database health check failed - connection may be unstable');
                }
            }), 60000);
            // Set up daily trust score recalculation
            setInterval(() => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (!(0, db_1.isDBConnected)())
                        return;
                    console.log('🔄 Running daily trust score recalculation job...');
                    yield (0, trustService_1.recalculateAllTrustScores)();
                    console.log('✅ Daily trust score recalculation complete');
                }
                catch (error) {
                    console.error('❌ Failed daily trust score recalculation job:', error);
                }
            }), 24 * 60 * 60 * 1000);
            // Set up Time Capsule unlock checker
            setInterval(() => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (!(0, db_1.isDBConnected)())
                        return;
                    const db = (0, db_1.getDB)();
                    const now = Date.now();
                    // Find Time Capsules that just unlocked (within the last 5 minutes)
                    const recentlyUnlocked = yield db.collection('posts').find({
                        isTimeCapsule: true,
                        unlockDate: {
                            $lte: now,
                            $gte: now - (5 * 60 * 1000) // Within last 5 minutes
                        },
                        unlockNotificationSent: { $ne: true }
                    }).toArray();
                    // Send notifications for newly unlocked Time Capsules
                    for (const post of recentlyUnlocked) {
                        try {
                            // Import notification controller
                            const { createNotificationInDB } = yield Promise.resolve().then(() => __importStar(require('./controllers/notificationsController')));
                            // Notify the author
                            yield createNotificationInDB(post.author.id, 'time_capsule_unlocked', 'system', `Your Time Capsule "${post.timeCapsuleTitle || 'Untitled'}" has been unlocked!`, post.id);
                            // For group Time Capsules, notify invited users
                            if (post.timeCapsuleType === 'group' && post.invitedUsers) {
                                for (const userId of post.invitedUsers) {
                                    yield createNotificationInDB(userId, 'time_capsule_unlocked', post.author.id, `A Time Capsule from ${post.author.name} has been unlocked!`, post.id);
                                }
                            }
                            // Mark as notification sent
                            yield db.collection('posts').updateOne({ id: post.id }, { $set: { unlockNotificationSent: true } });
                            console.log(`📬 Sent unlock notifications for Time Capsule: ${post.id}`);
                        }
                        catch (error) {
                            console.error(`Failed to send notification for Time Capsule ${post.id}:`, error);
                        }
                    }
                }
                catch (error) {
                    console.error('Error checking Time Capsule unlocks:', error);
                }
            }), 5 * 60 * 1000); // Check every 5 minutes
            // Graceful shutdown handling
            const gracefulShutdown = (signal) => {
                console.log(`\n🔄 Received ${signal}. Shutting down gracefully...`);
                server.close(() => __awaiter(this, void 0, void 0, function* () {
                    console.log('✅ HTTP server closed');
                    process.exit(0);
                }));
            };
            process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
            process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        }
        catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    });
}
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Don't exit immediately, log and continue
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit immediately, log and continue
});
if (process.env.NODE_ENV !== 'test') {
    startServer();
}
