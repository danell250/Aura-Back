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
exports.getUploadUrl = getUploadUrl;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const s3 = new client_s3_1.S3Client({
    region: process.env.AWS_REGION || process.env.S3_REGION
});
function getUploadUrl(params) {
    return __awaiter(this, void 0, void 0, function* () {
        const Bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME;
        const command = new client_s3_1.PutObjectCommand({
            Bucket,
            Key: params.key,
            ContentType: params.contentType,
        });
        const uploadUrl = yield (0, s3_request_presigner_1.getSignedUrl)(s3, command, { expiresIn: 60 }); // 60s
        const region = process.env.AWS_REGION || process.env.S3_REGION;
        const publicUrl = `https://${Bucket}.s3.${region}.amazonaws.com/${params.key}`;
        return { uploadUrl, publicUrl };
    });
}
