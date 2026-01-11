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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const geminiRoutes_1 = __importDefault(require("./routes/geminiRoutes"));
const uploadRoutes_1 = __importDefault(require("./routes/uploadRoutes"));
const postsRoutes_1 = __importDefault(require("./routes/postsRoutes"));
const usersRoutes_1 = __importDefault(require("./routes/usersRoutes"));
const adsRoutes_1 = __importDefault(require("./routes/adsRoutes"));
const commentsRoutes_1 = __importDefault(require("./routes/commentsRoutes"));
const notificationsRoutes_1 = __importDefault(require("./routes/notificationsRoutes"));
const messagesRoutes_1 = __importDefault(require("./routes/messagesRoutes"));
const subscriptionsRoutes_1 = __importDefault(require("./routes/subscriptionsRoutes"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("./db");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5002;
// Ensure uploads directory exists
const uploadsDir = path_1.default.join(__dirname, '../uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
const allowedOrigins = ((_a = process.env.ALLOWED_ORIGINS) === null || _a === void 0 ? void 0 : _a.split(',')) || [
    'https://auraradiance.vercel.app',
    'https://auraraidiate.netlify.app/',
    'http://localhost:5000',
    'http://localhost:5173'
];
app.use((0, cors_1.default)({
    origin: allowedOrigins,
    credentials: true
}));
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
app.use('/api/users', (req, res, next) => {
    console.log(`Users route hit: ${req.method} ${req.path}`);
    next();
}, usersRoutes_1.default);
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
