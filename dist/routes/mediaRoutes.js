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
const express_1 = __importDefault(require("express"));
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = __importDefault(require("crypto"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const identityUtils_1 = require("../utils/identityUtils");
const db_1 = require("../db");
const router = express_1.default.Router();
const readString = (value) => {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
        const trimmed = value[0].trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return undefined;
};
const ALLOWED_FOLDERS = {
    avatars: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    covers: ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"],
    posts: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/csv"
    ],
    documents: [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/csv"
    ],
    ads: ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"],
    chat: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/csv"
    ]
};
const isOwnerType = (value) => value === "user" || value === "company";
const normalizeStoredOwnerType = (value) => {
    return value === "company" ? "company" : "user";
};
const isLegacyKeyAuthorized = (key, actor) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const normalizedKey = key.replace(/^\/+/, "");
    if (normalizedKey.includes(".."))
        return false;
    const parts = normalizedKey.split("/").filter(Boolean);
    if (parts.length < 2)
        return false;
    const folder = parts[0];
    const scopeSegment = parts[1];
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_FOLDERS, folder)) {
        return false;
    }
    if ((folder === "avatars" || folder === "covers") && scopeSegment.startsWith(`${actor.id}-`)) {
        return true;
    }
    if (scopeSegment === actor.id) {
        return true;
    }
    const db = (0, db_1.getDB)();
    if (folder === "posts") {
        const post = yield db.collection("posts").findOne({ id: scopeSegment }, { projection: { author: 1 } });
        if (!((_a = post === null || post === void 0 ? void 0 : post.author) === null || _a === void 0 ? void 0 : _a.id))
            return false;
        const authorType = normalizeStoredOwnerType(post.author.type);
        return post.author.id === actor.id && authorType === actor.type;
    }
    if (folder === "ads") {
        const ad = yield db.collection("ads").findOne({ id: scopeSegment }, { projection: { ownerId: 1, ownerType: 1, userId: 1 } });
        if (!ad)
            return false;
        const ownerId = typeof ad.ownerId === "string" && ad.ownerId
            ? ad.ownerId
            : (typeof ad.userId === "string" ? ad.userId : "");
        if (!ownerId)
            return false;
        const ownerType = normalizeStoredOwnerType(ad.ownerType);
        return ownerId === actor.id && ownerType === actor.type;
    }
    return false;
});
const s3 = new client_s3_1.S3Client({
    region: process.env.S3_REGION,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
});
router.get("/debug/s3", authMiddleware_1.requireAuth, authMiddleware_1.requireAdmin, (req, res) => {
    res.json({
        region: process.env.S3_REGION,
        bucket: process.env.S3_BUCKET_NAME,
        hasKey: !!process.env.S3_ACCESS_KEY_ID,
        hasSecret: !!process.env.S3_SECRET_ACCESS_KEY,
    });
});
router.get("/media/view-url", authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const key = readString(req.query.key);
        if (!key)
            return res.status(400).json({ success: false, error: "Missing key" });
        if (key.includes("..") || key.startsWith("/")) {
            return res.status(400).json({ success: false, error: "Invalid key format" });
        }
        const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!authenticatedUserId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }
        const ownerTypeInput = readString(req.query.ownerType) || readString(req.headers["x-identity-type"]) || "user";
        if (!isOwnerType(ownerTypeInput)) {
            return res.status(400).json({ success: false, error: "Invalid owner type" });
        }
        const ownerId = readString(req.query.ownerId) || readString(req.headers["x-identity-id"]) || authenticatedUserId;
        const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
            ownerType: ownerTypeInput,
            ownerId
        }, req.headers);
        if (!actor || actor.id !== ownerId || actor.type !== ownerTypeInput) {
            return res.status(403).json({
                success: false,
                error: "Forbidden",
                message: "Unauthorized identity context for media access"
            });
        }
        const db = (0, db_1.getDB)();
        const ownership = yield db.collection("media_upload_ownership").findOne({ key }, { projection: { ownerId: 1, ownerType: 1 } });
        let isAuthorized = false;
        if (ownership) {
            isAuthorized = ownership.ownerId === actor.id && normalizeStoredOwnerType(ownership.ownerType) === actor.type;
        }
        else {
            isAuthorized = yield isLegacyKeyAuthorized(key, actor);
        }
        if (!isAuthorized) {
            return res.status(403).json({
                success: false,
                error: "Forbidden",
                message: "You are not allowed to access this media object"
            });
        }
        const command = new client_s3_1.GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
        });
        const url = yield (0, s3_request_presigner_1.getSignedUrl)(s3, command, { expiresIn: 600 });
        res.json({ success: true, url });
    }
    catch (error) {
        console.error("view-url error:", (error === null || error === void 0 ? void 0 : error.message) || error);
        res.status(500).json({ success: false, error: "Failed to generate view URL" });
    }
}));
router.post("/media/upload-url", authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!authenticatedUserId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }
        const fileName = readString((_b = req.body) === null || _b === void 0 ? void 0 : _b.fileName);
        const fileType = readString((_c = req.body) === null || _c === void 0 ? void 0 : _c.fileType);
        const contentType = readString((_d = req.body) === null || _d === void 0 ? void 0 : _d.contentType);
        const folder = readString((_e = req.body) === null || _e === void 0 ? void 0 : _e.folder) || "avatars";
        const entityId = readString((_f = req.body) === null || _f === void 0 ? void 0 : _f.entityId);
        const ownerId = readString((_g = req.body) === null || _g === void 0 ? void 0 : _g.userId) || authenticatedUserId;
        const ownerTypeInput = readString((_h = req.body) === null || _h === void 0 ? void 0 : _h.ownerType);
        if (ownerTypeInput && ownerTypeInput !== "user" && ownerTypeInput !== "company") {
            return res.status(400).json({ success: false, error: "Invalid owner type" });
        }
        const requestedOwnerType = (ownerTypeInput || "user");
        const actor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {
            ownerType: requestedOwnerType,
            ownerId
        });
        if (!actor || actor.id !== ownerId || actor.type !== requestedOwnerType) {
            return res.status(403).json({
                success: false,
                error: "Forbidden",
                message: "Unauthorized identity context for upload"
            });
        }
        const finalContentType = fileType || contentType;
        if (!fileName || !finalContentType) {
            return res.status(400).json({ success: false, error: "Missing fields" });
        }
        if (!ALLOWED_FOLDERS[folder]) {
            return res.status(400).json({
                success: false,
                error: `Invalid folder '${folder}'. Allowed: ${Object.keys(ALLOWED_FOLDERS).join(', ')}`
            });
        }
        if (!ALLOWED_FOLDERS[folder].includes(finalContentType)) {
            return res.status(400).json({
                success: false,
                error: `Invalid content type '${finalContentType}' for folder '${folder}'. Allowed: ${ALLOWED_FOLDERS[folder].join(', ')}`
            });
        }
        const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin";
        const safeExt = String(ext).toLowerCase().replace(/[^a-z0-9]/g, "");
        const id = crypto_1.default.randomBytes(12).toString("hex");
        const bucketName = process.env.S3_BUCKET_NAME;
        if (!bucketName) {
            console.warn("S3 Bucket not configured, returning 503 to trigger local fallback");
            return res.status(503).json({ success: false, error: "S3_NOT_CONFIGURED" });
        }
        let key = "";
        // Special case for user profile media (avatars/covers)
        if (folder === "avatars" || folder === "covers") {
            // avatars/{ownerId}-{uuid}.png
            key = `${folder}/${actor.id}-${id}.${safeExt}`;
        }
        // Special case for entity-specific media (posts/ads/documents)
        else if (entityId) {
            // posts/{postId}/{uuid}.jpg
            key = `${folder}/${entityId}/${id}.${safeExt}`;
        }
        // Default fallback
        else {
            // posts/{ownerId}/{uuid}.jpg (if no entityId provided)
            key = `${folder}/${actor.id}/${id}.${safeExt}`;
        }
        const db = (0, db_1.getDB)();
        const timestamp = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        yield db.collection("media_upload_ownership").updateOne({ key }, {
            $set: {
                key,
                folder,
                ownerId: actor.id,
                ownerType: actor.type,
                entityId: entityId || null,
                updatedAt: timestamp,
                expiresAt
            },
            $setOnInsert: {
                createdAt: timestamp
            }
        }, { upsert: true });
        const command = new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: finalContentType,
            // ❌ DO NOT set ChecksumAlgorithm 
            // ❌ DO NOT set ACL 
        });
        const uploadUrl = yield (0, s3_request_presigner_1.getSignedUrl)(s3, command, { expiresIn: 300 });
        const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL || `https://${bucketName}.s3.${process.env.S3_REGION}.amazonaws.com`;
        return res.json({
            success: true,
            uploadUrl,
            key,
            // This URL will exist but won't be viewable unless object is public 
            objectUrl: `${publicBaseUrl}/${key}`,
        });
    }
    catch (e) {
        console.error("upload-url error:", e === null || e === void 0 ? void 0 : e.message, e);
        return res.status(500).json({ success: false, error: (e === null || e === void 0 ? void 0 : e.message) || "Server error" });
    }
}));
exports.default = router;
