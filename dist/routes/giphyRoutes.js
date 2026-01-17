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
const router = express_1.default.Router();
const bannedKeywords = [
    'nsfw',
    'porn',
    'sex',
    'nude',
    'naked',
    'xxx',
    'erotic'
];
const isAllowedRating = (rating) => {
    if (!rating)
        return true;
    const normalized = rating.toLowerCase();
    return normalized === 'g' || normalized === 'pg' || normalized === 'y';
};
router.get('/search', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const q = req.query.q || '';
        const lower = q.toLowerCase();
        const blocked = bannedKeywords.some(keyword => lower.includes(keyword));
        if (blocked) {
            return res.json({ data: [] });
        }
        if (!process.env.GIPHY_API_KEY) {
            return res.status(500).json({ error: 'GIPHY API key is not configured' });
        }
        const params = new URLSearchParams({
            api_key: process.env.GIPHY_API_KEY,
            q,
            limit: '25',
            rating: 'pg'
        });
        const response = yield fetch(`https://api.giphy.com/v1/gifs/search?${params.toString()}`);
        if (!response.ok) {
            return res.status(502).json({ error: 'Giphy search failed' });
        }
        const data = yield response.json();
        const filtered = Array.isArray(data.data)
            ? data.data.filter((item) => isAllowedRating(item.rating))
            : [];
        res.json(Object.assign(Object.assign({}, data), { data: filtered }));
    }
    catch (err) {
        console.error('Error in GIPHY search proxy:', err);
        res.status(500).json({ error: 'Giphy search failed' });
    }
}));
router.get('/trending', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!process.env.GIPHY_API_KEY) {
            return res.status(500).json({ error: 'GIPHY API key is not configured' });
        }
        const params = new URLSearchParams({
            api_key: process.env.GIPHY_API_KEY,
            limit: '25',
            rating: 'pg'
        });
        const response = yield fetch(`https://api.giphy.com/v1/gifs/trending?${params.toString()}`);
        if (!response.ok) {
            return res.status(502).json({ error: 'Giphy trending fetch failed' });
        }
        const data = yield response.json();
        const filtered = Array.isArray(data.data)
            ? data.data.filter((item) => isAllowedRating(item.rating))
            : [];
        res.json(Object.assign(Object.assign({}, data), { data: filtered }));
    }
    catch (err) {
        console.error('Error in GIPHY trending proxy:', err);
        res.status(500).json({ error: 'Giphy trending fetch failed' });
    }
}));
exports.default = router;
