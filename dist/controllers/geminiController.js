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
exports.generateContent = exports.analyzeDataAura = exports.suggestReply = exports.generatePostInspiration = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Fallback responses for when Gemini API is not available
const fallbackResponses = {
    inspiration: [
        "Stay positive and keep shining! ✨🌟",
        "Every day is a new opportunity to grow! 🌱💪",
        "Your energy is contagious! Spread the good vibes! 🌈😊",
        "Embrace the journey and enjoy every moment! 🎭💫",
        "You're capable of amazing things! Believe in yourself! 🚀✨"
    ],
    replies: [
        "Love this energy! 🔥",
        "So true! 💯",
        "Amazing vibes! 🌟",
        "Beautifully said! 💫",
        "This resonates! 🎵"
    ],
    analysis: [
        "Your aura radiates creativity and authenticity. Digital Frequency: Creative, Authentic, Inspiring.",
        "You resonate with wisdom and compassion. Digital Frequency: Wise, Compassionate, Thoughtful.",
        "Your energy reflects innovation and curiosity. Digital Frequency: Innovative, Curious, Dynamic.",
        "You embody strength and positivity. Digital Frequency: Strong, Positive, Empowering.",
        "Your presence inspires connection and growth. Digital Frequency: Connected, Growth-oriented, Supportive."
    ],
    content: [
        "Here's some great content for you: Share your thoughts on something you're passionate about today!",
        "Consider writing about a challenge you've overcome recently and what you learned from it.",
        "Maybe share an interesting article or resource that has impacted your perspective lately.",
        "Tell your network about a goal you're currently working toward and why it matters to you.",
        "Write about a skill you've developed recently and how it's helped you grow personally or professionally."
    ]
};
function getRandomResponse(type, placeholders) {
    const responses = fallbackResponses[type];
    let response = responses[Math.floor(Math.random() * responses.length)];
    if (placeholders) {
        Object.keys(placeholders).forEach(key => {
            response = response.replace(new RegExp(`{${key}}`, 'g'), placeholders[key]);
        });
    }
    return response;
}
const generatePostInspiration = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { topic } = req.body;
    try {
        // Check if Gemini API is available
        if (process.env.GEMINI_API_KEY) {
            // If Gemini API key exists, you could optionally use it here
            // For now, we'll use fallback responses
        }
        // Use fallback response
        const fallbackResponse = getRandomResponse('inspiration');
        res.json({ text: fallbackResponse });
    }
    catch (error) {
        console.error("Inspiration Error:", error);
        res.status(500).json({ error: "The Aura is currently shifting. Try again later!" });
    }
});
exports.generatePostInspiration = generatePostInspiration;
const suggestReply = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { postContent } = req.body;
    try {
        // Check if Gemini API is available
        if (process.env.GEMINI_API_KEY) {
            // If Gemini API key exists, you could optionally use it here
            // For now, we'll use fallback responses
        }
        // Use fallback response
        const fallbackResponse = getRandomResponse('replies');
        res.json({ text: fallbackResponse });
    }
    catch (error) {
        console.error("Reply Error:", error);
        res.status(500).json({ error: "Beautifully said." });
    }
});
exports.suggestReply = suggestReply;
const analyzeDataAura = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { userData, posts } = req.body;
    try {
        // Check if Gemini API is available
        if (process.env.GEMINI_API_KEY) {
            // If Gemini API key exists, you could optionally use it here
            // For now, we'll use fallback responses
        }
        // Use fallback response
        const fallbackResponse = getRandomResponse('analysis');
        res.json({ text: fallbackResponse });
    }
    catch (error) {
        console.error("Analysis Error:", error);
        res.status(500).json({ error: "Unable to calibrate neural Aura at this time." });
    }
});
exports.analyzeDataAura = analyzeDataAura;
const generateContent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { prompt } = req.body;
    try {
        // Check if Gemini API is available
        if (process.env.GEMINI_API_KEY) {
            // If Gemini API key exists, you could optionally use it here
            // For now, we'll use fallback responses
        }
        // Use fallback response
        const fallbackResponse = getRandomResponse('content');
        res.json({ text: fallbackResponse });
    }
    catch (error) {
        console.error("Content Generation Error:", error);
        res.status(500).json({ error: "The creative frequencies are currently shifting. Please try again in a moment! 🌟" });
    }
});
exports.generateContent = generateContent;
