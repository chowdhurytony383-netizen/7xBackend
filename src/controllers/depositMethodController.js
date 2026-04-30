import DepositMethod from '../models/DepositMethod.js';
import { dedupeDepositMethodsByTitle, findDuplicateDepositMethod } from '../utils/paymentMethodCanonical.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/appError.js';
import { optionalString, requireNumber, requireString } from '../utils/validation.js';

export const defaultDepositMethods = [
  { key: 'bkash', title: 'bKash', category: 'recommended', minAmount: 100, maxAmount: 25000, displayOrder: 10, isActive: true },
  { key: 'fast-bkash', title: 'Fast Bkash', category: 'recommended', minAmount: 100, maxAmount: 25000, displayOrder: 20, isActive: true },
  { key: 'nagad', title: 'Nagad', category: 'recommended', minAmount: 100, maxAmount: 25000, displayOrder: 30, isActive: true },
  { key: 'fast-nagad', title: 'Fast Nagad', category: 'recommended', minAmount: 100, maxAmount: 25000, displayOrder: 40, isActive: true },
  { key: 'rocket', title: 'Rocket', category: 'e-wallets', minAmount: 100, maxAmount: 25000, displayOrder: 50, isActive: true },
  { key: 'upay', title: 'Upay', category: 'e-wallets', minAmount: 100, maxAmount: 25000, displayOrder: 60, isActive: true },
];

const allowedCategories = new Set(['recommended', 'e-wallets', 'bank', 'crypto', 'other']);

export async function ensureDefaultDepositMethods() {
  const count = await DepositMethod.countDocuments();
  if (count > 0) return;
  await DepositMethod.insertMany(defaultDepositMethods, { ordered: false });
}

function makeUploadUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/deposit-methods/${filename}`;
}

function sanitizeMethodKey(value) {
  return requireString(value, 'Method key', 2, 50)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

function payloadFromRequest(req, existing = {}) {
  const key = existing.key || sanitizeMethodKey(req.body.key);
  const title = requireString(req.body.title, 'Method title', 2, 80);
  const category = optionalString(req.body.category, 30) || 'e-wallets';

  if (!allowedCategories.has(category)) {
    throw new AppError('Invalid payment method category', 400);
  }

  const minAmount = req.body.minAmount === undefined || req.body.minAmount === ''
    ? (existing.minAmount || 100)
    : requireNumber(req.body.minAmount, 'Minimum amount', 1, 1_000_000);

  const maxAmount = req.body.maxAmount === undefined || req.body.maxAmount === ''
    ? (existing.maxAmount || 25000)
    : requireNumber(req.body.maxAmount, 'Maximum amount', minAmount, 1_000_000);

  return {
    key,
    title,
    category,
    minAmount,
    maxAmount,
    displayOrder: req.body.displayOrder === undefined || req.body.displayOrder === ''
      ? (existing.displayOrder || 100)
      : Number(req.body.displayOrder),
    isActive: req.body.isActive === true || String(req.body.isActive) === 'true',
  };
}

export const listDepositMethods = asyncHandler(async (_req, res) => {
  await ensureDefaultDepositMethods();
  const methods = await DepositMethod.find().sort({ displayOrder: 1, createdAt: 1 });
  const uniqueMethods = dedupeDepositMethodsByTitle(methods);
  res.json({ success: true, data: uniqueMethods, methods: uniqueMethods });
});

export const createDepositMethod = asyncHandler(async (req, res) => {
  const payload = payloadFromRequest(req);
  const existingMethods = await DepositMethod.find().sort({ displayOrder: 1, createdAt: 1 });
  const duplicate = findDuplicateDepositMethod(existingMethods, payload);

  if (duplicate) {
    throw new AppError(`Payment method already exists as ${duplicate.title}. Update the existing method instead of creating another ${payload.title}.`, 409);
  }

  if (req.file) {
    payload.image = makeUploadUrl(req, req.file.filename);
  }

  const method = await DepositMethod.create(payload);
  res.status(201).json({
    success: true,
    message: 'Deposit method created',
    data: method,
  });
});

export const updateDepositMethod = asyncHandler(async (req, res) => {
  await ensureDefaultDepositMethods();
  const methodKey = String(req.params.methodKey || '').toLowerCase();
  const method = await DepositMethod.findOne({ key: methodKey });
  if (!method) throw new AppError('Deposit method not found', 404);

  const payload = payloadFromRequest(req, method);
  delete payload.key;

  const existingMethods = await DepositMethod.find().sort({ displayOrder: 1, createdAt: 1 });
  const duplicate = findDuplicateDepositMethod(existingMethods, payload, method.key);

  if (duplicate) {
    throw new AppError(`Another payment method already uses the name ${duplicate.title}. Keep each payment method name unique.`, 409);
  }

  Object.assign(method, payload);
  if (req.file) {
    method.image = makeUploadUrl(req, req.file.filename);
  }

  await method.save();

  res.json({
    success: true,
    message: 'Deposit method updated',
    data: method,
  });
});

export const deleteDepositMethod = asyncHandler(async (req, res) => {
  const methodKey = String(req.params.methodKey || '').toLowerCase();
  const method = await DepositMethod.findOne({ key: methodKey });
  if (!method) throw new AppError('Deposit method not found', 404);

  method.isActive = false;
  await method.save();

  res.json({
    success: true,
    message: 'Deposit method disabled',
    data: method,
  });
});
