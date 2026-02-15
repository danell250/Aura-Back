import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import passport from 'passport';
import session from 'express-session';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import cookieParser from 'cookie-parser';
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
import reportsRoutes from './routes/reportsRoutes';
import ownerControlRoutes from './routes/ownerControlRoutes';
import { attachUser, requireAuth } from './middleware/authMiddleware';
import path from 'path';
import fs from 'fs';
import { connectDB, checkDBHealth, isDBConnected, getDB } from './db';
import { recalculateAllTrustScores } from './services/trustService';
import { migrateLegacyCompanies } from './services/migrationService';
import { Server as SocketIOServer } from 'socket.io';
import { transformUser } from './utils/userUtils';
import { verifyAccessToken } from './utils/jwtUtils';
import { validateIdentityAccess } from './utils/identityUtils';
import { registerSocketServer } from './realtime/socketHub';
import { CallType, getCallLogsCollection } from './models/CallLog';

dotenv.config();

// Debug: Check SendGrid Config
  if (process.env.SENDGRID_API_KEY) {
    const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aura.net.za'}>`;
    console.log(`✅ SendGrid configured with API Key and From: "${from}"`);
  } else {
  console.warn('⚠️ SendGrid NOT configured:');
  if (!process.env.SENDGRID_API_KEY) console.warn('   - Missing SENDGRID_API_KEY');
}

// Passport Google OAuth Strategy Configuration
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      // Parse name from profile
      const displayName = profile.displayName || '';
      const nameParts = displayName.trim().split(/\s+/);
      const firstName = nameParts[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || '';
      const email = profile.emails?.[0]?.value;
      const isVerified = profile.emails?.[0]?.verified;
      
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
        avatar: profile.photos?.[0]?.value || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
        avatarType: 'image' as const,
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
        activeGlow: 'none' as const
      };
      
      return done(null, user);
    } catch (error) {
      console.error('Error in Google OAuth strategy:', error);
      return done(error as any, undefined);
    }
  }
  ));
} else {
  console.warn('⚠️ Google OAuth environment variables not found. Google login will not be available.');
}

// Serialize user for session - store user ID
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session - fetch full user data from database
passport.deserializeUser(async (id: string, done) => {
  try {
    const db = getDB();
    const user = await db.collection('users').findOne({ id });
    
    if (user) {
      done(null, transformUser(user));
    } else {
      done(null, false);
    }
  } catch (error) {
    console.error('Error deserializing user:', error);
    done(error, null);
  }
});

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Optimization Middleware
// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Enable trust proxy for secure cookies behind load balancers (like Render/Heroku)
app.set("trust proxy", 1);

// CORS Configuration
const allowedOrigins = [
  "https://www.aura.net.za",
  "https://aura.net.za",
  "https://auraso.vercel.app",
  "https://www.auraso.vercel.app",
  "https://auraradiance.vercel.app",
  "https://www.auraradiance.vercel.app",
  "https://aura-front-s1bw.onrender.com",
  "http://localhost:5173",
  "http://localhost:5003",
  process.env.VITE_FRONTEND_URL?.replace(/\/$/, '')
].filter(Boolean) as string[];

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    // allow non-browser tools (no origin) and allow your frontends
    if (!origin) return cb(null, true);
    
    // Normalize origin by removing trailing slash
    const normalizedOrigin = origin.replace(/\/$/, '');
    
    // Check for allowed origins or vercel deployments
    if (
      allowedOrigins.includes(normalizedOrigin) || 
      normalizedOrigin.endsWith('.vercel.app') || 
      normalizedOrigin.includes('aura-socialr') ||
      normalizedOrigin.includes('aura-front') ||
      normalizedOrigin.includes('onrender.com')
    ) {
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

// Security & Optimization Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to avoid breaking external resources (images, scripts)
  crossOriginResourcePolicy: { policy: "cross-origin" },
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

app.use(cookieParser());

// Passport GitHub OAuth Strategy Configuration
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.GITHUB_CALLBACK_URL || "https://aura-back-s1bw.onrender.com/api/auth/github/callback",
    scope: ['user:email']
  },
  async (_accessToken: any, _refreshToken: any, profile: any, done: (err: any, user?: any) => void) => {
    try {
      const displayName = profile.displayName || '';
      const username = profile.username || 'githubuser';
      const nameParts = displayName.trim().split(/\s+/);
      const firstName = nameParts[0] || username;
      const lastName = nameParts.slice(1).join(' ') || '';
      
      const emailObj = profile.emails?.[0];
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
        avatarType: 'image' as const,
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
        activeGlow: 'none' as const
      };

      return done(null, user);
    } catch (error) {
      console.error('Error in GitHub OAuth strategy:', error);
      return done(error as any, undefined);
    }
  }));
} else {
  console.warn('⚠️ GitHub OAuth environment variables not found. GitHub login will not be available.');
}

