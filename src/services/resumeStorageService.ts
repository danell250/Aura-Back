import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const MEDIA_FILES_COLLECTION = 'mediaFiles';
const LOCAL_UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

const readString = (value: unknown, maxLength = 10000): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

const getS3Client = (): S3Client | null => {
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
};

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(String(chunk)));
    }
  }
  return Buffer.concat(chunks);
};

const bodyToBuffer = async (body: any): Promise<Buffer | null> => {
  if (!body) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }
  if (body instanceof Readable) {
    return await streamToBuffer(body);
  }
  return null;
};

const fetchS3ObjectBuffer = async (bucket: string, key: string): Promise<Buffer | null> => {
  const s3 = getS3Client();
  if (!s3 || !bucket || !key) return null;

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    return await bodyToBuffer((response as any)?.Body);
  } catch (error) {
    console.warn('Resume storage: failed to read S3 object', { key, error });
    return null;
  }
};

const resolveLocalResumeBuffer = async (filePath: string): Promise<Buffer | null> => {
  const resolvedPath = path.resolve(filePath);
  const withinUploadsRoot =
    resolvedPath === LOCAL_UPLOADS_ROOT ||
    resolvedPath.startsWith(`${LOCAL_UPLOADS_ROOT}${path.sep}`);

  if (!withinUploadsRoot) {
    console.warn('Resume storage: blocked local path outside uploads root', {
      filePath,
      resolvedPath,
    });
    return null;
  }

  try {
    return await fs.readFile(resolvedPath);
  } catch (error) {
    console.warn('Resume storage: failed to read local file', { resolvedPath, error });
    return null;
  }
};

const resolveResumeBufferFromMedia = async (media: any, fallbackKey: string): Promise<Buffer | null> => {
  const storageProvider = readString((media as any)?.storageProvider, 40).toLowerCase();

  if (storageProvider === 'local') {
    const filePath = readString((media as any)?.path, 800);
    return filePath ? await resolveLocalResumeBuffer(filePath) : null;
  }

  if (storageProvider === 's3') {
    const bucket = readString((media as any)?.bucket, 120)
      || readString(process.env.S3_BUCKET_NAME || '', 120);
    const s3Key = readString((media as any)?.key, 600) || fallbackKey;
    return await fetchS3ObjectBuffer(bucket, s3Key);
  }

  return null;
};

export const resolveResumeBuffer = async (params: {
  db: any;
  resumeKey: string;
}): Promise<Buffer | null> => {
  const resumeKey = readString(params.resumeKey, 500);
  if (!resumeKey) return null;

  const media = await params.db.collection(MEDIA_FILES_COLLECTION).findOne({
    $or: [{ key: resumeKey }, { filename: resumeKey }],
  });

  if (media) {
    const fromMedia = await resolveResumeBufferFromMedia(media, resumeKey);
    if (fromMedia) return fromMedia;
  }

  const fallbackBucket = readString(process.env.S3_BUCKET_NAME || '', 120);
  if (!fallbackBucket) return null;

  return await fetchS3ObjectBuffer(fallbackBucket, resumeKey);
};
