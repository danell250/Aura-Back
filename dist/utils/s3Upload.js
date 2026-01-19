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
exports.uploadToS3 = uploadToS3;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3Region = process.env.S3_REGION || 'us-east-1';
const s3Bucket = process.env.S3_BUCKET_NAME || '';
const s3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL || '';
// Credentials are automatically loaded from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars
const s3Client = new client_s3_1.S3Client({
    region: s3Region
});
function uploadToS3(folder, filename, fileBuffer, contentType) {
    return __awaiter(this, void 0, void 0, function* () {
        // Ensure we don't have double slashes if filename already contains the folder or path
        const key = filename.startsWith(folder + '/') ? filename : `${folder}/${filename}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: s3Bucket,
            Key: key,
            Body: fileBuffer,
            ContentType: contentType,
            // ACL: 'public-read' // Uncomment if your bucket requires ACLs for public access
        });
        yield s3Client.send(command);
        if (s3PublicBaseUrl) {
            return `${s3PublicBaseUrl.replace(/\/$/, '')}/${key}`;
        }
        return `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${key}`;
    });
}
