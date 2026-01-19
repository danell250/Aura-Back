import { Request, Response } from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getDB } from '../db';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';

const s3Region = process.env.S3_REGION || 'us-east-1';
const s3Bucket = process.env.S3_BUCKET_NAME || '';
const s3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL || '';

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!
  }
});

const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');

const hasCloudinaryConfig =
  !!process.env.CLOUDINARY_NAME &&
  !!process.env.CLOUDINARY_KEY &&
  !!process.env.CLOUDINARY_SECRET;

if (hasCloudinaryConfig) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
  });
}

const uploadImageToCloudinary = async (buffer: Buffer, folder: string): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error || !result) {
          return reject(error || new Error('Cloudinary upload failed'));
        }
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
};

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

  const isImage = req.file.mimetype.startsWith('image/');

  if (hasCloudinaryConfig && isImage) {
    try {
      const folder = process.env.CLOUDINARY_FOLDER || 'aura-uploads';
      const secureUrl = await uploadImageToCloudinary(req.file.buffer, folder);

      const db = getDB();
      await db.collection('mediaFiles').insertOne({
        storageProvider: 'cloudinary',
        folder,
        publicUrl: secureUrl,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: secureUrl,
        scanStatus: 'not_enabled',
        uploadedAt: new Date().toISOString()
      });

      return res.json({
        url: secureUrl,
        filename: secureUrl,
        mimetype: req.file.mimetype
      });
    } catch (error) {
      console.error('Failed to upload image to Cloudinary, falling back to bucket/local:', error);
    }
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
