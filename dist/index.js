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
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const crypto_1 = require("crypto");
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
const notificationsController_1 = require("./controllers/notificationsController");
const jobsController_1 = require("./controllers/jobsController");
const jobPulseService_1 = require("./services/jobPulseService");
const reverseJobMatchService_1 = require("./services/reverseJobMatchService");
const authMiddleware_1 = require("./middleware/authMiddleware");
const csrfMiddleware_1 = require("./middleware/csrfMiddleware");
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const db_1 = require("./db");
const userUtils_1 = require("./utils/userUtils");
const sessionInvalidation_1 = require("./utils/sessionInvalidation");
const sessionPolicy_1 = require("./config/sessionPolicy");
const crossOriginPolicy_1 = require("./config/crossOriginPolicy");
const passportConfig_1 = require("./config/passportConfig");
const reverseJobMatchQueueService_1 = require("./services/reverseJobMatchQueueService");
const bootstrapRuntime_1 = require("./runtime/bootstrapRuntime");
const demoBootstrap_1 = require("./runtime/demoBootstrap");
const paymentPages_1 = require("./runtime/paymentPages");
dotenv_1.default.config();
// Debug: Check SendGrid Config
if (process.env.SENDGRID_API_KEY) {
    const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocila.world'}>`;
    console.log(`✅ SendGrid configured with API Key and From: "${from}"`);
}
else {
    console.warn('⚠️ SendGrid NOT configured:');
    if (!process.env.SENDGRID_API_KEY)
        console.warn('   - Missing SENDGRID_API_KEY');
}
(0, passportConfig_1.configurePassportStrategies)();
const app = (0, express_1.default)();
exports.app = app;
const PORT = process.env.PORT || 5000;
let runtimeServer = null;
let fatalShutdownInitiated = false;
(0, jobsController_1.registerJobViewCountShutdownHooks)(() => (0, db_1.getDB)());
const triggerFatalShutdown = (source, error) => {
    if (fatalShutdownInitiated) {
        return;
    }
    fatalShutdownInitiated = true;
    console.error(`❌ Fatal runtime error (${source}). Initiating graceful shutdown.`, error);
    const forceExitTimeoutMs = 5000;
    const forceExitTimer = setTimeout(() => {
        process.exit(1);
    }, forceExitTimeoutMs).unref();
    if (runtimeServer) {
        runtimeServer.close(() => {
            clearTimeout(forceExitTimer);
            process.exit(1);
        });
        return;
    }
    process.exit(1);
};
// Security & Optimization Middleware
// Ensure uploads directory exists
const uploadsDir = path_1.default.join(process.cwd(), 'uploads');
const ensureUploadsDirectoryExists = () => __awaiter(void 0, void 0, void 0, function* () {
    yield fs_1.promises.mkdir(uploadsDir, { recursive: true });
});
// Enable trust proxy for secure cookies behind load balancers (like Render/Heroku)
app.set("trust proxy", 1);
const isLocalHostname = (hostname) => hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local');
const isLocalDevelopmentUrl = (value) => {
    if (!value)
        return true;
    try {
        const parsed = new URL(value);
        return isLocalHostname(parsed.hostname);
    }
    catch (_a) {
        return true;
    }
};
const configuredSessionSecret = (process.env.SESSION_SECRET || '').trim();
const jwtSecretFallback = (process.env.JWT_SECRET || '').trim();
const isProductionRuntime = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || !!process.env.RENDER;
const sessionSecret = configuredSessionSecret || jwtSecretFallback;
const frontendRuntimeUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || '').trim();
const backendRuntimeUrl = (process.env.BACKEND_URL || process.env.PUBLIC_BACKEND_URL || '').trim();
const allowEphemeralDevelopmentSessionSecret = (process.env.NODE_ENV === 'development'
    && !isProductionRuntime
    && isLocalDevelopmentUrl(frontendRuntimeUrl)
    && isLocalDevelopmentUrl(backendRuntimeUrl));
