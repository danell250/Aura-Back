import { Request, Response } from 'express';
import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
// Initialize GoogleGenAI only if API key is present to avoid crash on startup
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const generatePostInspiration = async (req: Request, res: Response) => {
  if (!ai) {
    res.status(500).json({ error: "Gemini API key not configured" });
    return;
  }
  
  const { topic } = req.body;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Write a short, engaging social media post about ${topic} for a platform called Aura. The tone should be positive, mindful, and high-vibe. Keep it under 200 characters and include 2 relevant emojis.`,
    });
    res.json({ text: response.text || "Could not generate inspiration right now. Stay bright!" });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "The aura is currently shifting. Try again later!" });
  }
};

export const suggestReply = async (req: Request, res: Response) => {
    if (!ai) {
        res.status(500).json({ error: "Gemini API key not configured" });
        return;
    }

  const { postContent } = req.body;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Given this post: "${postContent}", suggest a short, thoughtful and positive comment reply (max 15 words).`,
    });
    res.json({ text: response.text || "Love the energy!" });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Beautifully said." });
  }
};

export const generateQuirkyBirthdayWish = async (req: Request, res: Response) => {
    if (!ai) {
        res.status(500).json({ error: "Gemini API key not configured" });
        return;
    }

  const { name, bio = "" } = req.body;

  try {
    const response = await ai.models.generateContent({
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
  } catch (error) {
    console.error("Gemini Birthday Error:", error);
    res.status(500).json({ error: `Universal sync complete: ${name} is officially one orbit older. Energy levels at maximum! 🚀✨🎂` });
  }
};

export const analyzeDataAura = async (req: Request, res: Response) => {
    if (!ai) {
        res.status(500).json({ error: "Gemini API key not configured" });
        return;
    }

  const { userData, posts } = req.body;

  try {
    const postSummary = posts.map((p: any) => p.content).join(" | ").substring(0, 500);
    const response = await ai.models.generateContent({
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
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    res.status(500).json({ error: "Unable to calibrate neural aura at this time." });
  }
};
