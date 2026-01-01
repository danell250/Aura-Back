import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import geminiRoutes from './routes/geminiRoutes';
import uploadRoutes from './routes/uploadRoutes';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors({
  origin: [
    'https://auraradiance.netlify.app',
    'http://localhost:5000',
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json());

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));

// Routes
app.use('/api/gemini', geminiRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/', (req, res) => {
  res.send('Aura Social Backend is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
