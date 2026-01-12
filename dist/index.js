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
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const passport_1 = __importDefault(require("passport"));
const express_session_1 = __importDefault(require("express-session"));
const passport_google_oauth20_1 = require("passport-google-oauth20");
const geminiRoutes_1 = __importDefault(require("./routes/geminiRoutes"));
const uploadRoutes_1 = __importDefault(require("./routes/uploadRoutes"));
const postsRoutes_1 = __importDefault(require("./routes/postsRoutes"));
const usersRoutes_1 = __importDefault(require("./routes/usersRoutes"));
const adsRoutes_1 = __importDefault(require("./routes/adsRoutes"));
const commentsRoutes_1 = __importDefault(require("./routes/commentsRoutes"));
const notificationsRoutes_1 = __importDefault(require("./routes/notificationsRoutes"));
const messagesRoutes_1 = __importDefault(require("./routes/messagesRoutes"));
const subscriptionsRoutes_1 = __importDefault(require("./routes/subscriptionsRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const privacyRoutes_1 = __importDefault(require("./routes/privacyRoutes"));
const authMiddleware_1 = require("./middleware/authMiddleware");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("./db");
dotenv_1.default.config();
// Passport Google OAuth Strategy Configuration
passport_1.default.use(new passport_google_oauth20_1.Strategy({
    clientID: process.env.GOOGLE_CLIENT_ID || '63639970194-r83ifit3giq02jd1rgfq84uea5tbgv6h.apps.googleusercontent.com',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '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',
    callbackURL: "/auth/google/callback"
}, (_accessToken, _refreshToken, profile, done) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        // Parse name from profile
        const displayName = profile.displayName || '';
        const nameParts = displayName.trim().split(/\s+/);
        const firstName = nameParts[0] || 'User';
        const lastName = nameParts.slice(1).join(' ') || '';
        const email = (_b = (_a = profile.emails) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.value;
        if (!email) {
            return done(new Error('Google account does not have an email address'), undefined);
        }
        // Create user object with Google profile data
        const user = {
            id: profile.id,
            googleId: profile.id,
            firstName: firstName,
            lastName: lastName,
            name: displayName || `${firstName} ${lastName}`.trim(),
            email: email.toLowerCase().trim(),
            avatar: ((_d = (_c = profile.photos) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.value) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
            avatarType: 'image',
            handle: `@${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s+/g, '')}${Math.floor(Math.random() * 10000)}`,
            bio: 'New to Aura',
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
            done(null, user);
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
const PORT = process.env.PORT || 5000;
// Ensure uploads directory exists
const uploadsDir = path_1.default.join(__dirname, '../uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
// CORS configuration
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // allow server-to-server & tools like curl/postman
        if (!origin)
            return callback(null, true);
        // Use environment variable from Render, fallback to hardcoded values
        const frontendUrl = process.env.VITE_FRONTEND_URL;
        const allowed = [
            frontendUrl,
            "https://auraradiance.vercel.app",
            "http://localhost:5173"
        ].filter(Boolean); // Remove any undefined/null values
        if (allowed.includes(origin)) {
            return callback(null, true);
        }
        console.error("❌ Blocked by CORS:", origin);
        console.log("🔗 Allowed origins:", allowed);
        return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-User-Id", "X-User-ID", "x-user-id"]
}));
// Remove the problematic wildcard options route
// app.options("*", cors());
// Session middleware
app.use((0, express_session_1.default)({
    secret: process.env.SESSION_SECRET || 'fallback_secret_for_development',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Set to true in production with HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
// Passport middleware
app.use(passport_1.default.initialize());
app.use(passport_1.default.session());
// Middleware for general request processing
app.use((req, res, next) => {
    // Set headers to fix Cross-Origin-Opener-Policy issues with popups
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    next();
});
// Pre-flight handling is managed by CORS middleware above
app.use(express_1.default.json());
// Debug middleware to log all requests
app.use((req, res, next) => {
    console.log(`🔍 Request: ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});
// Serve uploaded files statically
app.use('/uploads', express_1.default.static(uploadsDir));
// Routes
console.log('Registering routes...');
// Authentication routes (should come first)
app.use('/auth', authRoutes_1.default);
// Privacy routes
app.use('/api/privacy', privacyRoutes_1.default);
// Apply user attachment middleware to all API routes
app.use('/api', authMiddleware_1.attachUser);
app.use('/api/users', (req, res, next) => {
    console.log(`Users route hit: ${req.method} ${req.path}`);
    next();
}, usersRoutes_1.default);
// Google OAuth routes (legacy - moved to /auth)
app.get('/auth/google', passport_1.default.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport_1.default.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
    // Successful authentication, redirect to frontend
    res.redirect(process.env.VITE_FRONTEND_URL || 'https://auraradiance.vercel.app');
});
// Logout route (legacy - moved to /auth)
app.get('/auth/logout', (req, res) => {
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
        res.json({ user: req.user });
    }
    else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});
// Debug endpoint to check environment variables
app.get('/api/debug/env', (req, res) => {
    res.json({
        frontendUrl: process.env.VITE_FRONTEND_URL,
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        allowedOrigins: [
            process.env.VITE_FRONTEND_URL,
            "https://auraradiance.vercel.app",
            "http://localhost:5173"
        ].filter(Boolean)
    });
});
// Direct test route for debugging
app.post('/api/users/direct-test', (req, res) => {
    console.log('Direct test route hit!');
    res.json({ success: true, message: 'Direct route working!' });
});
app.use('/api/gemini', geminiRoutes_1.default);
app.use('/api/upload', uploadRoutes_1.default);
app.use('/api/posts', postsRoutes_1.default);
app.use('/api/ads', adsRoutes_1.default);
app.use('/api/comments', commentsRoutes_1.default);
app.use('/api/notifications', notificationsRoutes_1.default);
app.use('/api/messages', messagesRoutes_1.default);
app.use('/api/subscriptions', subscriptionsRoutes_1.default);
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
        message: 'Aura Social Backend is running',
        status: 'ok',
        database: (0, db_1.isDBConnected)() ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});
// Enhanced error handling middleware
app.use((err, _req, res, _next) => {
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
// Enhanced server startup with database connection management
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('🚀 Starting Aura Social Backend...');
            console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔧 Port: ${PORT}`);
            // Start the HTTP server first
            const server = app.listen(PORT, () => {
                console.log(`🚀 Server is running on port ${PORT}`);
                console.log(`🌐 Health check available at: http://localhost:${PORT}/health`);
            });
            // Then attempt database connection (non-blocking)
            console.log('🔄 Attempting database connection...');
            try {
                yield (0, db_1.connectDB)();
                console.log('✅ Database connection established');
            }
            catch (error) {
                console.warn('⚠️  Database connection failed, but server is still running');
                console.warn('⚠️  The application will work with mock data until database is available');
            }
            // Set up periodic health checks
            setInterval(() => __awaiter(this, void 0, void 0, function* () {
                const isHealthy = yield (0, db_1.checkDBHealth)();
                if (!isHealthy && (0, db_1.isDBConnected)()) {
                    console.warn('⚠️  Database health check failed - connection may be unstable');
                }
            }), 60000); // Check every minute
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
startServer();
