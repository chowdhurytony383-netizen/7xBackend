import Verification from '../models/Verification.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { optionalString, requireEmail } from '../utils/validation.js';

function optionalDate(value) {
  const raw = optionalString(value, 40);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function extractPayload(req) {
  const emailInput = optionalString(req.body.email || req.user.email, 254) || req.user.email || '';

  return {
    // Document verification is disabled. These fields are only optional profile info.
    fullName: optionalString(req.body.fullName || req.body.name || req.user.fullName || req.user.name, 160) || '',
    email: emailInput ? requireEmail(emailInput) : '',
    phone: optionalString(req.body.phone, 40),
    dateOfBirth: optionalDate(req.body.dateOfBirth),
    address: optionalString(req.body.address, 300),
    street: optionalString(req.body.street, 180),
    city: optionalString(req.body.city, 120),
    postCode: optionalString(req.body.postCode, 40),
    documentType: 'NONE',
    documentNumber: '',
    documentFront: '',
    documentBack: '',
  };
}

export const getMyVerification = asyncHandler(async (req, res) => {
  const verification = await Verification.findOne({ user: req.user._id });
  res.json({
    success: true,
    verificationRequired: false,
    documentUploadRequired: false,
    data: verification || null,
    verification,
  });
});

export const submitVerification = asyncHandler(async (req, res) => {
  const payload = extractPayload(req);

  const verification = await Verification.findOneAndUpdate(
    { user: req.user._id },
    {
      ...payload,
      user: req.user._id,
      status: 'not_required',
      adminNote: 'Document verification disabled by platform settings.',
    },
    { upsert: true, new: true, runValidators: true }
  );

  Object.assign(req.user, {
    fullName: payload.fullName || req.user.fullName,
    name: payload.fullName || req.user.name,
    phone: payload.phone ?? req.user.phone,
    ...(payload.dateOfBirth ? { dateOfBirth: payload.dateOfBirth } : {}),
    address: payload.address ?? req.user.address,
    street: payload.street ?? req.user.street,
    city: payload.city ?? req.user.city,
    postCode: payload.postCode ?? req.user.postCode,
    verificationStatus: 'not_required',
  });

  if (payload.email && payload.email !== req.user.email) {
    req.user.email = payload.email;
    req.user.isVerified = false;
  }

  await req.user.save();

  res.status(200).json({
    success: true,
    message: 'Profile information saved. Document verification is not required for withdrawal, deposit, or bonus.',
    verificationRequired: false,
    documentUploadRequired: false,
    data: verification,
  });
});

export const updateVerification = submitVerification;
