import CryptoDeposit from '../models/CryptoDeposit.js';
import UserCryptoAddress from '../models/UserCryptoAddress.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';
import { tatumRequest } from './tatumService.js';

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function toFixedAmount(value, decimals = 8) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0';
  const factor = 10 ** decimals;
  const floored = Math.floor(number * factor) / factor;
  return floored.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

function txHashFromPayload(payload) {
  return String(
    payload?.txId
    || payload?.txHash
    || payload?.hash
    || payload?.transactionHash
    || payload?.id
    || payload?.data?.txId
    || payload?.data?.txHash
    || ''
  ).trim();
}

export function isDirectSweepAllowed() {
  return env.CRYPTO_SWEEP_ENABLED && String(env.CRYPTO_SWEEP_MODE || '').toLowerCase() === 'direct_test';
}

export async function getBscPrivateKeyForAddress(addressDoc) {
  if (!env.TATUM_BSC_MNEMONIC) {
    throw new AppError('TATUM_BSC_MNEMONIC is not configured. Direct BNB sweep cannot sign the transaction.', 503);
  }

  const index = Number(addressDoc?.derivationIndex);
  if (!Number.isInteger(index) || index < 0) {
    throw new AppError('BNB deposit address derivationIndex is missing or invalid.', 400);
  }

  const payload = await tatumRequest('bsc/wallet/priv', {
    method: 'POST',
    body: {
      mnemonic: env.TATUM_BSC_MNEMONIC,
      index,
    },
  });

  const rawKey = String(
    payload?.key
    || payload?.privateKey
    || payload?.data?.key
    || payload?.data?.privateKey
    || payload?.result?.key
    || payload?.result?.privateKey
    || ''
  ).trim();

  if (!rawKey) throw new AppError('Tatum did not return a BSC private key for this derivation index.', 502);

  const key = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new AppError(`Generated BSC private key format is invalid. length=${key.length}`, 502);
  }

  return key;
}

async function sendBnbToCompanyWallet({ fromPrivateKey, amount }) {
  if (!env.COMPANY_BSC_ADDRESS) throw new AppError('COMPANY_BSC_ADDRESS is not configured.', 503);

  const gasLimit = String(env.CRYPTO_SWEEP_BNB_GAS_LIMIT || '30000').trim();
  const gasPrice = String(env.CRYPTO_SWEEP_BNB_GAS_PRICE || '').trim();

  const body = {
    to: env.COMPANY_BSC_ADDRESS,
    currency: 'BSC',
    amount: String(amount),
    fromPrivateKey,
    gasLimit,
  };

  // Optional: only set gasPrice when you explicitly configure it. If empty,
  // Tatum will use its own gas price calculation.
  if (gasPrice) body.gasPrice = gasPrice;

  return tatumRequest('bsc/transaction', {
    method: 'POST',
    body,
  });
}

