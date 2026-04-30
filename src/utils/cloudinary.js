import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { nanoid } from 'nanoid';
import { v2 as cloudinary } from 'cloudinary';

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY = process.env.CLOUDINARY_API_KEY || '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

export const isCloudinaryEnabled = Boolean(CLOUD_NAME && API_KEY && API_SECRET);

if (isCloudinaryEnabled) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true,
  });
}

function safeName(value = 'file') {
  return String(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'file';
}

function getExtension(file) {
  return path.extname(file?.originalname || '').toLowerCase() || '.bin';
}

function buildLocalUrl(req, localSubDir, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/${localSubDir}/${filename}`;
}

function uploadStream(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    Readable.from(buffer).pipe(stream);
  });
}

async function saveLocalUpload(file, { req, localSubDir, publicIdPrefix }) {
  const uploadDir = path.resolve('uploads', localSubDir);
  await fs.promises.mkdir(uploadDir, { recursive: true });

  const ext = getExtension(file);
  const filename = `${safeName(publicIdPrefix)}-${Date.now()}-${nanoid(8)}${ext}`;
  const targetPath = path.join(uploadDir, filename);

  await fs.promises.writeFile(targetPath, file.buffer);
  return buildLocalUrl(req, localSubDir, filename);
}

export async function saveUploadedFile(file, options = {}) {
  if (!file) return '';

  const {
    req,
    localSubDir = 'misc',
    cloudinaryFolder = '7xbet/misc',
    publicIdPrefix = file.originalname || 'file',
    resourceType = 'auto',
  } = options;

  if (!file.buffer) {
    // This should not happen with the new memoryStorage middleware, but keeps a clear error.
    throw new Error('Uploaded file buffer was not found. Please use memoryStorage upload middleware.');
  }

  if (!isCloudinaryEnabled) {
    if (!req) throw new Error('Request object is required for local upload fallback');
    return saveLocalUpload(file, { req, localSubDir, publicIdPrefix });
  }

  const publicId = `${safeName(publicIdPrefix)}-${Date.now()}-${nanoid(8)}`;
  const result = await uploadStream(file.buffer, {
    folder: cloudinaryFolder,
    public_id: publicId,
    resource_type: resourceType,
    overwrite: false,
    unique_filename: true,
  });

  return result.secure_url || result.url || '';
}
