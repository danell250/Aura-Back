"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const geminiRoutes_1 = __importDefault(require("./routes/geminiRoutes"));
const uploadRoutes_1 = __importDefault(require("./routes/uploadRoutes"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5002;
// Ensure uploads directory exists
const uploadsDir = path_1.default.join(__dirname, '../uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
app.use((0, cors_1.default)({
    origin: [
        'https://auraradiance.netlify.app',
        'https://auraraidiate.netlify.app/',
        'http://localhost:5000',
        'http://localhost:5173'
    ],
    credentials: true
}));
app.use(express_1.default.json());
// Serve uploaded files statically
app.use('/uploads', express_1.default.static(uploadsDir));
// Routes
app.use('/api/gemini', geminiRoutes_1.default);
app.use('/api/upload', uploadRoutes_1.default);
app.get('/', (req, res) => {
    res.send('Aura Social Backend is running');
});
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
