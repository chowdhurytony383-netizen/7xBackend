import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { nanoid } from 'nanoid';

const uploadDir = path.resolve('uploads/verification');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${nanoid(10)}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.mimetype)) return cb(new Error('Only images and PDF documents are allowed'));
  cb(null, true);
}

export const verificationUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 6 * 1024 * 1024 },
}).fields([
  { name: 'documentFront', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
]);