export async function sweepOneBnbDeposit(deposit, { dryRun = env.CRYPTO_SWEEP_DRY_RUN } = {}) {
  if (!deposit) throw new AppError('Crypto deposit is required.', 400);
  if (deposit.methodKey !== 'BNB') throw new AppError('Only BNB sweep is supported by this test package.', 400);
  if (deposit.status !== 'credited') throw new AppError('Only credited crypto deposits can be swept.', 400);
  if (deposit.sweepStatus === 'swept' && deposit.sweepTxHash) return { status: 'already_swept', deposit };

  const addressDoc = await UserCryptoAddress.findOne({
    methodKey: 'BNB',
    addressLower: lower(deposit.address),
    status: 'active',
  });

  if (!addressDoc) throw new AppError('Matching active BNB user crypto address was not found.', 404);

  const amountCrypto = Number(deposit.amountCrypto || 0);
  const reserve = Number(env.CRYPTO_SWEEP_BNB_GAS_RESERVE || 0.00025);
  const minAmount = Number(env.CRYPTO_SWEEP_MIN_BNB || 0.0002);
  const sweepAmount = amountCrypto - reserve;

  if (!Number.isFinite(sweepAmount) || sweepAmount < minAmount) {
    const message = `BNB amount is too small to sweep safely. amount=${amountCrypto}, reserve=${reserve}, min=${minAmount}`;
    await CryptoDeposit.updateOne(
      { _id: deposit._id },
      { $set: { sweepStatus: 'skipped', sweepError: message, sweepMode: env.CRYPTO_SWEEP_MODE || 'manual' } }
    );
    return { status: 'skipped', reason: message, deposit };
  }

  const amountString = toFixedAmount(sweepAmount, 8);

  if (dryRun) {
    return {
      status: 'dry_run',
      deposit,
      from: deposit.address,
      to: env.COMPANY_BSC_ADDRESS,
      amountCrypto,
      reserve,
      sweepAmount: Number(amountString),
      derivationIndex: addressDoc.derivationIndex,
    };
  }

  if (!isDirectSweepAllowed()) {
    throw new AppError('Direct sweep is disabled. Set CRYPTO_SWEEP_ENABLED=true and CRYPTO_SWEEP_MODE=direct_test to run this test sweep.', 403);
  }

  await CryptoDeposit.updateOne(
    { _id: deposit._id },
    {
      $set: {
        sweepStatus: 'requested',
        sweepRequestedAt: new Date(),
        sweepMode: env.CRYPTO_SWEEP_MODE,
        sweepTargetAddress: env.COMPANY_BSC_ADDRESS,
        sweepAmountCrypto: Number(amountString),
        sweepError: '',
      },
    }
  );

  try {
    const privateKey = await getBscPrivateKeyForAddress(addressDoc);
    const payload = await sendBnbToCompanyWallet({ fromPrivateKey: privateKey, amount: amountString });
    const txHash = txHashFromPayload(payload);

    const updated = await CryptoDeposit.findByIdAndUpdate(
      deposit._id,
      {
        $set: {
          sweepStatus: txHash ? 'swept' : 'requested',
          sweepTxHash: txHash,
          sweepTargetAddress: env.COMPANY_BSC_ADDRESS,
          sweepAmountCrypto: Number(amountString),
          sweepMode: env.CRYPTO_SWEEP_MODE,
          sweepError: txHash ? '' : 'Tatum transfer response did not include tx hash yet.',
          sweptAt: txHash ? new Date() : undefined,
        },
      },
      { new: true }
    );

    return { status: txHash ? 'swept' : 'requested', txHash, payload, deposit: updated };
  } catch (error) {
    const payloadText = error?.payload ? ` | Tatum payload: ${JSON.stringify(error.payload)}` : '';
    const errorMessage = `${error.message || 'BNB sweep failed'}${payloadText}`;
    await CryptoDeposit.updateOne(
      { _id: deposit._id },
      { $set: { sweepStatus: 'failed', sweepError: errorMessage, sweepMode: env.CRYPTO_SWEEP_MODE } }
    );
    error.message = errorMessage;
    throw error;
  }
}

export async function sweepPendingBnbDeposits({ limit = 5, dryRun = env.CRYPTO_SWEEP_DRY_RUN } = {}) {
  const deposits = await CryptoDeposit.find({
    methodKey: 'BNB',
    status: 'credited',
    $or: [
      { sweepStatus: { $exists: false } },
      { sweepStatus: '' },
      { sweepStatus: 'pending' },
      { sweepStatus: 'failed' },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(Number(limit) || 5);

  const results = [];
  for (const deposit of deposits) {
    try {
      const result = await sweepOneBnbDeposit(deposit, { dryRun });
      results.push({ ok: true, depositId: deposit._id.toString(), txHash: deposit.txHash, ...result });
    } catch (error) {
      results.push({ ok: false, depositId: deposit._id.toString(), txHash: deposit.txHash, error: error.message });
    }
  }

  return results;
}
