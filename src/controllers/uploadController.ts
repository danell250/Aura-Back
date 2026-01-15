import { Request, Response } from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getDB } from '../db';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const s3Region = process.env.S3_REGION || 'us-east-1';
const s3Bucket = process.env.S3_BUCKET_NAME || '';
const s3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL || '';

const s3Client = new S3Client({
  region: s3Region
});

const uploadsDir = path.join(__dirname, '../uploads');

export const uploadFile = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const isAllowedType =
    req.file.mimetype === 'image/jpeg' ||
    req.file.mimetype === 'image/png' ||
    req.file.mimetype === 'image/webp' ||
    req.file.mimetype === 'video/mp4' ||
    req.file.mimetype === 'application/pdf';

  if (!isAllowedType) {
    return res.status(400).json({ error: 'Invalid file type' });
  }

  const fileExtension = req.file.originalname.includes('.')
    ? req.file.originalname.substring(req.file.originalname.lastIndexOf('.'))
    : '';
  const filename = `${uuidv4()}${fileExtension}`;
  const objectKey = `uploads/${filename}`;

  if (!s3Bucket) {
    try {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      const urlFromBase = `/uploads/${filename}`;

      const db = getDB();
      await db.collection('mediaFiles').insertOne({
        storageProvider: 'local',
        path: filePath,
        filename: objectKey,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: urlFromBase,
        scanStatus: 'not_enabled',
        uploadedAt: new Date().toISOString()
      });

      return res.json({
        url: urlFromBase,
        filename: objectKey,
        mimetype: req.file.mimetype
      });
    } catch (error) {
      console.error('Failed to store file locally:', error);
      return res.status(500).json({ error: 'Failed to upload file' });
    }
  }

  try {
    const putCommand = new PutObjectCommand({
      Bucket: s3Bucket,
      Key: objectKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read'
    });

    await s3Client.send(putCommand);

    const urlFromBase = s3PublicBaseUrl
      ? `${s3PublicBaseUrl.replace(/\/$/, '')}/${objectKey}`
      : `https://${s3Bucket}.s3.amazonaws.com/${objectKey}`;

    const db = getDB();
    await db.collection('mediaFiles').insertOne({
      storageProvider: 's3',
      bucket: s3Bucket,
      key: objectKey,
      filename: objectKey,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: urlFromBase,
      scanStatus: process.env.ENABLE_AV_SCAN === 'true' ? 'pending' : 'not_enabled',
      uploadedAt: new Date().toISOString()
    });

    res.json({
      url: urlFromBase,
      filename: objectKey,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Failed to upload file to storage bucket:', error);

    try {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      const urlFromBase = `/uploads/${filename}`;

      const db = getDB();
      await db.collection('mediaFiles').insertOne({
        storageProvider: 'local',
        path: filePath,
        filename: objectKey,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: urlFromBase,
        scanStatus: 'not_enabled',
        uploadedAt: new Date().toISOString()
      });

      return res.json({
        url: urlFromBase,
        filename: objectKey,
        mimetype: req.file.mimetype
      });
    } catch (localError) {
      console.error('Failed to store file locally after storage bucket failure:', localError);
      return res.status(500).json({ error: 'Failed to upload file' });
    }
  }
};
