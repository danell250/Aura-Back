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
exports.getApplicationResumeSignedUrl = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const inputSanitizers_1 = require("../utils/inputSanitizers");
let s3Client = null;
const getS3Client = () => {
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (!region || !accessKeyId || !secretAccessKey)
        return null;
    if (s3Client)
        return s3Client;
    s3Client = new client_s3_1.S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
    });
    return s3Client;
};
const getApplicationResumeSignedUrl = (resumeKey_1, ...args_1) => __awaiter(void 0, [resumeKey_1, ...args_1], void 0, function* (resumeKey, expiresInSeconds = 600) {
    const normalizedKey = (0, inputSanitizers_1.readString)(resumeKey, 500);
    if (!normalizedKey)
        return null;
    const bucketName = process.env.S3_BUCKET_NAME;
    const client = getS3Client();
    if (!bucketName || !client)
        return null;
    const command = new client_s3_1.GetObjectCommand({
        Bucket: bucketName,
        Key: normalizedKey,
    });
    return (0, s3_request_presigner_1.getSignedUrl)(client, command, { expiresIn: expiresInSeconds });
});
exports.getApplicationResumeSignedUrl = getApplicationResumeSignedUrl;
