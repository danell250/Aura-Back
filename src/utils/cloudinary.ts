import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
if (
  process.env.CLOUDINARY_NAME &&
  process.env.CLOUDINARY_KEY &&
  process.env.CLOUDINARY_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
  });
}

/**
 * Uploads an image buffer to Cloudinary
 * @param buffer The file buffer
 * @param folder The folder path in Cloudinary
 * @returns The secure URL of the uploaded image
 */
export const uploadImage = async (buffer: Buffer, folder: string): Promise<string> => {
  if (
    !process.env.CLOUDINARY_NAME ||
    !process.env.CLOUDINARY_KEY ||
    !process.env.CLOUDINARY_SECRET
  ) {
    throw new Error('Cloudinary credentials are not configured');
  }

  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error || !result) {
          return reject(error || new Error('Cloudinary upload failed'));
        }
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
};
