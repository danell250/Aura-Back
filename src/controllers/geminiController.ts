import { Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

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

function getRandomResponse(type: keyof typeof fallbackResponses, placeholders?: { [key: string]: string }) {
  const responses = fallbackResponses[type];
  let response = responses[Math.floor(Math.random() * responses.length)];
  
  if (placeholders) {
    Object.keys(placeholders).forEach(key => {
      response = response.replace(new RegExp(`{${key}}`, 'g'), placeholders[key]);
    });
  }
  
  return response;
}

export const generatePostInspiration = async (req: Request, res: Response) => {
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
  } catch (error) {
    console.error("Inspiration Error:", error);
    res.status(500).json({ error: "The Aura™ is currently shifting. Try again later!" });
  }
};

export const suggestReply = async (req: Request, res: Response) => {
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
  } catch (error) {
    console.error("Reply Error:", error);
    res.status(500).json({ error: "Beautifully said." });
  }
};

export const analyzeDataAura = async (req: Request, res: Response) => {
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
  } catch (error) {
    console.error("Analysis Error:", error);
    res.status(500).json({ error: "Unable to calibrate neural Aura™ at this time." });
  }
};

export const generateContent = async (req: Request, res: Response) => {
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
  } catch (error) {
    console.error("Content Generation Error:", error);
    res.status(500).json({ error: "The creative frequencies are currently shifting. Please try again in a moment! 🌟" });
  }
};
