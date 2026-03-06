import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import passport from 'passport';
import session from 'express-session';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import geminiRoutes from './routes/geminiRoutes';
import uploadRoutes from './routes/uploadRoutes';
import postsRoutes from './routes/postsRoutes';
import usersRoutes from './routes/usersRoutes';
import adsRoutes from './routes/adsRoutes';
import commentsRoutes from './routes/commentsRoutes';
import notificationsRoutes from './routes/notificationsRoutes';
import messagesRoutes from './routes/messagesRoutes';
import subscriptionsRoutes from './routes/subscriptionsRoutes';
import adSubscriptionsRoutes from './routes/adSubscriptionsRoutes';
import authRoutes from './routes/authRoutes';
import privacyRoutes from './routes/privacyRoutes';
import shareRoutes from './routes/shareRoutes';
import mediaRoutes from './routes/mediaRoutes';
import companyRoutes from './routes/companyRoutes';
import reportsRoutes, { startReportScheduleWorker } from './routes/reportsRoutes';
import ownerControlRoutes from './routes/ownerControlRoutes';
import jobsRoutes from './routes/jobsRoutes';
import { startNotificationCleanupWorker } from './controllers/notificationsController';
import { flushRegisteredJobViewCountBuffer, registerJobViewCountShutdownHooks } from './services/jobViewBufferService';
import { ensureJobsTextIndex } from './services/jobDiscoveryQueryService';
import { ensureJobMarketDemandIndexes } from './services/jobMarketDemandStorageService';
import { ensureJobMarketDemandSeedContextRegistryIndexes } from './services/jobMarketDemandSeedContextRegistryService';
import { ensureJobPulseIndexes } from './services/jobPulseService';
import { ensureJobPulseSnapshotCleanupTimer } from './services/jobPulseSnapshotService';
import { warmReverseMatchIndexes } from './services/reverseJobMatchService';
import { attachUser, requireAuth } from './middleware/authMiddleware';
import { createCsrfProtection } from './middleware/csrfMiddleware';
import path from 'path';
import { promises as fs } from 'fs';
import { checkDBHealth, isDBConnected, getDB } from './db';
import { transformUser } from './utils/userUtils';
import { clearLogoutCookies, invalidateUserAuthSessions, resolveLogoutUserId } from './utils/sessionInvalidation';
import { resolveSessionCookiePolicy } from './config/sessionPolicy';
import { requiresRelaxedCrossOriginPolicy } from './config/crossOriginPolicy';
import { configurePassportStrategies } from './config/passportConfig';
import { startReverseMatchQueueWorker } from './services/reverseJobMatchQueueService';
import {
  initSocketRuntime,
  initializeDatabaseRuntime,
  startRecurringRuntimeJobs,
  registerGracefulShutdownHandlers,
} from './runtime/bootstrapRuntime';
import { loadDemoAdsIfEmpty, loadDemoPostsIfEmpty } from './runtime/demoBootstrap';
import { renderPaymentCancelledPage, renderPaymentSuccessPage } from './runtime/paymentPages';

dotenv.config();

// Debug: Check SendGrid Config
  if (process.env.SENDGRID_API_KEY) {
    const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocila.world'}>`;
    console.log(`✅ SendGrid configured with API Key and From: "${from}"`);
  } else {
  console.warn('⚠️ SendGrid NOT configured:');
  if (!process.env.SENDGRID_API_KEY) console.warn('   - Missing SENDGRID_API_KEY');
}

configurePassportStrategies();

const app = express();
const PORT = process.env.PORT || 5000;
let runtimeServer: ReturnType<express.Application['listen']> | null = null;
let fatalShutdownInitiated = false;

registerJobViewCountShutdownHooks(() => getDB());

const triggerFatalShutdown = (source: 'uncaughtException' | 'unhandledRejection', error: unknown) => {
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
      void flushRegisteredJobViewCountBuffer()
        .catch((flushError) => {
          console.error('Flush buffered job view counts during fatal shutdown failed:', flushError);
        })
        .finally(() => {
          clearTimeout(forceExitTimer);
          process.exit(1);
        });
    });
    return;
  }

  void flushRegisteredJobViewCountBuffer()
    .catch((flushError) => {
      console.error('Flush buffered job view counts during fatal shutdown failed:', flushError);
    })
    .finally(() => {
      process.exit(1);
    });
};

