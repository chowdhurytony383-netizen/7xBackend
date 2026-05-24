import Verification from '../models/Verification.js';
import { getWithdrawalProfileStatus } from '../services/withdrawalGuardService.js';
import { markFirstDepositBonusProfileCompleteIfReady } from '../services/firstDepositBonusService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { optionalString, requireEmail } from '../utils/validation.js';

function optionalDate(value) {
  const raw = optionalString(value, 40);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const DOCUMENT_TYPES = new Set(['NID', 'Driving', 'Passport', 'DRIVING_LICENSE', 'nid', 'driving', 'passport']);

function normalizeDocumentType(value) {
  const raw = optionalString(value, 40);
  if (!raw || String(raw).toUpperCase() === 'NONE') return 'NONE';
  if (raw === 'Driving Licence' || raw === 'Driving License') return 'Driving';
  if (String(raw).toUpperCase() === 'DRIVING_LICENSE') return 'Driving';
  return DOCUMENT_TYPES.has(raw) ? raw : 'NONE';
}


function extractPayload(req) {
  const emailInput = optionalString(req.body.email || req.user.email, 254) || req.user.email || '';
  const documentType = normalizeDocumentType(req.body.documentType);

  return {
    // Full name and address are used for withdrawal profile checks.
    // Document type/number are stored as optional KYC profile information.
    fullName: optionalString(req.body.fullName || req.body.name || req.user.fullName || req.user.name, 160) || '',
    email: emailInput ? requireEmail(emailInput) : '',
    phone: optionalString(req.body.phone, 40),
    dateOfBirth: optionalDate(req.body.dateOfBirth),
    address: optionalString(req.body.address, 300),
    street: optionalString(req.body.street, 180),
    city: optionalString(req.body.city, 120),
    postCode: optionalString(req.body.postCode, 40),
    documentType,
    documentNumber: documentType === 'NONE' ? '' : optionalString(req.body.documentNumber, 80),
    documentFront: '',
    documentBack: '',
  };
}

export const getMyVerification = asyncHandler(async (req, res) => {
  const [verification, profileStatus] = await Promise.all([
    Verification.findOne({ user: req.user._id }),
    getWithdrawalProfileStatus(req.user),
  ]);

  res.json({
    success: true,
    verificationRequired: profileStatus.verificationRequired,
    documentUploadRequired: false,
    withdrawalProfileRequired: profileStatus.verificationRequired,
    withdrawalProfileComplete: profileStatus.ok,
    missing: profileStatus.missing,
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
      adminNote: 'Document image upload is disabled by platform settings.',
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
  await markFirstDepositBonusProfileCompleteIfReady(req.user).catch((error) => {
    console.error('First deposit bonus profile marker failed:', error.message);
  });

  const profileStatus = await getWithdrawalProfileStatus(req.user);

  res.status(200).json({
    success: true,
    message: 'Profile information saved. Full Name and Address are required before withdrawal when WITHDRAW_KYC_REQUIRED=true. Document Type and Document Number are saved as KYC profile information.',
    verificationRequired: profileStatus.verificationRequired,
    documentUploadRequired: false,
    withdrawalProfileRequired: profileStatus.verificationRequired,
    withdrawalProfileComplete: profileStatus.ok,
    missing: profileStatus.missing,
    data: verification,
  });
});

export const updateVerification = submitVerification;
