import express from "express"; 
import crypto from "crypto"; 
import { getUploadUrl } from "../services/s3Service"; 

const router = express.Router(); 

router.post("/media/upload-url", async (req, res) => { 
  try { 
    const { userId, fileName, contentType, folder = "posts" } = req.body; 

    if (!userId || !fileName || !contentType) { 
      return res.status(400).json({ success: false, error: "Missing fields" }); 
    } 

    const ext = fileName.split(".").pop() || "bin"; 
    const id = crypto.randomBytes(12).toString("hex"); 

    // Key structure: posts/<userId>/<id>.<ext> 
    const key = `${folder}/${userId}/${id}.${ext}`; 

    const result = await getUploadUrl({ key, contentType }); 

    res.json({ success: true, ...result, key }); 
  } catch (e: any) { 
    console.error("upload-url error", e); 
    res.status(500).json({ success: false, error: "Failed to create upload URL" }); 
  } 
}); 

export default router;