// Security & Optimization Middleware
// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
const ensureUploadsDirectoryExists = async () => {
  await fs.mkdir(uploadsDir, { recursive: true });
};

// Enable trust proxy for secure cookies behind load balancers (like Render/Heroku)
app.set("trust proxy", 1);

const isLocalHostname = (hostname: string): boolean =>
  hostname === 'localhost'
  || hostname === '127.0.0.1'
  || hostname === '::1'
  || hostname.endsWith('.local');

const isLocalDevelopmentUrl = (value: string): boolean => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return isLocalHostname(parsed.hostname);
  } catch {
    return true;
  }
};

const configuredSessionSecret = (process.env.SESSION_SECRET || '').trim();
const jwtSecretFallback = (process.env.JWT_SECRET || '').trim();
const isProductionRuntime = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || !!process.env.RENDER;
const sessionSecret = configuredSessionSecret || jwtSecretFallback;
const frontendRuntimeUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || '').trim();
const backendRuntimeUrl = (process.env.BACKEND_URL || process.env.PUBLIC_BACKEND_URL || '').trim();
const allowEphemeralDevelopmentSessionSecret = (
  process.env.NODE_ENV === 'development'
  && !isProductionRuntime
  && isLocalDevelopmentUrl(frontendRuntimeUrl)
  && isLocalDevelopmentUrl(backendRuntimeUrl)
);
const resolvedSessionSecret = sessionSecret || (allowEphemeralDevelopmentSessionSecret ? randomBytes(32).toString('hex') : '');
const configuredSessionCookieDomain = (process.env.SESSION_COOKIE_DOMAIN || '').trim();
const configuredSessionCookieSameSite = (process.env.SESSION_COOKIE_SAMESITE || '').trim().toLowerCase();
const sessionCookiePolicy = resolveSessionCookiePolicy({
  isProductionRuntime,
  configuredSameSite: configuredSessionCookieSameSite,
  configuredDomain: configuredSessionCookieDomain,
  frontendUrl: frontendRuntimeUrl,
  backendUrl: backendRuntimeUrl,
});
const sessionCookieSameSite = sessionCookiePolicy.sameSite;
const sessionCookieSecure = sessionCookiePolicy.secure;

// CORS Configuration
const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/$/, '').toLowerCase();

