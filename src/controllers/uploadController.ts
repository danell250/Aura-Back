import { Request, Response } from 'express';
import { getDB } from '../db';

export const uploadFile = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const protocol = req.protocol;
  const host = req.get('host');
  const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

  try {
    const db = getDB();
    await db.collection('mediaFiles').insertOne({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: fileUrl,
      uploadedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to record uploaded file in database:', error);
  }

  res.json({
    url: fileUrl,
    filename: req.file.filename,
    mimetype: req.file.mimetype
  });
};
