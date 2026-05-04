import CryptoDeposit from '../models/CryptoDeposit.js';
import CryptoMethod from '../models/CryptoMethod.js';
import CryptoWithdrawal from '../models/CryptoWithdrawal.js';
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
import { getCryptoWithdrawOptions, createCryptoWithdrawalRequest } from '../services/cryptoWithdrawService.js';
import { requireNumber, requireString, optionalString } from '../utils/validation.js';

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


export const cryptoWithdrawOptions = asyncHandler(async (_req, res) => {
  const options = await getCryptoWithdrawOptions();
  res.json({ success: true, data: options, options });
});

export const createCryptoWithdrawal = asyncHandler(async (req, res) => {
  const methodKey = requireString(req.body.methodKey || req.body.key, 'Crypto method', 2, 40).toUpperCase();
  const amountFiat = requireNumber(req.body.amount || req.body.amountFiat, 'Amount', 1, 1_000_000);
  const toAddress = requireString(req.body.address || req.body.toAddress, 'Wallet address', 20, 160);
  const memo = optionalString(req.body.memo, 120) || '';

  const result = await createCryptoWithdrawalRequest({
    user: req.user,
    amountFiat,
    methodKey,
    toAddress,
    memo,
  });

  res.status(201).json({
    success: true,
    message: result.withdrawal.status === 'success'
      ? 'Crypto withdrawal sent successfully'
      : 'Crypto withdrawal request created',
    data: result,
  });
});

export const myCryptoWithdrawals = asyncHandler(async (req, res) => {
  const withdrawals = await CryptoWithdrawal.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: withdrawals, withdrawals });
});

export const adminListCryptoMethods = asyncHandler(async (_req, res) => {
  await syncDefaultCryptoMethods();
  const methods = await CryptoMethod.find().sort({ sortOrder: 1, displayName: 1 });
  res.json({ success: true, data: methods, methods });
});

export const adminUpdateCryptoMethod = asyncHandler(async (req, res) => {
  const key = String(req.params.key || '').trim().toUpperCase();
  assertOrThrow(key, 'Crypto method key is required', 400);

  const allowed = ['enabled', 'displayName', 'minDepositCrypto', 'minDepositFiat', 'withdrawEnabled', 'minWithdrawFiat', 'maxWithdrawFiat', 'withdrawWarning', 'confirmations', 'warning', 'logo', 'sortOrder'];
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

export const kmsApproveTransaction = asyncHandler(async (req, res) => {
  const kmsId = String(req.params.kmsId || req.params.id || req.query.id || '').trim();
  assertOrThrow(kmsId, 'KMS transaction ID is required', 400);

  const deposit = await CryptoDeposit.findOne({
    methodKey: 'BNB',
    sweepKmsId: kmsId,
  }).sort({ updatedAt: -1 });

  if (!deposit) {
    throw new AppError(`KMS transaction ${kmsId} was not found in sweep records`, 404);
  }

  if (deposit.sweepStatus !== 'requested') {
    throw new AppError(`KMS transaction ${kmsId} is not in requested status`, 403);
  }

  if (env.TATUM_BSC_SIGNATURE_ID && deposit.sweepSignatureId && deposit.sweepSignatureId !== env.TATUM_BSC_SIGNATURE_ID) {
    throw new AppError('KMS signature ID mismatch', 403);
  }

  await CryptoDeposit.updateOne(
    { _id: deposit._id },
    {
      $set: {
        sweepError: 'KMS approval granted. Waiting for KMS daemon to sign and broadcast.',
        sweepApprovedAt: new Date(),
      },
    }
  );

  // Tatum KMS only needs an HTTP 200 response from the external URL to approve signing.
  res.status(200).json({
    success: true,
    approved: true,
    kmsId,
    depositId: deposit._id,
  });
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