const parseEnvOriginList = (value: string | undefined): string[] => {
  if (!value) return [];
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

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    // allow non-browser tools (no origin) and allow your frontends
    if (!origin) return cb(null, true);
    
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
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

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
app.use(helmet({
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
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Global Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);
app.use('/api', createCsrfProtection({ allowedOrigins }));

// Session middleware
if (
  configuredSessionCookieSameSite.length > 0 &&
  configuredSessionCookieSameSite !== 'none' &&
  configuredSessionCookieSameSite !== 'strict' &&
  configuredSessionCookieSameSite !== 'lax'
) {
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

app.use(session({
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
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  const relaxCrossOrigin = requiresRelaxedCrossOriginPolicy(req.path);

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
app.use('/uploads', express.static(uploadsDir, {
  dotfiles: 'deny',
  fallthrough: false,
  index: false,
  redirect: false,
}));

// Routes
console.log('Registering routes...');

// Authentication routes (should come first)
app.use('/api/auth', authRoutes);

// Privacy routes
app.use('/api/privacy', privacyRoutes);

// Share routes (public, no auth required, serves HTML for crawlers)
app.use('/share', shareRoutes);

// Apply user attachment middleware to all API routes
app.use('/api', attachUser);

app.use('/api/users', (req, res, next) => {
  console.log(`Users route hit: ${req.method} ${req.path}`);
  next();
}, usersRoutes);

// Logout route (legacy - moved to /auth)
app.get('/api/auth/logout', async (req, res) => {
  try {
    const userId = resolveLogoutUserId(req);
    if (userId) {
      await invalidateUserAuthSessions(userId);
    }
  } catch (error) {
    console.error('Legacy logout token invalidation error:', error);
  }

  clearLogoutCookies(res);

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
});

// Get current user info (legacy - moved to /auth)
app.get('/auth/user', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.json({ user: transformUser(req.user) });
  } else {
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

app.get('/api/credits/history/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const actor = (req as any).user;
    const isAdmin = !!(actor && (actor.role === 'admin' || actor.isAdmin === true));
    if (!actor?.id) {
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
    
    if (!isDBConnected()) {
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Database service is currently unavailable'
      });
    }

    const db = getDB();
    const transactions = await db
      .collection('transactions')
      .find({ userId, type: 'credit_purchase' })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Error fetching credit history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch credit history',
      message: 'Internal server error'
    });
  }
});

app.use('/api/gemini', geminiRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/ads', adsRoutes);
// Mount comments routes at /api so routes like /api/posts/:postId/comments work
app.use('/api', commentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/ad-subscriptions', adSubscriptionsRoutes);
app.use('/api', jobsRoutes);
app.use('/api', mediaRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/owner-control', ownerControlRoutes);

app.get('/payment-success', (req, res) => {
  const pkg = typeof req.query.pkg === 'string' ? req.query.pkg : undefined;
  const pkgParam = pkg ? `&pkg=${encodeURIComponent(pkg)}` : '';
  res.send(renderPaymentSuccessPage(pkgParam));
});

app.get('/payment-cancelled', async (req, res) => {
  console.log('❌ Payment cancelled by user');
  res.send(renderPaymentCancelledPage());
});

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

if (!isProductionRuntime) {
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
}

app.get('/', (_req, res) => {
  res.json({
    message: 'Aura© Social Backend is running',
    status: 'ok',
    database: isDBConnected() ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Enhanced error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
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
async function bootstrapServerRuntime() {
  try {
    console.log('🚀 Starting Aura© Social Backend...');
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔧 Port: ${PORT}`);
    await ensureUploadsDirectoryExists();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`🌐 Health check available at: http://localhost:${PORT}/health`);
    });
    runtimeServer = server;

    initSocketRuntime({ app, server, allowedOrigins });
    await initializeDatabaseRuntime({
      loadDemoPostsIfEmpty,
      loadDemoAdsIfEmpty,
      onDatabaseReady: async () => {
        void ensureJobsTextIndex(getDB())
          .then((ready: boolean) => {
            if (ready) {
              console.log('🔎 Jobs text search index ready');
            } else {
              console.warn('⚠️ Jobs text search index warmup did not complete');
            }
          })
          .catch((indexError: unknown) => {
            console.error('⚠️ Jobs text search index warmup failed:', indexError);
          });
        void ensureJobPulseIndexes(getDB())
          .then(() => {
            console.log('📈 Job pulse indexes ready');
          })
          .catch((indexError) => {
            console.error('⚠️ Job pulse index warmup failed:', indexError);
          });
        void ensureJobMarketDemandIndexes(getDB())
          .then(() => {
            console.log('🧭 Job market demand indexes ready');
          })
          .catch((indexError) => {
            console.error('⚠️ Job market demand index warmup failed:', indexError);
          });
        void ensureJobMarketDemandSeedContextRegistryIndexes(getDB())
          .then(() => {
            console.log('🗂️ Job market demand seed context indexes ready');
          })
          .catch((indexError) => {
            console.error('⚠️ Job market demand seed context index warmup failed:', indexError);
          });
        ensureJobPulseSnapshotCleanupTimer();
        void warmReverseMatchIndexes(getDB())
          .then(() => {
            console.log('🎯 Reverse match indexes ready');
          })
          .catch((indexError) => {
            console.error('⚠️ Reverse match index warmup failed:', indexError);
          });
        startReverseMatchQueueWorker(() => getDB());
        console.log('🧠 Reverse match queue worker started');
        startReportScheduleWorker();
        console.log('📬 Scheduled report worker started');
        startNotificationCleanupWorker();
        console.log('🧹 Notification cleanup worker started');
      },
    });
    startRecurringRuntimeJobs();
    registerGracefulShutdownHandlers(server, () => flushRegisteredJobViewCountBuffer());
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}
// Keep a small, explicit startup entry point.
async function startServer() {
  await bootstrapServerRuntime();
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  triggerFatalShutdown('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  triggerFatalShutdown('unhandledRejection', reason);
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  startServer();
}
