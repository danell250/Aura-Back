import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Region = process.env.S3_REGION || 'us-east-1';
const s3Bucket = process.env.S3_BUCKET_NAME || '';
const s3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL || '';

// Credentials are automatically loaded from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars
const s3Client = new S3Client({
  region: s3Region
});

export async function uploadToS3(
  folder: string,
  filename: string,
  fileBuffer: Buffer,
  contentType: string
): Promise<string> {
  // Ensure we don't have double slashes if filename already contains the folder or path
  const key = filename.startsWith(folder + '/') ? filename : `${folder}/${filename}`;

  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
    // ACL: 'public-read' // Uncomment if your bucket requires ACLs for public access
  });

  await s3Client.send(command);

  if (s3PublicBaseUrl) {
    return `${s3PublicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  return `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${key}`;
}
