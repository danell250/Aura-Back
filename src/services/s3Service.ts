import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ 
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!
  }
});

export async function getUploadUrl(params: {
  key: string;
  contentType: string;
}) {
  const Bucket = process.env.S3_BUCKET_NAME;
  
  if (!Bucket) {
    throw new Error("S3_BUCKET_NAME environment variable is not set");
  }
  
  const command = new PutObjectCommand({
    Bucket,
    Key: params.key,
    ContentType: params.contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 }); // 60s
  const region = process.env.S3_REGION;
  const publicUrl = `https://${Bucket}.s3.${region}.amazonaws.com/${params.key}`;

  return { uploadUrl, publicUrl };
}
