import Verification from '../models/Verification.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrThrow } from '../utils/appError.js';
import { requireEmail, requireString } from '../utils/validation.js';
import { saveUploadedFile } from '../utils/cloudinary.js';

async function saveVerificationDocument(req, file, label) {
  if (!file) return '';
  return saveUploadedFile(file, {
    req,
    localSubDir: 'verification',
    cloudinaryFolder: '7xbet/verification',
    publicIdPrefix: `${req.user?.userId || req.user?._id || 'user'}-${label}`,
    resourceType: 'auto',
  });
}

function extractPayload(req) {
  return {
    fullName: requireString(req.body.fullName, 'Full Name', 2, 160),
    email: requireEmail(req.body.email),
    phone: requireString(req.body.phone, 'Phone', 4, 40),
    dateOfBirth: new Date(requireString(req.body.dateOfBirth, 'Date of birth', 4, 40)),
    address: requireString(req.body.address, 'Address', 2, 300),
    street: requireString(req.body.street, 'Street', 1, 180),
    city: requireString(req.body.city, 'City', 1, 120),
    postCode: requireString(req.body.postCode, 'Post code', 1, 40),
    documentType: requireString(req.body.documentType, 'Documents Type', 2, 40),
    documentNumber: requireString(req.body.documentNumber, 'Document-Number', 2, 80),
  };
}

export const getMyVerification = asyncHandler(async (req, res) => {
  const verification = await Verification.findOne({ user: req.user._id });
  res.json({ success: true, data: verification || null, verification });
});

export const submitVerification = asyncHandler(async (req, res) => {
  const payload = extractPayload(req);
  assertOrThrow(!Number.isNaN(payload.dateOfBirth.getTime()), 'Invalid date of birth', 400);

  const existing = await Verification.findOne({ user: req.user._id });
  assertOrThrow(!existing || existing.status === 'rejected', 'Verification already submitted', 409);

  const documentFront = await saveVerificationDocument(req, req.files?.documentFront?.[0], 'document-front');
  const documentBack = await saveVerificationDocument(req, req.files?.documentBack?.[0], 'document-back');
  assertOrThrow(documentFront, 'Document front is required', 400);

  const verification = await Verification.findOneAndUpdate(
    { user: req.user._id },
    { ...payload, user: req.user._id, documentFront, documentBack, status: 'pending', adminNote: '' },
    { upsert: true, new: true, runValidators: true }
  );

  Object.assign(req.user, {
    fullName: payload.fullName,
    name: payload.fullName,
    phone: payload.phone,
    dateOfBirth: payload.dateOfBirth,
    address: payload.address,
    street: payload.street,
    city: payload.city,
    postCode: payload.postCode,
    verificationStatus: 'pending',
  });
  await req.user.save();

  res.status(201).json({ success: true, message: 'Verification submitted', data: verification });
});

export const updateVerification = asyncHandler(async (req, res) => {
  const existing = await Verification.findOne({ user: req.user._id });
  assertOrThrow(existing, 'Verification not found', 404);
  assertOrThrow(existing.status !== 'approved', 'Approved verification cannot be edited', 409);
  const payload = extractPayload(req);
  const documentFront = await saveVerificationDocument(req, req.files?.documentFront?.[0], 'document-front') || existing.documentFront;
  const documentBack = await saveVerificationDocument(req, req.files?.documentBack?.[0], 'document-back') || existing.documentBack;

  Object.assign(existing, payload, { documentFront, documentBack, status: 'pending', adminNote: '' });
  await existing.save();

  Object.assign(req.user, {
    fullName: payload.fullName,
    name: payload.fullName,
    phone: payload.phone,
    dateOfBirth: payload.dateOfBirth,
    address: payload.address,
    street: payload.street,
    city: payload.city,
    postCode: payload.postCode,
    verificationStatus: 'pending',
  });
  await req.user.save();

  res.json({ success: true, message: 'Verification updated', data: existing });
});
