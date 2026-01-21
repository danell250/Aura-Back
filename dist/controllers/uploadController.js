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
exports.uploadFile = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const db_1 = require("../db");
const uuid_1 = require("uuid");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const cloudinary_1 = require("cloudinary");
const s3Region = process.env.S3_REGION || 'us-east-1';
const s3Bucket = process.env.S3_BUCKET_NAME || '';
const s3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL || '';
const s3Client = new client_s3_1.S3Client({
    region: process.env.S3_REGION,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    },
    requestChecksumCalculation: "WHEN_REQUIRED"
});
const uploadsDir = path_1.default.join(process.cwd(), 'uploads');
const hasCloudinaryConfig = !!process.env.CLOUDINARY_NAME &&
    !!process.env.CLOUDINARY_KEY &&
    !!process.env.CLOUDINARY_SECRET;
if (hasCloudinaryConfig) {
    cloudinary_1.v2.config({
        cloud_name: process.env.CLOUDINARY_NAME,
        api_key: process.env.CLOUDINARY_KEY,
        api_secret: process.env.CLOUDINARY_SECRET
    });
}
const uploadImageToCloudinary = (buffer, folder) => __awaiter(void 0, void 0, void 0, function* () {
    return new Promise((resolve, reject) => {
        const stream = cloudinary_1.v2.uploader.upload_stream({ folder }, (error, result) => {
            if (error || !result) {
                return reject(error || new Error('Cloudinary upload failed'));
            }
            resolve(result.secure_url);
        });
        stream.end(buffer);
    });
});
const uploadFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }
    const isAllowedType = req.file.mimetype === 'image/jpeg' ||
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
            const secureUrl = yield uploadImageToCloudinary(req.file.buffer, folder);
            const db = (0, db_1.getDB)();
            yield db.collection('mediaFiles').insertOne({
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
        }
        catch (error) {
            console.error('Failed to upload image to Cloudinary, falling back to bucket/local:', error);
        }
    }
    const fileExtension = req.file.originalname.includes('.')
        ? req.file.originalname.substring(req.file.originalname.lastIndexOf('.'))
        : '';
    const filename = `${(0, uuid_1.v4)()}${fileExtension}`;
    const objectKey = `uploads/${filename}`;
    if (!s3Bucket) {
        if (process.env.NODE_ENV === 'production') {
            console.error("S3_BUCKET_NAME is not configured");
            return res.status(500).json({ error: 'S3_BUCKET_NAME not configured' });
        }
        // Local fallback for dev only
        try {
            if (!fs_1.default.existsSync(uploadsDir)) {
                fs_1.default.mkdirSync(uploadsDir, { recursive: true });
            }
            const filePath = path_1.default.join(uploadsDir, filename);
            fs_1.default.writeFileSync(filePath, req.file.buffer);
            const urlFromBase = `/uploads/${filename}`;
            const db = (0, db_1.getDB)();
            yield db.collection('mediaFiles').insertOne({
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
        }
        catch (error) {
            console.error('Failed to store file locally:', error);
            return res.status(500).json({ error: 'Failed to upload file' });
        }
    }
    try {
        const putCommand = new client_s3_1.PutObjectCommand({
            Bucket: s3Bucket,
            Key: objectKey,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
            // ACL removed to support buckets with 'Block Public Access' enabled
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
        return res.status(500).json({ error: 'Failed to upload file to S3', details: error.message });
    }
});
exports.uploadFile = uploadFile;
