import express from 'express';

const router = express.Router();

const bannedKeywords = [
  'nsfw',
  'porn',
  'sex',
  'nude',
  'naked',
  'xxx',
  'erotic'
];

const isAllowedRating = (rating: string | undefined) => {
  if (!rating) return true;
  const normalized = rating.toLowerCase();
  return normalized === 'g' || normalized === 'pg' || normalized === 'y';
};

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';

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

    const response = await fetch(`https://api.giphy.com/v1/gifs/search?${params.toString()}`);

    if (!response.ok) {
      return res.status(502).json({ error: 'Giphy search failed' });
    }

    const data = await response.json();
    const filtered = Array.isArray(data.data)
      ? data.data.filter((item: any) => isAllowedRating(item.rating))
      : [];
    res.json({ ...data, data: filtered });
  } catch (err) {
    console.error('Error in GIPHY search proxy:', err);
    res.status(500).json({ error: 'Giphy search failed' });
  }
});

router.get('/trending', async (_req, res) => {
  try {
    if (!process.env.GIPHY_API_KEY) {
      return res.status(500).json({ error: 'GIPHY API key is not configured' });
    }

    const params = new URLSearchParams({
      api_key: process.env.GIPHY_API_KEY,
      limit: '25',
      rating: 'pg'
    });

    const response = await fetch(`https://api.giphy.com/v1/gifs/trending?${params.toString()}`);

    if (!response.ok) {
      return res.status(502).json({ error: 'Giphy trending fetch failed' });
    }

    const data = await response.json();
    const filtered = Array.isArray(data.data)
      ? data.data.filter((item: any) => isAllowedRating(item.rating))
      : [];
    res.json({ ...data, data: filtered });
  } catch (err) {
    console.error('Error in GIPHY trending proxy:', err);
    res.status(500).json({ error: 'Giphy trending fetch failed' });
  }
});

export default router;
