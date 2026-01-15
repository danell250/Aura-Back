import express from 'express';
import multer from 'multer';
import { uploadFile } from '../controllers/uploadController';

const router = express.Router();

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4'
];

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'));
    }
    cb(null, true);
  }
});

router.post('/', upload.single('file'), uploadFile);

export default router;
