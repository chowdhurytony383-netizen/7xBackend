import CryptoDeposit from '../models/CryptoDeposit.js';
import { env } from '../config/env.js';
import { sweepOneBnbDeposit, sweepPendingBnbDeposits } from './cryptoSweepService.js';

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function enabledCoins() {
  return String(env.CRYPTO_AUTO_SWEEP_COINS || process.env.CRYPTO_AUTO_SWEEP_COINS || 'BNB')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function isAutoSweepOnCreditEnabled() {
  return bool(process.env.CRYPTO_AUTO_SWEEP_ON_CREDIT, env.CRYPTO_AUTO_SWEEP_ON_CREDIT || false);
}

export async function maybeAutoSweepAfterCredit(deposit) {
  if (!deposit) return { status: 'skipped', reason: 'deposit missing' };

  const methodKey = String(deposit.methodKey || '').toUpperCase();
  if (!isAutoSweepOnCreditEnabled()) return { status: 'skipped', reason: 'CRYPTO_AUTO_SWEEP_ON_CREDIT is false' };
  if (!enabledCoins().includes(methodKey)) return { status: 'skipped', reason: `${methodKey} auto sweep is not enabled` };
  if (!env.CRYPTO_SWEEP_ENABLED) return { status: 'skipped', reason: 'CRYPTO_SWEEP_ENABLED is false' };
  if (env.CRYPTO_SWEEP_DRY_RUN) return { status: 'skipped', reason: 'CRYPTO_SWEEP_DRY_RUN is true' };
  if (String(env.CRYPTO_SWEEP_MODE || '').toLowerCase() !== 'kms') return { status: 'skipped', reason: 'CRYPTO_SWEEP_MODE is not kms' };

  if (methodKey !== 'BNB') {
    return { status: 'skipped', reason: 'Only BNB auto sweep trigger is supported in this package' };
  }

  const freshDeposit = await CryptoDeposit.findById(deposit._id);
  if (!freshDeposit) return { status: 'skipped', reason: 'deposit not found' };
  if (freshDeposit.status !== 'credited') return { status: 'skipped', reason: `deposit status is ${freshDeposit.status}` };
  if (['requested', 'swept'].includes(String(freshDeposit.sweepStatus || '').toLowerCase())) {
    return { status: 'skipped', reason: `sweep already ${freshDeposit.sweepStatus}`, kmsId: freshDeposit.sweepKmsId || '', txHash: freshDeposit.sweepTxHash || '' };
  }

  const result = await sweepOneBnbDeposit(freshDeposit, { dryRun: false });
  return {
    status: result.status,
    kmsId: result.kmsId || '',
    txHash: result.txHash || '',
    message: result.status === 'requested' ? 'KMS sweep request created automatically. Waiting for KMS daemon.' : '',
  };
}

export async function triggerAutoSweepForPendingDeposits({ limit = 5 } = {}) {
  if (!isAutoSweepOnCreditEnabled()) return [];
  if (!enabledCoins().includes('BNB')) return [];
  return sweepPendingBnbDeposits({ limit, dryRun: false });
}
