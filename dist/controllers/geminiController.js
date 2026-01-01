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
exports.analyzeDataAura = exports.generateQuirkyBirthdayWish = exports.suggestReply = exports.generatePostInspiration = void 0;
const genai_1 = require("@google/genai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const apiKey = process.env.GEMINI_API_KEY;
// Initialize GoogleGenAI only if API key is present to avoid crash on startup
const ai = apiKey ? new genai_1.GoogleGenAI({ apiKey }) : null;
const generatePostInspiration = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ai) {
        res.status(500).json({ error: "Gemini API key not configured" });
        return;
    }
    const { topic } = req.body;
    try {
        const response = yield ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Write a short, engaging social media post about ${topic} for a platform called Aura. The tone should be positive, mindful, and high-vibe. Keep it under 200 characters and include 2 relevant emojis.`,
        });
        res.json({ text: response.text || "Could not generate inspiration right now. Stay bright!" });
    }
    catch (error) {
        console.error("Gemini Error:", error);
        res.status(500).json({ error: "The aura is currently shifting. Try again later!" });
    }
});
exports.generatePostInspiration = generatePostInspiration;
const suggestReply = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ai) {
        res.status(500).json({ error: "Gemini API key not configured" });
        return;
    }
    const { postContent } = req.body;
    try {
        const response = yield ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Given this post: "${postContent}", suggest a short, thoughtful and positive comment reply (max 15 words).`,
        });
        res.json({ text: response.text || "Love the energy!" });
    }
    catch (error) {
        console.error("Gemini Error:", error);
        res.status(500).json({ error: "Beautifully said." });
    }
});
exports.suggestReply = suggestReply;
const generateQuirkyBirthdayWish = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ai) {
        res.status(500).json({ error: "Gemini API key not configured" });
        return;
    }
    const { name, bio = "" } = req.body;
    try {
        const response = yield ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `It is ${name}'s birthday today on the social platform Aura. 
      User's Aura context/bio: "${bio}".
      Write a funny, quirky, and high-vibe birthday wish for them. 
      Avoid generic "Happy Birthday". 
      Make it sound like a neural network trying to be "human-cool" and celebratory. 
      Keep it under 150 characters. 
      Include exactly 3 chaotic but fun emojis.`,
        });
        res.json({ text: response.text || `Another rotation around the sun completed, ${name}. Your frequency is undeniable. Stay weird! 🌀🎸🍰` });
    }
    catch (error) {
        console.error("Gemini Birthday Error:", error);
        res.status(500).json({ error: `Universal sync complete: ${name} is officially one orbit older. Energy levels at maximum! 🚀✨🎂` });
    }
});
exports.generateQuirkyBirthdayWish = generateQuirkyBirthdayWish;
const analyzeDataAura = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ai) {
        res.status(500).json({ error: "Gemini API key not configured" });
        return;
    }
    const { userData, posts } = req.body;
    try {
        const postSummary = posts.map((p) => p.content).join(" | ").substring(0, 500);
        const response = yield ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Analyze this user's digital footprint for the Aura platform. 
      User Name: ${userData.name}
      Bio: ${userData.bio}
      Recent Activity Summary: ${postSummary}
      
      Provide a 2-sentence visual "Privacy Insight" on how the network perceives their 'aura' (e.g. professional, creative, contemplative). 
      Then give 3 specific tags for their 'Digital Frequency'. 
      Be concise and elegant.`,
        });
        res.json({ text: response.text || "Your aura is clear and transparent. You resonate with purity." });
    }
    catch (error) {
        console.error("Gemini Analysis Error:", error);
        res.status(500).json({ error: "Unable to calibrate neural aura at this time." });
    }
});
exports.analyzeDataAura = analyzeDataAura;
