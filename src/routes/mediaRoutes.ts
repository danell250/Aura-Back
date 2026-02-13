import express from "express"; 
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"; 
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; 
import crypto from "crypto"; 

const router = express.Router(); 

const s3 = new S3Client({ 
  region: process.env.S3_REGION, 
  credentials: { 
    accessKeyId: process.env.S3_ACCESS_KEY_ID!, 
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!, 
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
}); 

router.get("/debug/s3", (req, res) => { 
  res.json({ 
    region: process.env.S3_REGION, 
    bucket: process.env.S3_BUCKET_NAME, 
    hasKey: !!process.env.S3_ACCESS_KEY_ID, 
    hasSecret: !!process.env.S3_SECRET_ACCESS_KEY, 
  }); 
});

router.get("/media/view-url", async (req, res) => { 
  const { key } = req.query; 

  if (!key) return res.status(400).json({ error: "Missing key" }); 

  const command = new GetObjectCommand({ 
    Bucket: process.env.S3_BUCKET_NAME!, 
    Key: key as string, 
  }); 

  const url = await getSignedUrl(s3, command, { expiresIn: 600 }); 

  res.json({ url }); 
});

router.post("/media/upload-url", async (req, res) => { 
  try { 
    console.log("ENV CHECK:", { 
      S3_REGION: process.env.S3_REGION, 
      S3_BUCKET_NAME: process.env.S3_BUCKET_NAME, 
      HAS_KEY: !!process.env.S3_ACCESS_KEY_ID, 
      HAS_SECRET: !!process.env.S3_SECRET_ACCESS_KEY, 
    });

    const { fileName, fileType, contentType, folder = "avatars", userId, entityId } = req.body; 
    const finalContentType = fileType || contentType;

    // Determine logical owner for this media (user or company/entity)
    // For posts/ads/documents we mostly use entityId, for avatars/covers we prefer entityId when present.
    const ownerId = entityId || userId;

    // --- STRICT VALIDATION START ---
    const ALLOWED_FOLDERS: Record<string, string[]> = {
      avatars: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      covers: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'],
      posts: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'],
      documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ads: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'],
      chat: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    };

    if (!fileName || !finalContentType || !ownerId) { 
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
    // --- STRICT VALIDATION END ---

    const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin"; 
    const safeExt = String(ext).toLowerCase().replace(/[^a-z0-9]/g, ""); 
    const id = crypto.randomBytes(12).toString("hex"); 
    const bucketName = process.env.S3_BUCKET_NAME;

    if (!bucketName) {
      console.warn("S3 Bucket not configured, returning 503 to trigger local fallback");
      return res.status(503).json({ success: false, error: "S3_NOT_CONFIGURED" });
    }

    let key = "";

    // Special case for profile media (avatars/covers)
    // Use entityId when provided (e.g. company avatars), otherwise fall back to userId.
    if (folder === "avatars" || folder === "covers") {
      // avatars/{ownerId}-{uuid}.png
      key = `${folder}/${ownerId}-${id}.${safeExt}`;
    } 
    // Special case for entity-specific media (posts/ads/documents)
    else if (entityId) {
      // posts/{postId}/{uuid}.jpg
      key = `${folder}/${entityId}/${id}.${safeExt}`;
    }
    // Default fallback
    else {
      // posts/{userId}/{uuid}.jpg (if no entityId provided)
      key = `${folder}/${userId}/${id}.${safeExt}`;
    }

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