// Session middleware
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET is required in production');
}

app.use(session({
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
app.use(passport.initialize());
app.use(passport.session());

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
app.use(cookieParser());

// Debug middleware to log all requests in non-production environments
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`🔍 Request: ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
  });
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));

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
      req.session = undefined as any;
      res.json({ success: true, message: 'Logged out successfully' });
    });
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

app.get('/api/debug/env', (req, res) => {
  const actor = (req as any).user;
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
  const actor = (req as any).user;
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
  const actor = (req as any).user;
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

// Direct test route for debugging
app.post('/api/users/direct-test', (req, res) => {
  console.log('Direct test route hit!');
  res.json({ success: true, message: 'Direct route working!' });
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
app.use('/api', mediaRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/owner-control', ownerControlRoutes);

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

app.get('/payment-cancelled', async (req, res) => {
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
    message: 'Aura© Social Backend is running',
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

async function seedDummyPostsIfEmpty() {
  try {
    if (!isDBConnected()) return;
    const db = getDB();
    const count = await db.collection('posts').countDocuments({});
    if (count > 0) return;

    const now = Date.now();

    const authors = [
      {
        id: 'seed-editorial',
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
        id: 'seed-founder',
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
        id: 'seed-leadership',
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
        id: 'seed-agency',
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
        id: 'seed-news-1',
        author: editorial,
        content:
          'News: Independent creators just overtook legacy agencies on total campaign volume for the first time this quarter. Brands are reallocating up to 32% of paid media into creator-led storytelling.\n\nKey shifts:\n• Briefs are shorter, but context is deeper\n• Performance is measured in conversations, not just clicks\n• Creative approval cycles dropped from 21 days to 4\n\n#News #CreatorEconomy #Marketing',
        mediaUrl:
          'https://images.unsplash.com/photo-1522199755839-a2bacb67c546?q=80&w=1200&auto=format&fit=crop',
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
        id: 'seed-news-2',
        author: editorial,
        content:
          'Market Update: Short-form business explainers are now the fastest growing category on Aura©, outpacing lifestyle and entertainment in week-over-week growth.\n\nIf you can teach clearly for 60 seconds, you can open an entirely new acquisition channel.\n\n#News #Business #Education',
        mediaUrl:
          'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?q=80&w=1200&auto=format&fit=crop',
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
        id: 'seed-founder-1',
        author: founder,
        content:
          'Entrepreneurship: I turned a freelance editing habit into a productized “creator ops” studio doing $45k/m with a 3-person remote team.\n\nSimple playbook:\n1) Pick one painful workflow creators avoid\n2) Productize it into a clear package with a fixed scope\n3) Layer in async check-ins instead of endless calls\n4) Let your own content be the top-of-funnel\n\nIt is easier to scale a boring, repeatable service than a clever idea.\n\n#Entrepreneurship #CreatorOps #Playbook',
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
        id: 'seed-founder-2',
        author: founder,
        content:
          'Thread: 7 systems that took my content business from “posting randomly” to “running a proper company”.\n\n1) Monday: “pipeline” review instead of inbox review\n2) A single Notion board shared with all collaborators\n3) One analytics dashboard per offer, not per platform\n4) Weekly “kill meeting” to end weak experiments\n5) 90-minute deep work block reserved for writing\n6) Quarterly price review for every product\n7) Written operating principles so new hires onboard themselves\n\n#Entrepreneur #Systems #Execution',
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
        id: 'seed-leadership-1',
        author: leadership,
        content:
          'Leadership note: Your team does not need more dashboards, they need more clarity.\n\nAsk this in your next standup:\n\n“What are we definitely not doing this week?”\n\nRemoving noise is the highest form of leadership inside a high-signal organization.\n\n#Leadership #Focus #Teams',
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
        id: 'seed-leadership-2',
        author: leadership,
        content:
          'The strongest leaders in 2026 will behave like great editors, not great managers.\n\nThey will:\n• Cut confusing projects\n• Trim bloated meetings\n• Rewrite vague goals into sharp sentences\n• Protect deep work like a scarce resource\n\nEdit the environment and your people will surprise you.\n\n#Leadership #Culture #Editing',
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
        id: 'seed-ad-business-1',
        author: agency,
        content:
          'Ad: Launching a B2B podcast but worried it will become an expensive hobby?\n\nSignal Studio builds end-to-end “revenue podcasts” for SaaS and professional services.\n\nWhat we handle:\n• Strategy and show positioning\n• Guest pipeline and outreach\n• Recording, editing and clipping\n• Distribution across Aura©, LinkedIn and email\n• Revenue attribution dashboard\n\nReply “PODCAST” below and we will DM you a full case study.\n\n#B2B #Podcasting #LeadGen',
        mediaUrl:
          'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1200&auto=format&fit=crop',
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
        id: 'seed-ad-business-2',
        author: agency,
        content:
          'Ad: Running paid social for your business but stuck on creative?\n\nOur “Done-For-You Creative Sprint” gives you:\n• 12 ready-to-run ad concepts\n• 36 hooks tested against your audience\n• 1 brand-safe script library your team can reuse\n\nMost clients see their first winning creative within 21 days.\n\nDM “SPRINT” for the full breakdown.\n\n#Ads #BusinessGrowth #Creative',
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

    await db.collection('posts').insertMany(posts);
    console.log(`✅ Seeded ${posts.length} dummy posts into MongoDB`);
  } catch (error) {
    console.error('⚠️ Failed to seed dummy posts:', error);
  }
}

async function seedDummyAdsIfEmpty() {
  try {
    if (!isDBConnected()) return;
    const db = getDB();
    const count = await db.collection('ads').countDocuments({});
    if (count > 0) return;

    const now = Date.now();

    const ads = [
      {
        id: 'seed-ad-b2b-podcast',
        ownerId: 'business-seed-1',
        ownerName: 'Signal Studio',
        ownerAvatar: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?q=80&w=256&auto=format&fit=crop',
        ownerAvatarType: 'image',
        ownerEmail: 'hello@signalstudio.io',
        headline: 'Turn Your B2B Podcast Into a Sales Channel',
        description:
          'We build “revenue podcasts” for B2B teams. Strategy, booking, editing, clipping, and distribution across Aura© + LinkedIn, all handled for you.\n\nClients see their first SQLs within 60–90 days of launch.\n\nTap to see the full case study.',
        mediaUrl:
          'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1200&auto=format&fit=crop',
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
        id: 'seed-ad-saas-demos',
        ownerId: 'business-seed-2',
        ownerName: 'Pipeline Cloud',
        ownerAvatar: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?q=80&w=256&auto=format&fit=crop',
        ownerAvatarType: 'image',
        ownerEmail: 'growth@pipelinecloud.io',
        headline: 'Book 40% More Qualified Demos From the Same Traffic',
        description:
          'Pipeline Cloud turns your existing traffic into qualified demos using interactive product stories.\n\nNo redesign, no new funnel – we plug into what you already have.\n\nSee how a SaaS team lifted demo volume by 42% in 45 days.',
        mediaUrl:
          'https://images.unsplash.com/photo-1553877522-43269d4ea984?q=80&w=1200&auto=format&fit=crop',
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
        id: 'seed-ad-founder-coaching',
        ownerId: 'business-seed-3',
        ownerName: 'Nova Reyes',
        ownerAvatar: 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?q=80&w=256&auto=format&fit=crop',
        ownerAvatarType: 'image',
        ownerEmail: 'nova@novabuilds.io',
        headline: 'Founder Operating System for Solo and Small Teams',
        description:
          'A 6-week live program that helps founders install a simple operating system: weekly pipeline reviews, clear scorecards, and one-page strategy docs.\n\nBuilt for content-first founders and agencies who feel “busy but blurry”.',
        mediaUrl:
          'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1200&auto=format&fit=crop',
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

    await db.collection('ads').insertMany(ads);
    console.log(`✅ Seeded ${ads.length} dummy ads into MongoDB`);
  } catch (error) {
    console.error('⚠️ Failed to seed dummy ads:', error);
  }
}

// Enhanced server startup with database connection management
async function startServer() {
  try {
    console.log('🚀 Starting Aura© Social Backend...');
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔧 Port: ${PORT}`);
    
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`🌐 Health check available at: http://localhost:${PORT}/health`);
    });
    
    const frontendUrl = process.env.VITE_FRONTEND_URL;
    const allowedOrigins = [
      frontendUrl,
      'https://www.aura.net.za',
      'https://aura.net.za',
      'https://auraradiance.vercel.app',
      'https://aura-front-s1bw.onrender.com',
      'http://localhost:5173'
    ].filter(Boolean) as string[];

    const io = new SocketIOServer(server, {
      cors: {
        origin: allowedOrigins,
        credentials: true,
        methods: ["GET", "POST"]
      },
      transports: ['websocket'],
      path: '/socket.io/',
      pingInterval: 25000,
      pingTimeout: 20000,
    });

    app.set('io', io);
    registerSocketServer(io);

    // Socket authentication middleware
    io.use((socket, next) => {
      let token = socket.handshake.auth?.token;
      
      // Fallback to cookie if token missing from auth object (for session-based logins)
      if (!token && socket.handshake.headers.cookie) {
        const cookies = socket.handshake.headers.cookie.split(';').reduce((acc: any, cookie) => {
          const [key, value] = cookie.trim().split('=');
          acc[key] = value;
          return acc;
        }, {});
        token = cookies.accessToken;
      }

      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }

      const decoded = verifyAccessToken(token);
      if (!decoded) {
        return next(new Error('Authentication error: Invalid token'));
      }

      (socket as any).user = decoded;
      next();
    });

    const identityRoom = (identityType: 'user' | 'company', identityId: string) =>
      `identity:${identityType}:${identityId}`;

    io.on('connection', socket => {
      const user = (socket as any).user;
      console.log(`🔌 Socket.IO client connected: ${socket.id} (User: ${user?.id})`);
      const identityRooms = new Set<string>();

      const joinIdentity = (identityType: 'user' | 'company', identityId: string) => {
        const room = identityRoom(identityType, identityId);
        identityRooms.add(room);
        socket.join(room);
        return room;
      };

      if (user?.id) {
        joinIdentity('user', user.id);
      }

      socket.on('join_user_room', (userId: string) => {
        // Security: Only allow users to join their own room
        if (user && user.id === userId) {
          socket.join(userId);
          console.log(`🏠 User ${user.id} joined their private room`);
        } else {
          console.warn(`⚠️ User ${user?.id} tried to join room for ${userId}`);
        }
      });

      socket.on('join_company_room', async (companyId: string) => {
        if (!user?.id || typeof companyId !== 'string' || !companyId.trim()) return;
        try {
          const hasAccess = await validateIdentityAccess(user.id, companyId);
          if (!hasAccess) {
            console.warn(`⚠️ User ${user.id} denied join_company_room for ${companyId}`);
            return;
          }
          socket.join(`company_${companyId}`);
          joinIdentity('company', companyId);
          console.log(`🏢 User ${user.id} joined company room ${companyId}`);
        } catch (error) {
          console.error('Failed to join company room:', error);
        }
      });

      socket.on('leave_user_room', (userId: string) => {
        if (typeof userId === 'string' && userId.trim()) {
          socket.leave(userId);
        }
      });

      socket.on('leave_company_room', (companyId: string) => {
        if (typeof companyId !== 'string' || !companyId.trim()) return;
        socket.leave(`company_${companyId}`);
        identityRooms.delete(identityRoom('company', companyId));
        socket.leave(identityRoom('company', companyId));
      });

      socket.on(
        'join_identity_room',
        async (payload: { identityType?: 'user' | 'company'; identityId?: string }, ack?: (result: any) => void) => {
          const identityType = payload?.identityType;
          const identityId = payload?.identityId;
          if (!identityType || !identityId) {
            ack?.({ success: false, error: 'identityType and identityId are required' });
            return;
          }

          try {
            if (identityType === 'user' && identityId !== user?.id) {
              ack?.({ success: false, error: 'Unauthorized identity room' });
              return;
            }

            if (identityType === 'company') {
              const hasAccess = await validateIdentityAccess(user?.id, identityId);
              if (!hasAccess) {
                ack?.({ success: false, error: 'Unauthorized identity room' });
                return;
              }
            }

            const room = joinIdentity(identityType, identityId);
            ack?.({ success: true, room });
          } catch (error) {
            console.error('Failed to join identity room:', error);
            ack?.({ success: false, error: 'Failed to join identity room' });
          }
        }
      );

      socket.on(
        'leave_identity_room',
        (payload: { identityType?: 'user' | 'company'; identityId?: string }, ack?: (result: any) => void) => {
          const identityType = payload?.identityType;
          const identityId = payload?.identityId;
          if (!identityType || !identityId) {
            ack?.({ success: false, error: 'identityType and identityId are required' });
            return;
          }

          // Keep personal room persistent while connected.
          if (identityType === 'user' && identityId === user?.id) {
            ack?.({ success: true });
            return;
          }

          const room = identityRoom(identityType, identityId);
          identityRooms.delete(room);
          socket.leave(room);
          ack?.({ success: true });
        }
      );

      type SocketCallPayload = {
        callId?: string;
        fromType?: 'user' | 'company';
        fromId?: string;
        toType?: 'user' | 'company';
        toId?: string;
        callType?: 'audio' | 'video';
        offer?: any;
        answer?: any;
        candidate?: any;
        reason?: string;
      };

      const normalizeCallPayload = (payload: SocketCallPayload) => {
        const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
        const fromType = payload?.fromType;
        const fromId = typeof payload?.fromId === 'string' ? payload.fromId.trim() : '';
        const toType = payload?.toType;
        const toId = typeof payload?.toId === 'string' ? payload.toId.trim() : '';
        const callType: CallType = payload?.callType === 'video' ? 'video' : 'audio';

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

      const recordCallInvite = async (call: ReturnType<typeof normalizeCallPayload>) => {
        if (!call || !isDBConnected()) return;
        try {
          const now = new Date();
          await getCallLogsCollection().updateOne(
            { callId: call.callId },
            {
              $set: {
                callType: call.callType,
                fromType: call.fromType,
                fromId: call.fromId,
                toType: call.toType,
                toId: call.toId,
                initiatedByUserId: user?.id,
                status: 'ringing',
                updatedAt: now,
              },
              $setOnInsert: {
                callId: call.callId,
                startedAt: now,
                createdAt: now,
                seenBy: [],
              },
            },
            { upsert: true }
          );
        } catch (error) {
          console.error('Failed to record call invite:', error);
        }
      };

      const recordCallAccepted = async (call: ReturnType<typeof normalizeCallPayload>) => {
        if (!call || !isDBConnected()) return;
        try {
          const now = new Date();
          await getCallLogsCollection().updateOne(
            { callId: call.callId },
            {
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
                initiatedByUserId: user?.id,
              },
            },
            { upsert: true }
          );
        } catch (error) {
          console.error('Failed to record accepted call:', error);
        }
      };

      const recordCallRejected = async (call: ReturnType<typeof normalizeCallPayload>) => {
        if (!call || !isDBConnected()) return;
        try {
          const now = new Date();
          const reason = typeof call.reason === 'string' && call.reason.trim() ? call.reason.trim() : 'rejected';
          await getCallLogsCollection().updateOne(
            { callId: call.callId },
            {
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
                initiatedByUserId: user?.id,
              },
            },
            { upsert: true }
          );
        } catch (error) {
          console.error('Failed to record rejected call:', error);
        }
      };

      const recordCallEnded = async (call: ReturnType<typeof normalizeCallPayload>) => {
        if (!call || !isDBConnected()) return;
        try {
          const now = new Date();
          const callLogs = getCallLogsCollection();
          const existing = await callLogs.findOne({ callId: call.callId });
          const accepted = !!existing?.acceptedAt || existing?.status === 'accepted' || existing?.status === 'ended';
          const reason = typeof call.reason === 'string' && call.reason.trim() ? call.reason.trim() : 'ended';

          let status: 'ended' | 'missed' | 'cancelled' | 'failed' = 'ended';
          if (!accepted) {
            if (reason === 'no-answer' || reason === 'timeout') {
              status = 'missed';
            } else if (reason === 'cancelled') {
              status = 'cancelled';
            } else {
              status = 'missed';
            }
          } else if (reason === 'failed') {
            status = 'failed';
          }

          const connectedAt = existing?.acceptedAt || existing?.startedAt;
          const durationSeconds =
            accepted && connectedAt
              ? Math.max(0, Math.round((now.getTime() - new Date(connectedAt).getTime()) / 1000))
              : undefined;

          await callLogs.updateOne(
            { callId: call.callId },
            {
              $set: {
                callType: call.callType,
                fromType: call.fromType,
                fromId: call.fromId,
                toType: call.toType,
                toId: call.toId,
                status,
                endReason: reason,
                endedAt: now,
                ...(typeof durationSeconds === 'number' ? { durationSeconds } : {}),
                updatedAt: now,
              },
              $setOnInsert: {
                callId: call.callId,
                startedAt: now,
                createdAt: now,
                seenBy: [],
                initiatedByUserId: user?.id,
              },
            },
            { upsert: true }
          );
        } catch (error) {
          console.error('Failed to record ended call:', error);
        }
      };

      const routeCallEvent = (
        eventName: string,
        payload: SocketCallPayload,
      ) => {
        const call = normalizeCallPayload(payload);
        if (!call) {
          return { call: null, error: 'Invalid call payload' as string };
        }

        const fromRoom = identityRoom(call.fromType, call.fromId);
        if (!identityRooms.has(fromRoom)) {
          console.warn(`⚠️ Blocked call event from non-joined identity ${call.fromType}:${call.fromId}`);
          return { call: null, error: 'Identity room is not joined' as string };
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
          fromUserId: user?.id,
          timestamp: Date.now(),
        });

        return { call, error: null as string | null };
      };

      socket.on('call:invite', async (payload, ack?: (result: any) => void) => {
        const { call, error } = routeCallEvent('call:incoming', payload);
        if (!call) {
          ack?.({ success: false, error: error || 'Unable to route call invite' });
          return;
        }
        await recordCallInvite(call);
        ack?.({ success: true });
      });
      socket.on('call:accept', async (payload, ack?: (result: any) => void) => {
        const { call, error } = routeCallEvent('call:accepted', payload);
        if (!call) {
          ack?.({ success: false, error: error || 'Unable to route call accept' });
          return;
        }
        await recordCallAccepted(call);
        ack?.({ success: true });
      });
      socket.on('call:reject', async (payload, ack?: (result: any) => void) => {
        const { call, error } = routeCallEvent('call:rejected', payload);
        if (!call) {
          ack?.({ success: false, error: error || 'Unable to route call reject' });
          return;
        }
        await recordCallRejected(call);
        ack?.({ success: true });
      });
      socket.on('call:ice-candidate', (payload, ack?: (result: any) => void) => {
        const { call, error } = routeCallEvent('call:ice-candidate', payload);
        if (!call) {
          ack?.({ success: false, error: error || 'Unable to route ICE candidate' });
          return;
        }
        ack?.({ success: true });
      });
      socket.on('call:end', async (payload, ack?: (result: any) => void) => {
        const { call, error } = routeCallEvent('call:ended', payload);
        if (!call) {
          ack?.({ success: false, error: error || 'Unable to route call end' });
          return;
        }
        await recordCallEnded(call);
        ack?.({ success: true });
      });

      socket.on('disconnect', () => {
        console.log('❌ Socket.IO client disconnected', socket.id);
      });
    });
    
    // Then attempt database connection (non-blocking)
    console.log('🔄 Attempting database connection...');
    try {
      const db = await connectDB();
      const isProduction = process.env.NODE_ENV === 'production';

      if (!db) {
        if (isProduction) {
          throw new Error('Database connection is required in production.');
        }
        console.warn('⚠️  Database connection not available. Some features will be unavailable until DB reconnects.');
      } else {
        console.log('✅ Database connection established');

        const shouldSeedDemoData =
          process.env.NODE_ENV !== 'production' &&
          process.env.DISABLE_DEMO_SEEDING !== 'true';

        if (shouldSeedDemoData) {
          await seedDummyPostsIfEmpty();
          await seedDummyAdsIfEmpty();
        }

        // Run legacy company migration
        await migrateLegacyCompanies();
      }
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
    
    // Set up periodic health checks
    setInterval(async () => {
      const isHealthy = await checkDBHealth();
      if (!isHealthy && isDBConnected()) {
        console.warn('⚠️  Database health check failed - connection may be unstable');
      }
    }, 60000);
    
    // Set up daily trust score recalculation
    setInterval(async () => {
      try {
        if (!isDBConnected()) return;
        console.log('🔄 Running daily trust score recalculation job...');
        await recalculateAllTrustScores();
        console.log('✅ Daily trust score recalculation complete');
      } catch (error) {
        console.error('❌ Failed daily trust score recalculation job:', error);
      }
    }, 24 * 60 * 60 * 1000);
    
    // Set up Time Capsule unlock checker
    setInterval(async () => {
      try {
        if (!isDBConnected()) return;
        const db = getDB();
        const now = Date.now();
        
        // Find Time Capsules that just unlocked (within the last 5 minutes)
        const recentlyUnlocked = await db.collection('posts').find({
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
            const { createNotificationInDB } = await import('./controllers/notificationsController');
            
            // Notify the author
            await createNotificationInDB(
              post.author.id,
              'time_capsule_unlocked',
              'system',
              `Your Time Capsule "${post.timeCapsuleTitle || 'Untitled'}" has been unlocked!`,
              post.id
            );
            
            // For group Time Capsules, notify invited users
            if (post.timeCapsuleType === 'group' && post.invitedUsers) {
              for (const userId of post.invitedUsers) {
                await createNotificationInDB(
                  userId,
                  'time_capsule_unlocked',
                  post.author.id,
                  `A Time Capsule from ${post.author.name} has been unlocked!`,
                  post.id
                );
              }
            }
            
            // Mark as notification sent
            await db.collection('posts').updateOne(
              { id: post.id },
              { $set: { unlockNotificationSent: true } }
            );
            
            console.log(`📬 Sent unlock notifications for Time Capsule: ${post.id}`);
          } catch (error) {
            console.error(`Failed to send notification for Time Capsule ${post.id}:`, error);
          }
        }
      } catch (error) {
        console.error('Error checking Time Capsule unlocks:', error);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
    
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

export { app };

if (process.env.NODE_ENV !== 'test') {
  startServer();
}
