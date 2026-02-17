import express from "express"; 
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"; 
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; 
import crypto from "crypto"; 
import { requireAdmin, requireAuth } from "../middleware/authMiddleware";
import { IdentityActor, resolveIdentityActor } from "../utils/identityUtils";
import { getDB } from "../db";

const router = express.Router(); 

const readString = (value: unknown): string | undefined => {
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

const ALLOWED_FOLDERS: Record<string, string[]> = {
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

const isOwnerType = (value: string): value is "user" | "company" => value === "user" || value === "company";

const normalizeStoredOwnerType = (value: unknown): "user" | "company" => {
  return value === "company" ? "company" : "user";
};

const isLegacyKeyAuthorized = async (key: string, actor: IdentityActor): Promise<boolean> => {
  const normalizedKey = key.replace(/^\/+/, "");
  if (normalizedKey.includes("..")) return false;

  const parts = normalizedKey.split("/").filter(Boolean);
  if (parts.length < 2) return false;

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

  const db = getDB();

  if (folder === "posts") {
    const post = await db.collection("posts").findOne(
      { id: scopeSegment },
      { projection: { author: 1 } }
    ) as any;

    if (!post?.author?.id) return false;
    const authorType = normalizeStoredOwnerType(post.author.type);
    return post.author.id === actor.id && authorType === actor.type;
  }

  if (folder === "ads") {
    const ad = await db.collection("ads").findOne(
      { id: scopeSegment },
      { projection: { ownerId: 1, ownerType: 1, userId: 1 } }
    ) as any;

    if (!ad) return false;
    const ownerId = typeof ad.ownerId === "string" && ad.ownerId
      ? ad.ownerId
      : (typeof ad.userId === "string" ? ad.userId : "");
    if (!ownerId) return false;

    const ownerType = normalizeStoredOwnerType(ad.ownerType);
    return ownerId === actor.id && ownerType === actor.type;
  }

  return false;
};

const s3 = new S3Client({ 
  region: process.env.S3_REGION, 
  credentials: { 
    accessKeyId: process.env.S3_ACCESS_KEY_ID!, 
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!, 
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
}); 

router.get("/debug/s3", requireAuth, requireAdmin, (req, res) => { 
  res.json({ 
    region: process.env.S3_REGION, 
    bucket: process.env.S3_BUCKET_NAME, 
    hasKey: !!process.env.S3_ACCESS_KEY_ID, 
    hasSecret: !!process.env.S3_SECRET_ACCESS_KEY, 
  }); 
});

router.get("/media/view-url", requireAuth, async (req, res) => { 
  try {
    const key = readString(req.query.key);
    if (!key) return res.status(400).json({ success: false, error: "Missing key" });
    if (key.includes("..") || key.startsWith("/")) {
      return res.status(400).json({ success: false, error: "Invalid key format" });
    }

    const authenticatedUserId = (req as any).user?.id as string | undefined;
    if (!authenticatedUserId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const ownerTypeInput = readString(req.query.ownerType) || readString(req.headers["x-identity-type"]) || "user";
    if (!isOwnerType(ownerTypeInput)) {
      return res.status(400).json({ success: false, error: "Invalid owner type" });
    }

    const ownerId = readString(req.query.ownerId) || readString(req.headers["x-identity-id"]) || authenticatedUserId;
    const actor = await resolveIdentityActor(authenticatedUserId, {
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

    const db = getDB();
    const ownership = await db.collection("media_upload_ownership").findOne(
      { key },
      { projection: { ownerId: 1, ownerType: 1 } }
    ) as any;

    let isAuthorized = false;
    if (ownership) {
      isAuthorized = ownership.ownerId === actor.id && normalizeStoredOwnerType(ownership.ownerType) === actor.type;
    } else {
      isAuthorized = await isLegacyKeyAuthorized(key, actor);
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "You are not allowed to access this media object"
      });
    }

    const command = new GetObjectCommand({ 
      Bucket: process.env.S3_BUCKET_NAME!, 
      Key: key, 
    }); 

    const url = await getSignedUrl(s3, command, { expiresIn: 600 }); 
    res.json({ success: true, url });
  } catch (error: any) {
    console.error("view-url error:", error?.message || error);
    res.status(500).json({ success: false, error: "Failed to generate view URL" });
  }
});

router.post("/media/upload-url", requireAuth, async (req, res) => { 
  try { 
    const authenticatedUserId = (req as any).user?.id as string | undefined;
    if (!authenticatedUserId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const fileName = readString(req.body?.fileName);
    const fileType = readString(req.body?.fileType);
    const contentType = readString(req.body?.contentType);
    const folder = readString(req.body?.folder) || "avatars";
    const entityId = readString(req.body?.entityId);
    const ownerId = readString(req.body?.userId) || authenticatedUserId;
    const ownerTypeInput = readString(req.body?.ownerType);

    if (ownerTypeInput && ownerTypeInput !== "user" && ownerTypeInput !== "company") {
      return res.status(400).json({ success: false, error: "Invalid owner type" });
    }

    const requestedOwnerType = (ownerTypeInput || "user") as "user" | "company";
    const actor = await resolveIdentityActor(authenticatedUserId, {
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
    const id = crypto.randomBytes(12).toString("hex"); 
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

    const db = getDB();
    const timestamp = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.collection("media_upload_ownership").updateOne(
      { key },
      {
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
      },
      { upsert: true }
    );

    const command = new PutObjectCommand({ 
      Bucket: bucketName, 
      Key: key, 
      ContentType: finalContentType, 
      // ❌ DO NOT set ChecksumAlgorithm 
      // ❌ DO NOT set ACL 
    }); 

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); 
    
    const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL || `https://${bucketName}.s3.${process.env.S3_REGION}.amazonaws.com`;

    return res.json({ 
      success: true, 
      uploadUrl, 
      key, 
      // This URL will exist but won't be viewable unless object is public 
      objectUrl: `${publicBaseUrl}/${key}`, 
    }); 
  } catch (e: any) { 
    console.error("upload-url error:", e?.message, e); 
    return res.status(500).json({ success: false, error: e?.message || "Server error" }); 
  } 
}); 

export default router;
