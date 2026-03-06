import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { readString } from '../utils/inputSanitizers';

let s3Client: S3Client | null = null;

const getS3Client = (): S3Client | null => {
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) return null;
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Client;
};

export const getApplicationResumeSignedUrl = async (
  resumeKey: string,
  expiresInSeconds = 600,
): Promise<string | null> => {
  const normalizedKey = readString(resumeKey, 500);
  if (!normalizedKey) return null;

  const bucketName = process.env.S3_BUCKET_NAME;
  const client = getS3Client();
  if (!bucketName || !client) return null;

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: normalizedKey,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
};