const resolvedSessionSecret = sessionSecret || (allowEphemeralDevelopmentSessionSecret ? (0, crypto_1.randomBytes)(32).toString('hex') : '');
const configuredSessionCookieDomain = (process.env.SESSION_COOKIE_DOMAIN || '').trim();
const configuredSessionCookieSameSite = (process.env.SESSION_COOKIE_SAMESITE || '').trim().toLowerCase();
const sessionCookiePolicy = (0, sessionPolicy_1.resolveSessionCookiePolicy)({
    isProductionRuntime,
    configuredSameSite: configuredSessionCookieSameSite,
    configuredDomain: configuredSessionCookieDomain,
    frontendUrl: frontendRuntimeUrl,
    backendUrl: backendRuntimeUrl,
});
const sessionCookieSameSite = sessionCookiePolicy.sameSite;
const sessionCookieSecure = sessionCookiePolicy.secure;
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
    "https://aura.social",
    "https://www.aura.social",
    "https://www.aurasocial.world",
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
app.use((0, cookie_parser_1.default)());
// Block common probe targets for hidden files and build metadata as early as possible.
app.use((req, res, next) => {
    const pathLower = req.path.toLowerCase();
    const blockedFragments = [
        '/.env',
        '/.git',
        '/.svn',
        '/.hg',
        '/package.json',
        '/package-lock.json',
        '/yarn.lock',
    ];
    if (blockedFragments.some((fragment) => pathLower.includes(fragment))) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    next();
});
// Security & Optimization Middleware
app.use((0, helmet_1.default)({
    xFrameOptions: { action: 'sameorigin' },
    noSniff: true,
    hsts: sessionCookiePolicy.shouldEnableHsts
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: isProductionRuntime,
        }
        : false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.paypal.com', 'https://www.paypalobjects.com', 'https://js.braintreegateway.com', 'https://*.paypal.com'],
            connectSrc: ["'self'", 'https:', 'wss:'],
            imgSrc: ["'self'", 'data:', 'https:'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
            fontSrc: ["'self'", 'data:', 'https:'],
            frameSrc: ["'self'", 'https://www.paypal.com', 'https://*.paypal.com'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"],
        },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
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
app.use('/api', (0, csrfMiddleware_1.createCsrfProtection)({ allowedOrigins }));
// Session middleware
if (configuredSessionCookieSameSite.length > 0 &&
    configuredSessionCookieSameSite !== 'none' &&
    configuredSessionCookieSameSite !== 'strict' &&
    configuredSessionCookieSameSite !== 'lax') {
    console.warn(`⚠️ Unsupported SESSION_COOKIE_SAMESITE="${configuredSessionCookieSameSite}", defaulting automatically.`);
}
if (configuredSessionCookieSameSite === 'none' && sessionCookiePolicy.downgradedFromNone) {
    console.warn('⚠️ SESSION_COOKIE_SAMESITE=none requires HTTPS frontend and backend URLs outside production. Downgrading to SameSite=Lax.');
}
if (sessionCookieSameSite === 'none' && !sessionCookieSecure && isProductionRuntime) {
    throw new Error('SameSite=None requires secure cookies in production');
}
if (sessionCookieSameSite === 'none' && !sessionCookieSecure && !isProductionRuntime) {
    console.warn('⚠️ SameSite=None requires secure cookies. Session cookies may be rejected.');
}
if (!resolvedSessionSecret) {
    throw new Error('SESSION_SECRET is required outside explicit local development');
}
if (!configuredSessionSecret && jwtSecretFallback && isProductionRuntime) {
    console.warn('⚠️ SESSION_SECRET is not set. Falling back to JWT_SECRET for session signing.');
}
if (!sessionSecret && allowEphemeralDevelopmentSessionSecret) {
    console.warn('⚠️ Using ephemeral development-only session secret. Set SESSION_SECRET for stable sessions.');
}
app.use((0, express_session_1.default)({
    secret: resolvedSessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: sessionCookieSecure,
        sameSite: sessionCookieSameSite,
        domain: sessionCookiePolicy.domain,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
if (sessionCookieSameSite === 'none') {
    let insecureCookieWarningLogged = false;
    app.use((req, _res, next) => {
        if (!insecureCookieWarningLogged) {
            const forwardedProto = req.headers['x-forwarded-proto'];
            const isSecureRequest = req.secure || forwardedProto === 'https';
            if (!isSecureRequest) {
                insecureCookieWarningLogged = true;
                console.warn('⚠️ Session cookies are configured for SameSite=None but request is not HTTPS.');
            }
        }
        next();
    });
}
// Passport middleware
app.use(passport_1.default.initialize());
app.use(passport_1.default.session());
app.use((req, res, next) => {
    const relaxCrossOrigin = (0, crossOriginPolicy_1.requiresRelaxedCrossOriginPolicy)(req.path);
    res.setHeader('Cross-Origin-Opener-Policy', relaxCrossOrigin ? 'unsafe-none' : 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', relaxCrossOrigin ? 'unsafe-none' : 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', relaxCrossOrigin ? 'cross-origin' : 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Permissions-Policy', 'unload=*');
    next();
});
// Pre-flight handling is managed by CORS middleware above
// Debug middleware to log all requests in non-production environments
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`🔍 Request: ${req.method} ${req.path} - ${new Date().toISOString()}`);
        next();
    });
}
// Serve uploaded files statically
app.use('/uploads', express_1.default.static(uploadsDir, {
    dotfiles: 'deny',
    fallthrough: false,
    index: false,
    redirect: false,
}));
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
app.get('/api/auth/logout', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = (0, sessionInvalidation_1.resolveLogoutUserId)(req);
        if (userId) {
            yield (0, sessionInvalidation_1.invalidateUserAuthSessions)(userId);
        }
    }
    catch (error) {
        console.error('Legacy logout token invalidation error:', error);
    }
    (0, sessionInvalidation_1.clearLogoutCookies)(res);
    req.logout((err) => {
        if (err) {
            console.error('Error during logout:', err);
        }
        const finishLogout = () => {
            res.json({ success: true, message: 'Logged out successfully' });
        };
        if (req.session) {
            req.session.destroy((destroyError) => {
                if (destroyError) {
                    console.error('Error destroying session:', destroyError);
                }
                finishLogout();
            });
            return;
        }
        finishLogout();
    });
}));
// Get current user info (legacy - moved to /auth)
app.get('/auth/user', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        res.json({ user: (0, userUtils_1.transformUser)(req.user) });
    }
    else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});
