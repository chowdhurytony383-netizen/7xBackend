import multer from 'multer';

function fileFilter(_req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.mimetype)) return cb(new Error('Only images and PDF documents are allowed'));
  cb(null, true);
}

export const verificationUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 6 * 1024 * 1024 },
}).fields([
  { name: 'documentFront', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
]);


function imageFileFilter(_req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG or WEBP images are allowed'));
  cb(null, true);
}

export const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: { fileSize: 3 * 1024 * 1024 },
}).fields([
  { name: 'picture', maxCount: 1 },
  { name: 'profilePicture', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
]);
