import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import geminiRoutes from './routes/geminiRoutes';
import uploadRoutes from './routes/uploadRoutes';
import postsRoutes from './routes/postsRoutes';
import path from 'path';
import fs from 'fs';
import { connectDB } from './db';

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

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));

// Routes
app.use('/api/gemini', geminiRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/posts', postsRoutes);

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'API routes are working!', timestamp: new Date() });
});

app.get('/', (req, res) => {
  res.send('Aura Social Backend is running with MongoDB connection');
});

// Start server and connect to database
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📊 MongoDB connected to database: aura`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    // Don't exit on DB connection failure, continue with server running
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`⚠️  Warning: Database connection failed. Server running without database.`);
    });
  }
}

startServer();