if (!isProductionRuntime) {
    app.get('/api/debug/env', (_req, res) => {
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
        res.json({
            cookies: req.cookies,
            signedCookies: req.signedCookies,
            headers: req.headers
        });
    });
    app.get('/api/debug/sendgrid', (_req, res) => {
        const apiKey = process.env.SENDGRID_API_KEY;
        const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM || 'no-reply@aurasocila.world';
        res.json({
            hasApiKey: !!apiKey,
            apiKeyPreview: apiKey ? `${apiKey.substring(0, 5)}...` : null,
            fromEmail,
            env: process.env.NODE_ENV
        });
    });
}
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
    res.send((0, paymentPages_1.renderPaymentSuccessPage)(pkgParam));
});
app.get('/payment-cancelled', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('❌ Payment cancelled by user');
    res.send((0, paymentPages_1.renderPaymentCancelledPage)());
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
if (!isProductionRuntime) {
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
}
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
// Bootstraps server runtime, realtime, DB, and recurring jobs.
function bootstrapServerRuntime() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('🚀 Starting Aura© Social Backend...');
            console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔧 Port: ${PORT}`);
            yield ensureUploadsDirectoryExists();
            const server = app.listen(PORT, () => {
                console.log(`🚀 Server is running on port ${PORT}`);
                console.log(`🌐 Health check available at: http://localhost:${PORT}/health`);
            });
            runtimeServer = server;
            (0, bootstrapRuntime_1.initSocketRuntime)({ app, server, allowedOrigins });
            yield (0, bootstrapRuntime_1.initializeDatabaseRuntime)({
                loadDemoPostsIfEmpty: demoBootstrap_1.loadDemoPostsIfEmpty,
                loadDemoAdsIfEmpty: demoBootstrap_1.loadDemoAdsIfEmpty,
                onDatabaseReady: () => __awaiter(this, void 0, void 0, function* () {
                    void (0, jobsController_1.ensureJobsTextIndex)((0, db_1.getDB)())
                        .then((ready) => {
                        if (ready) {
                            console.log('🔎 Jobs text search index ready');
                        }
                        else {
                            console.warn('⚠️ Jobs text search index warmup did not complete');
                        }
                    })
                        .catch((indexError) => {
                        console.error('⚠️ Jobs text search index warmup failed:', indexError);
                    });
                    void (0, jobPulseService_1.ensureJobPulseIndexes)((0, db_1.getDB)())
                        .then(() => {
                        console.log('📈 Job pulse indexes ready');
                    })
                        .catch((indexError) => {
                        console.error('⚠️ Job pulse index warmup failed:', indexError);
                    });
                    void (0, reverseJobMatchService_1.warmReverseMatchIndexes)((0, db_1.getDB)())
                        .then(() => {
                        console.log('🎯 Reverse match indexes ready');
                    })
                        .catch((indexError) => {
                        console.error('⚠️ Reverse match index warmup failed:', indexError);
                    });
                    (0, reverseJobMatchQueueService_1.startReverseMatchQueueWorker)(() => (0, db_1.getDB)());
                    console.log('🧠 Reverse match queue worker started');
                    (0, reportsRoutes_1.startReportScheduleWorker)();
                    console.log('📬 Scheduled report worker started');
                    (0, notificationsController_1.startNotificationCleanupWorker)();
                    console.log('🧹 Notification cleanup worker started');
                }),
            });
            (0, bootstrapRuntime_1.startRecurringRuntimeJobs)();
            (0, bootstrapRuntime_1.registerGracefulShutdownHandlers)(server);
        }
        catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    });
}
// Keep a small, explicit startup entry point.
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        yield bootstrapServerRuntime();
    });
}
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    triggerFatalShutdown('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
    triggerFatalShutdown('unhandledRejection', reason);
});
if (process.env.NODE_ENV !== 'test') {
    startServer();
}
