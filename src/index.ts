import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import passport from 'passport';
import session from 'express-session';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
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
import { attachUser } from './middleware/authMiddleware';
import path from 'path';
import fs from 'fs';
import { connectDB, checkDBHealth, isDBConnected, getDB } from './db';

dotenv.config();

// Passport Google OAuth Strategy Configuration
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || '63639970194-r83ifit3giq02jd1rgfq84uea5tbgv6h.apps.googleusercontent.com',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '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',
  callbackURL: "https://aura-back-s1bw.onrender.com/api/auth/google/callback"
},
async (_accessToken, _refreshToken, profile, done) => {
  try {
    // Parse name from profile
    const displayName = profile.displayName || '';
    const nameParts = displayName.trim().split(/\s+/);
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || '';
    const email = profile.emails?.[0]?.value;
    
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
      avatar: profile.photos?.[0]?.value || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
      avatarType: 'image' as const,
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
      activeGlow: 'none' as const
    };
    
    return done(null, user);
  } catch (error) {
    console.error('Error in Google OAuth strategy:', error);
    return done(error as any, undefined);
  }
}
));

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
      done(null, user);
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

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // allow server-to-server & tools like curl/postman
    if (!origin) return callback(null, true);

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
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Remove the problematic wildcard options route
// app.options("*", cors());

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret_for_development',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Set to true in production with HTTPS
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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

// Authentication routes (should come first)
app.use('/api/auth', authRoutes);

// Privacy routes
app.use('/api/privacy', privacyRoutes);

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
    res.json({ user: req.user });
  } else {
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

// Payment return routes for PayPal
app.get('/payment-success', async (req, res) => {
  console.log('💰 Payment success callback received');
  const { paymentId, token, PayerID } = req.query;
  
  try {
    // For Personal Pulse one-time payment
    if (paymentId) {
      console.log('Activating 14-day access for Personal Pulse payment:', paymentId);
      
      // TODO: Verify payment with PayPal API
      // TODO: Create ad subscription record with 14-day expiry
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Successful - Aura</title>
          <meta http-equiv="refresh" content="3;url=/">
          <style>
            body { font-family: system-ui; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; padding: 4rem; }
            .success { font-size: 3rem; margin-bottom: 1rem; }
            .message { font-size: 1.2rem; opacity: 0.9; }
          </style>
        </head>
        <body>
          <div class="success">✅ Payment Successful!</div>
          <div class="message">Your 14-day Personal Pulse access is now active. Returning to app...</div>
        </body>
        </html>
      `);
    } else {
      res.redirect('/?payment=success');
    }
  } catch (error) {
    console.error('Payment success error:', error);
    res.redirect('/?payment=error');
  }
});

app.get('/payment-cancelled', async (req, res) => {
  console.log('❌ Payment cancelled by user');
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled - Aura</title>
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

app.get('/share/post/:id', async (req, res) => {
  try {
    const db = getDB();
    const post = await db.collection('posts').findOne({ id: req.params.id });
    if (!post) {
      res.status(404).send('Not found');
      return;
    }
    const protocol = req.protocol;
    const host = req.get('host');
    const shareUrl = `${protocol}://${host}/share/post/${post.id}`;
    const author = post.author || {};
    const title = `${author.name || 'Post'} on Aura`;
    const description = String(post.content || '').slice(0, 300);
    const mediaUrl = post.mediaUrl || '';
    const avatarUrl = author.avatar || '';
    const isImage = mediaUrl && (post.mediaType === 'image' || /\.(png|jpg|jpeg|webp|gif)$/i.test(mediaUrl));
    const isVideo = mediaUrl && (post.mediaType === 'video' || /\.(mp4|webm|ogg|mov)$/i.test(mediaUrl));
    const imageForOg = isImage ? mediaUrl : avatarUrl || '';
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${shareUrl}">
    ${imageForOg ? `<meta property="og:image" content="${imageForOg}">` : ''}
    ${isVideo ? `<meta property="og:video" content="${mediaUrl}">` : ''}
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    ${imageForOg ? `<meta name="twitter:image" content="${imageForOg}">` : ''}
    <meta name="twitter:card" content="${imageForOg ? 'summary_large_image' : 'summary'}">
    <style>
      body{margin:0;background:#0f172a;color:#fff;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif}
      .container{max-width:680px;margin:0 auto;padding:24px}
      .card{background:#0b1220;border:1px solid #1f2937;border-radius:24px;box-shadow:0 12px 30px rgba(0,0,0,.35);overflow:hidden}
      .header{display:flex;gap:12px;align-items:center;padding:20px}
      .avatar{width:44px;height:44px;border-radius:12px;border:1px solid #334155;overflow:hidden;background:#0f172a}
      .avatar img{width:100%;height:100%;object-fit:cover}
      .names{flex:1;min-width:0}
      .name{font-weight:700;font-size:14px;letter-spacing:-.01em}
      .handle{font-size:12px;color:#94a3b8}
      .content{padding:0 20px 20px;font-size:15px;line-height:1.6;color:#e2e8f0;white-space:pre-wrap}
      .media{margin:0 20px 20px;border-radius:16px;overflow:hidden;background:#0f172a;border:1px solid #1f2937;display:flex;align-items:center;justify-content:center}
      .media img{width:100%;height:auto;max-height:600px;object-fit:cover}
      .media video{width:100%;height:auto;max-height:600px}
      .footer{display:flex;gap:12px;align-items:center;padding:16px 20px;border-top:1px solid #1f2937}
      .badge{padding:6px 10px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
      .energy{background:#022c22;color:#34d399;border:1px solid #065f46}
      .date{color:#94a3b8;font-size:11px;margin-left:auto}
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <div class="header">
          <div class="avatar">${avatarUrl ? `<img src="${avatarUrl}" alt="${author.name || ''}">` : ''}</div>
          <div class="names">
            <div class="name">${author.name || ''}</div>
            <div class="handle">${author.handle || ''}</div>
          </div>
          ${post.isBoosted ? `<span class="badge" style="background:#064e3b;color:#a7f3d0;border:1px solid #10b981">Boosted</span>` : ``}
          ${post.isTimeCapsule ? `<span class="badge" style="background:#3b0764;color:#e9d5ff;border:1px solid #8b5cf6">${post.isUnlocked ? 'Unlocked' : 'Time Capsule'}</span>` : ``}
        </div>
        <div class="content">${String(post.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
        ${mediaUrl ? `<div class="media">${isImage ? `<img src="${mediaUrl}" alt="">` : isVideo ? `<video src="${mediaUrl}" controls playsinline></video>` : ``}</div>` : ``}
        <div class="footer">
          ${post.energy ? `<span class="badge energy">${post.energy}</span>` : ``}
          <span class="date">${new Date(post.timestamp || Date.now()).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  </body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (e) {
    res.status(500).send('Server error');
  }
});

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
    }, 60000);
    
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

startServer();
