import CryptoDeposit from '../models/CryptoDeposit.js';
import CryptoMethod from '../models/CryptoMethod.js';
import UserCryptoAddress from '../models/UserCryptoAddress.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import {
  ensureUserCryptoAddresses,
  getActiveCryptoMethods,
  syncDefaultCryptoMethods,
  toCryptoAddressDto,
} from '../services/cryptoAddressService.js';
import { processCryptoWebhookPayload } from '../services/cryptoWebhookService.js';
import { syncTatumSubscriptions } from '../services/cryptoSubscriptionService.js';

export const myCryptoAddresses = asyncHandler(async (req, res) => {
  const items = await ensureUserCryptoAddresses(req.user);
  const data = items.map(toCryptoAddressDto);
  res.json({ success: true, data, addresses: data });
});

export const refreshMyCryptoAddresses = asyncHandler(async (req, res) => {
  await UserCryptoAddress.deleteMany({ user: req.user._id, status: { $ne: 'active' } });
  const items = await ensureUserCryptoAddresses(req.user);
  const data = items.map(toCryptoAddressDto);
  res.json({ success: true, message: 'Crypto addresses refreshed', data, addresses: data });
});

export const myCryptoDeposits = asyncHandler(async (req, res) => {
  const deposits = await CryptoDeposit.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: deposits, deposits });
});

export const adminListCryptoMethods = asyncHandler(async (_req, res) => {
  await syncDefaultCryptoMethods();
  const methods = await CryptoMethod.find().sort({ sortOrder: 1, displayName: 1 });
  res.json({ success: true, data: methods, methods });
});

export const adminUpdateCryptoMethod = asyncHandler(async (req, res) => {
  const key = String(req.params.key || '').trim().toUpperCase();
  assertOrThrow(key, 'Crypto method key is required', 400);

  const allowed = ['enabled', 'displayName', 'minDepositCrypto', 'minDepositFiat', 'confirmations', 'warning', 'logo', 'sortOrder'];
  const update = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) update[field] = req.body[field];
  }

  const method = await CryptoMethod.findOneAndUpdate({ key }, { $set: update }, { new: true });
  assertOrThrow(method, 'Crypto method not found', 404);
  res.json({ success: true, message: 'Crypto method updated', data: method });
});

export const adminSyncCryptoSubscriptions = asyncHandler(async (req, res) => {
  const force = String(req.query.force || req.body.force || '').toLowerCase() === 'true';
  const limit = Number(req.query.limit || req.body.limit || 1000);
  const result = await syncTatumSubscriptions({ force, limit });
  res.json({ success: true, message: 'Crypto subscriptions synced', data: result });
});

export const tatumWebhook = asyncHandler(async (req, res) => {
  if (env.CRYPTO_WEBHOOK_SECRET) {
    const provided = req.headers['x-webhook-secret']
      || req.headers['x-crypto-webhook-secret']
      || req.headers['x-tatum-secret']
      || req.query.secret;

    if (provided !== env.CRYPTO_WEBHOOK_SECRET) throw new AppError('Invalid crypto webhook secret', 401);
  }

  const result = await processCryptoWebhookPayload(req.body || {});
  res.json({ success: true, ...result });
});
