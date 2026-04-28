import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { nanoid } from 'nanoid';

const uploadDir = path.resolve('uploads/agent-payments');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const agentId = String(req.params.agentId || req.agent?.agentId || 'agent').replace(/[^a-zA-Z0-9_-]/g, '');
    const methodKey = String(req.params.methodKey || 'method').replace(/[^a-zA-Z0-9_-]/g, '');
    const ext = path.extname(file.originalname || '.png').toLowerCase();
    cb(null, `${agentId}-${methodKey}-${Date.now()}-${nanoid(8)}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error('Only JPG, PNG, WEBP or GIF image is allowed'));
  }
  cb(null, true);
}

export const agentPaymentUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});
