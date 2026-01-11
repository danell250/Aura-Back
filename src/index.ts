import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import geminiRoutes from './routes/geminiRoutes';
import uploadRoutes from './routes/uploadRoutes';
import postsRoutes from './routes/postsRoutes';
import usersRoutes from './routes/usersRoutes';
import adsRoutes from './routes/adsRoutes';
import commentsRoutes from './routes/commentsRoutes';
import notificationsRoutes from './routes/notificationsRoutes';
import messagesRoutes from './routes/messagesRoutes';
import subscriptionsRoutes from './routes/subscriptionsRoutes';
import path from 'path';
import fs from 'fs';
import { connectDB, checkDBHealth, isDBConnected } from './db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'https://auraradiance.netlify.app',
  'https://auraraidiate.netlify.app/',
  'http://localhost:5000',
  'http://localhost:5173'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`🔍 Request: ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));

// Routes
console.log('Registering routes...');
app.use('/api/users', (req, res, next) => {
  console.log(`Users route hit: ${req.method} ${req.path}`);
  next();
}, usersRoutes);

// Direct test route for debugging
app.post('/api/users/direct-test', (req, res) => {
  console.log('Direct test route hit!');
  res.json({ success: true, message: 'Direct route working!' });
});
app.use('/api/gemini', geminiRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
console.log('Routes registered successfully');

// Health check endpoints
app.get('/health', async (_req, res) => {
  const dbHealthy = await checkDBHealth();
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: {
      connected: isDBConnected(),
      healthy: dbHealthy,
      status: dbHealthy ? 'connected' : 'disconnected'
    },
    memory: process.memoryUsage(),
    version: process.version
  };
  
  res.status(dbHealthy ? 200 : 503).json(status);
});

app.get('/health/db', async (_req, res) => {
  const dbHealthy = await checkDBHealth();
  res.status(dbHealthy ? 200 : 503).json({
    database: {
      connected: isDBConnected(),
      healthy: dbHealthy,
      status: dbHealthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    }
  });
});

// Test route
app.get('/api/test', (_req, res) => {
  res.json({ 
    message: 'API routes are working!', 
    timestamp: new Date(),
    database: isDBConnected() ? 'connected' : 'disconnected'
  });
});

// Test POST route
app.post('/api/test-post', (_req, res) => {
  console.log('Test POST route hit!');
  res.json({ 
    message: 'POST route working!', 
    timestamp: new Date(),
    database: isDBConnected() ? 'connected' : 'disconnected'
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
    database: isDBConnected() ? 'connected' : 'disconnected'
  });
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Aura Social Backend is running',
    status: 'ok',
    database: isDBConnected() ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Enhanced error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
async function startServer() {
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
      await connectDB();
      console.log('✅ Database connection established');
    } catch (error) {
      console.warn('⚠️  Database connection failed, but server is still running');
      console.warn('⚠️  The application will work with mock data until database is available');
    }
    
    // Set up periodic health checks
    setInterval(async () => {
      const isHealthy = await checkDBHealth();
      if (!isHealthy && isDBConnected()) {
        console.warn('⚠️  Database health check failed - connection may be unstable');
      }
    }, 60000); // Check every minute
    
    // Graceful shutdown handling
    const gracefulShutdown = (signal: string) => {
      console.log(`\n🔄 Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        console.log('✅ HTTP server closed');
        process.exit(0);
      });
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
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
