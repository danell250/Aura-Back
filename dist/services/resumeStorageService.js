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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveResumeBuffer = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const stream_1 = require("stream");
const client_s3_1 = require("@aws-sdk/client-s3");
const MEDIA_FILES_COLLECTION = 'mediaFiles';
const LOCAL_UPLOADS_ROOT = path_1.default.resolve(process.cwd(), 'uploads');
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const getS3Client = () => {
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (!region || !accessKeyId || !secretAccessKey)
        return null;
    return new client_s3_1.S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
    });
};
const streamToBuffer = (stream) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, stream_2, stream_2_1;
    var _b, e_1, _c, _d;
    const chunks = [];
    try {
        for (_a = true, stream_2 = __asyncValues(stream); stream_2_1 = yield stream_2.next(), _b = stream_2_1.done, !_b; _a = true) {
            _d = stream_2_1.value;
            _a = false;
            const chunk = _d;
            if (Buffer.isBuffer(chunk)) {
                chunks.push(chunk);
            }
            else if (chunk instanceof Uint8Array) {
                chunks.push(Buffer.from(chunk));
            }
            else {
                chunks.push(Buffer.from(String(chunk)));
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (!_a && !_b && (_c = stream_2.return)) yield _c.call(stream_2);
        }
        finally { if (e_1) throw e_1.error; }
    }
    return Buffer.concat(chunks);
});
const bodyToBuffer = (body) => __awaiter(void 0, void 0, void 0, function* () {
    if (!body)
        return null;
    if (Buffer.isBuffer(body))
        return body;
    if (body instanceof Uint8Array)
        return Buffer.from(body);
    if (typeof body.transformToByteArray === 'function') {
        const bytes = yield body.transformToByteArray();
        return Buffer.from(bytes);
    }
    if (body instanceof stream_1.Readable) {
        return yield streamToBuffer(body);
    }
    return null;
});
const fetchS3ObjectBuffer = (bucket, key) => __awaiter(void 0, void 0, void 0, function* () {
    const s3 = getS3Client();
    if (!s3 || !bucket || !key)
        return null;
    try {
        const response = yield s3.send(new client_s3_1.GetObjectCommand({
            Bucket: bucket,
            Key: key,
        }));
        return yield bodyToBuffer(response === null || response === void 0 ? void 0 : response.Body);
    }
    catch (error) {
        console.warn('Resume storage: failed to read S3 object', { key, error });
        return null;
    }
});
const resolveLocalResumeBuffer = (filePath) => __awaiter(void 0, void 0, void 0, function* () {
    const resolvedPath = path_1.default.resolve(filePath);
    const withinUploadsRoot = resolvedPath === LOCAL_UPLOADS_ROOT ||
        resolvedPath.startsWith(`${LOCAL_UPLOADS_ROOT}${path_1.default.sep}`);
    if (!withinUploadsRoot) {
        console.warn('Resume storage: blocked local path outside uploads root', {
            filePath,
            resolvedPath,
        });
        return null;
    }
    try {
        return yield promises_1.default.readFile(resolvedPath);
    }
    catch (error) {
        console.warn('Resume storage: failed to read local file', { resolvedPath, error });
        return null;
    }
});
const resolveResumeBufferFromMedia = (media, fallbackKey) => __awaiter(void 0, void 0, void 0, function* () {
    const storageProvider = readString(media === null || media === void 0 ? void 0 : media.storageProvider, 40).toLowerCase();
    if (storageProvider === 'local') {
        const filePath = readString(media === null || media === void 0 ? void 0 : media.path, 800);
        return filePath ? yield resolveLocalResumeBuffer(filePath) : null;
    }
    if (storageProvider === 's3') {
        const bucket = readString(media === null || media === void 0 ? void 0 : media.bucket, 120)
            || readString(process.env.S3_BUCKET_NAME || '', 120);
        const s3Key = readString(media === null || media === void 0 ? void 0 : media.key, 600) || fallbackKey;
        return yield fetchS3ObjectBuffer(bucket, s3Key);
    }
    return null;
});
const resolveResumeBuffer = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const resumeKey = readString(params.resumeKey, 500);
    if (!resumeKey)
        return null;
    const media = yield params.db.collection(MEDIA_FILES_COLLECTION).findOne({
        $or: [{ key: resumeKey }, { filename: resumeKey }],
    });
    if (media) {
        const fromMedia = yield resolveResumeBufferFromMedia(media, resumeKey);
        if (fromMedia)
            return fromMedia;
    }
    const fallbackBucket = readString(process.env.S3_BUCKET_NAME || '', 120);
    if (!fallbackBucket)
        return null;
    return yield fetchS3ObjectBuffer(fallbackBucket, resumeKey);
});
exports.resolveResumeBuffer = resolveResumeBuffer;
