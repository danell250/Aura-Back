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
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFile = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const db_1 = require("../db");
const uuid_1 = require("uuid");
const s3Region = process.env.S3_REGION || 'us-east-1';
const s3Bucket = process.env.S3_BUCKET_NAME || '';
const s3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL || '';
const s3Client = new client_s3_1.S3Client({
    region: s3Region
});
const uploadFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }
    const isAllowedType = req.file.mimetype === 'image/jpeg' ||
        req.file.mimetype === 'image/png' ||
        req.file.mimetype === 'image/webp' ||
        req.file.mimetype === 'video/mp4';
    if (!isAllowedType) {
        return res.status(400).json({ error: 'Invalid file type' });
    }
    if (!s3Bucket) {
        return res.status(500).json({ error: 'File storage is not configured' });
    }
    const fileExtension = req.file.originalname.includes('.')
        ? req.file.originalname.substring(req.file.originalname.lastIndexOf('.'))
        : '';
    const objectKey = `uploads/${(0, uuid_1.v4)()}${fileExtension}`;
    try {
        const putCommand = new client_s3_1.PutObjectCommand({
            Bucket: s3Bucket,
            Key: objectKey,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
            ACL: 'public-read'
        });
        yield s3Client.send(putCommand);
        const urlFromBase = s3PublicBaseUrl
            ? `${s3PublicBaseUrl.replace(/\/$/, '')}/${objectKey}`
            : `https://${s3Bucket}.s3.amazonaws.com/${objectKey}`;
        const db = (0, db_1.getDB)();
        yield db.collection('mediaFiles').insertOne({
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
    }
    catch (error) {
        console.error('Failed to upload file to storage bucket:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});
exports.uploadFile = uploadFile;
