import CryptoDeposit from '../models/CryptoDeposit.js';
import CryptoMethod from '../models/CryptoMethod.js';
import Transaction from '../models/Transaction.js';
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

export const myCryptoAddresses = asyncHandler(async (req, res) => {
  const items = await ensureUserCryptoAddresses(req.user);
  const data = items.map(toCryptoAddressDto);

  res.json({
    success: true,
    data,
    addresses: data,
  });
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

export const tatumWebhook = asyncHandler(async (req, res) => {
  if (env.CRYPTO_WEBHOOK_SECRET) {
    const provided = req.headers['x-webhook-secret'] || req.headers['x-crypto-webhook-secret'] || req.query.secret;
    if (provided !== env.CRYPTO_WEBHOOK_SECRET) throw new AppError('Invalid crypto webhook secret', 401);
  }

  const payload = req.body || {};
  const address = payload.address || payload.to || payload.destination || payload.accountingCurrencyAddress;
  const txHash = payload.txHash || payload.hash || payload.txId || payload.txID || payload.transactionHash;
  const amountCrypto = Number(payload.amount || payload.value || payload.amountCrypto || 0);
  const confirmations = Number(payload.confirmations || payload.blockConfirmations || 0);
  const creditAmount = Number(payload.amountFiat || payload.creditAmount || payload.creditFiatAmount || 0);

  assertOrThrow(address, 'Webhook address is required', 400);
  assertOrThrow(txHash, 'Webhook transaction hash is required', 400);

  const userAddress = await UserCryptoAddress.findOne({ address }).populate('user');
  if (!userAddress) return res.json({ success: true, ignored: true, message: 'Address not found' });

  const method = await CryptoMethod.findOne({ key: userAddress.methodKey });
  const requiredConfirmations = method?.confirmations || 1;
  const isConfirmed = confirmations >= requiredConfirmations;

  let deposit = await CryptoDeposit.findOne({ txHash, methodKey: userAddress.methodKey });
  if (!deposit) {
    deposit = await CryptoDeposit.create({
      user: userAddress.user._id,
      userId: userAddress.userId,
      methodKey: userAddress.methodKey,
      coin: userAddress.coin,
      network: userAddress.network,
      address,
      txHash,
      amountCrypto,
      amountFiat: creditAmount,
      fiatCurrency: userAddress.user.currency || 'BDT',
      confirmations,
      requiredConfirmations,
      status: isConfirmed ? 'confirming' : 'detected',
      rawPayload: payload,
    });
  } else {
    deposit.confirmations = Math.max(deposit.confirmations || 0, confirmations);
    deposit.rawPayload = payload;
    if (amountCrypto) deposit.amountCrypto = amountCrypto;
    if (creditAmount) deposit.amountFiat = creditAmount;
    if (deposit.status === 'detected' && isConfirmed) deposit.status = 'confirming';
    await deposit.save();
  }

  // Safe auto-credit only when the webhook payload contains a fiat credit amount.
  // If your webhook only sends crypto amount, add an exchange-rate service first.
  if (isConfirmed && creditAmount > 0 && deposit.status !== 'credited') {
    userAddress.user.wallet = Number(userAddress.user.wallet || 0) + creditAmount;
    await userAddress.user.save();

    const tx = await Transaction.create({
      user: userAddress.user._id,
      type: 'DEPOSIT',
      amount: creditAmount,
      status: 'SUCCESS',
      method: `CRYPTO_${userAddress.methodKey}`,
      methodKey: userAddress.methodKey,
      gatewayPayload: payload,
      processedAt: new Date(),
      userNote: `Crypto deposit ${userAddress.coin} ${amountCrypto || ''} / ${txHash}`,
    });

    deposit.status = 'credited';
    deposit.creditedAt = new Date();
    deposit.creditedTransaction = tx._id;
    await deposit.save();
  }

  res.json({ success: true, data: deposit });
});
