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

    const { fileName, fileType, contentType, folder = "avatars", userId } = req.body; 
    const finalContentType = fileType || contentType;

    if (!fileName || !finalContentType || !userId) { 
      return res.status(400).json({ success: false, error: "Missing fields" }); 
    } 

    const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin"; 
    const safeExt = String(ext).toLowerCase().replace(/[^a-z0-9]/g, ""); 
    const id = crypto.randomBytes(12).toString("hex"); 

    const key = `${folder}/${userId}/${id}.${safeExt}`; 
    const bucketName = process.env.S3_BUCKET_NAME;

    if (!bucketName) {
      throw new Error("Bucket name not configured");
    }

    const command = new PutObjectCommand({ 
      Bucket: bucketName, 
      Key: key, 
      ContentType: finalContentType, 
      // NO ACL
    }); 

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 }); 
    
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
