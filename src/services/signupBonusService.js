import Transaction from '../models/Transaction.js';
import TurnoverRequirement from '../models/TurnoverRequirement.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { creditWallet, debitWallet } from '../utils/wallet.js';

export const SIGNUP_BONUS_CODE = 'SIGNUP_100_EQUIVALENT';
export const SIGNUP_BONUS_SOURCE = 'signup-bonus';
const BASE_CURRENCY = 'BDT';
const DEFAULT_BASE_AMOUNT_BDT = 100;
const DEFAULT_TURNOVER_MULTIPLIER = 2;

const fallbackBdtRates = {
  BDT: 1,
  USD: 0.0082,
  EUR: 0.0076,
  GBP: 0.0065,
  INR: 0.68,
  PKR: 2.28,
  NPR: 1.09,
  LKR: 2.45,
  AED: 0.030,
  SAR: 0.031,
  QAR: 0.030,
  KWD: 0.0025,
  MYR: 0.039,
  SGD: 0.011,
  PHP: 0.46,
  IDR: 134,
  THB: 0.30,
  VND: 209,
  NGN: 13.2,
  GHS: 0.12,
  KES: 1.07,
  ZAR: 0.15,
  XAF: 5.0,
  XOF: 5.0,
  CAD: 0.011,
  AUD: 0.013,
  NZD: 0.014,
  JPY: 1.28,
  CNY: 0.059,
  TRY: 0.27,
};

let rateCache = null;
let directAmountCache = null;
let liveRateCache = null;

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function cleanCurrency(value) {
  const currency = String(value || BASE_CURRENCY).trim().toUpperCase();
  return /^[A-Z]{3,5}$/.test(currency) ? currency : BASE_CURRENCY;
}

function boolEnv(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function parseJsonMap(value, fallback = {}) {
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;

    return Object.entries(parsed).reduce((acc, [key, rawValue]) => {
      const currency = cleanCurrency(key);
      const number = Number(rawValue);
      if (Number.isFinite(number) && number > 0) acc[currency] = number;
      return acc;
    }, {});
  } catch (error) {
    console.error('Invalid signup bonus currency JSON:', error.message);
    return fallback;
  }
}

function configuredRates() {
  if (!rateCache) rateCache = parseJsonMap(env.SIGNUP_BONUS_BDT_RATES_JSON, {});
  return rateCache;
}

function configuredDirectAmounts() {
  if (!directAmountCache) directAmountCache = parseJsonMap(env.SIGNUP_BONUS_AMOUNT_BY_CURRENCY_JSON, {});
  return directAmountCache;
}

async function fetchLiveBdtRates() {
  const apiUrl = String(env.SIGNUP_BONUS_EXCHANGE_API_URL || '').trim();
  if (!apiUrl || !boolEnv(env.SIGNUP_BONUS_USE_LIVE_RATES, true)) return null;

  const now = Date.now();
  const cacheMs = Number(env.SIGNUP_BONUS_RATE_CACHE_MS || 6 * 60 * 60 * 1000);
  if (liveRateCache && now - liveRateCache.time < cacheMs) return liveRateCache.rates;

  try {
    const response = await fetch(apiUrl, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const rawRates = payload?.rates || payload?.conversion_rates || payload?.data?.rates || null;
    if (!rawRates || typeof rawRates !== 'object') throw new Error('Missing rates object');

    const rates = Object.entries(rawRates).reduce((acc, [keyName, rawValue]) => {
      const currency = cleanCurrency(keyName);
      const number = Number(rawValue);
      if (Number.isFinite(number) && number > 0) acc[currency] = number;
      return acc;
    }, {});

    if (!rates.BDT) rates.BDT = 1;
    liveRateCache = { rates, time: now };
    return rates;
  } catch (error) {
    console.error('Signup bonus live exchange-rate fetch failed:', error.message);
    return null;
  }
}

async function getBdtToCurrencyRate(currency) {
  const targetCurrency = cleanCurrency(currency);
  if (targetCurrency === BASE_CURRENCY) return 1;

  const envRate = configuredRates()[targetCurrency];
  if (envRate) return envRate;

  const liveRates = await fetchLiveBdtRates();
  if (liveRates?.[targetCurrency]) return liveRates[targetCurrency];

  return fallbackBdtRates[targetCurrency] || 1;
}

export function getSignupBonusTurnoverMultiplier() {
  const number = Number(env.SIGNUP_BONUS_TURNOVER_MULTIPLIER ?? env.WITHDRAW_BONUS_TURNOVER_MULTIPLIER ?? DEFAULT_TURNOVER_MULTIPLIER);
  return Number.isFinite(number) && number > 0 ? number : DEFAULT_TURNOVER_MULTIPLIER;
}

export async function getSignupBonusValue(user = {}) {
  const currency = cleanCurrency(user.currency || BASE_CURRENCY);
  const directAmount = configuredDirectAmounts()[currency];
  const baseAmountRaw = Number(env.SIGNUP_BONUS_BASE_AMOUNT_BDT || DEFAULT_BASE_AMOUNT_BDT);
  const baseAmount = Number.isFinite(baseAmountRaw) && baseAmountRaw > 0 ? baseAmountRaw : DEFAULT_BASE_AMOUNT_BDT;

  if (directAmount) {
    return {
      amount: money(directAmount),
      currency,
      baseCurrency: BASE_CURRENCY,
      baseAmount,
      rate: null,
      rateSource: 'env-direct-amount',
      turnoverMultiplier: getSignupBonusTurnoverMultiplier(),
      requiredTurnover: money(directAmount * getSignupBonusTurnoverMultiplier()),
    };
  }

  const rate = await getBdtToCurrencyRate(currency);
  const amount = money(baseAmount * rate);

  return {
    amount,
    currency,
    baseCurrency: BASE_CURRENCY,
    baseAmount,
    rate,
    rateSource: configuredRates()[currency] ? 'env-rate' : (fallbackBdtRates[currency] ? 'live-or-fallback-rate' : 'fallback-bdt-rate'),
    turnoverMultiplier: getSignupBonusTurnoverMultiplier(),
    requiredTurnover: money(amount * getSignupBonusTurnoverMultiplier()),
  };
}

export async function awardSignupBonusForUser(userOrId) {
  if (!boolEnv(env.SIGNUP_BONUS_ENABLED, true)) {
    return { awarded: false, reason: 'signup_bonus_disabled' };
  }

  const user = userOrId?._id ? userOrId : await User.findById(userOrId);
  if (!user) return { awarded: false, reason: 'user_not_found' };

  const existingBonus = await Transaction.findOne({
    user: user._id,
    type: 'BONUS',
    'gatewayPayload.bonusCode': SIGNUP_BONUS_CODE,
    status: { $in: ['SUCCESS', 'CANCELLED', 'REJECTED'] },
  }).select('_id amount currency status');

  if (existingBonus || user.signupBonusAwarded === true) {
    return { awarded: false, reason: 'already_awarded', bonusTransaction: existingBonus || null };
  }

  const bonus = await getSignupBonusValue(user);
  if (bonus.amount <= 0) return { awarded: false, reason: 'empty_bonus_amount' };

  const claimedUser = await User.findOneAndUpdate(
    { _id: user._id, signupBonusAwarded: { $ne: true } },
    {
      $set: {
        signupBonusAwarded: true,
        signupBonusAwardedAt: new Date(),
        signupBonusAmount: bonus.amount,
        signupBonusCurrency: bonus.currency,
      },
    },
    { new: true }
  );

  if (!claimedUser) return { awarded: false, reason: 'already_claimed_by_user_flag' };

  let bonusTransaction;

  try {
    bonusTransaction = await Transaction.create({
      user: user._id,
      type: 'BONUS',
      amount: bonus.amount,
      status: 'SUCCESS',
      method: 'signup-bonus',
      methodKey: 'signup-bonus',
      currency: bonus.currency,
      balanceType: 'BONUS',
      processedAt: new Date(),
      userNote: `New account bonus credited. Required wagering before withdrawal: ${bonus.requiredTurnover} ${bonus.currency}.`,
      gatewayPayload: {
        source: SIGNUP_BONUS_SOURCE,
        bonusCode: SIGNUP_BONUS_CODE,
        bonusBalance: true,
        baseCurrency: bonus.baseCurrency,
        baseAmount: bonus.baseAmount,
        bonusAmount: bonus.amount,
        currency: bonus.currency,
        rate: bonus.rate,
        rateSource: bonus.rateSource,
        turnoverMultiplier: bonus.turnoverMultiplier,
        requiredTurnover: bonus.requiredTurnover,
        autoCreditedAtRegistration: true,
      },
    });

    const updatedUser = await creditWallet(user._id, bonus.amount, SIGNUP_BONUS_SOURCE, {
      turnoverSourceRef: bonusTransaction._id,
      turnoverMeta: {
        bonusCode: SIGNUP_BONUS_CODE,
        baseCurrency: bonus.baseCurrency,
        baseAmount: bonus.baseAmount,
        currency: bonus.currency,
        turnoverMultiplier: bonus.turnoverMultiplier,
        requiredTurnover: bonus.requiredTurnover,
      },
    });

    await User.updateOne(
      { _id: user._id },
      { $set: { signupBonusSourceTransaction: bonusTransaction._id } }
    );

    return {
      awarded: true,
      amount: bonus.amount,
      currency: bonus.currency,
      requiredTurnover: bonus.requiredTurnover,
      turnoverMultiplier: bonus.turnoverMultiplier,
      bonusTransaction,
      user: updatedUser,
    };
  } catch (error) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          signupBonusAwarded: false,
          signupBonusAmount: 0,
          signupBonusCurrency: '',
        },
        $unset: {
          signupBonusAwardedAt: '',
          signupBonusSourceTransaction: '',
        },
      }
    ).catch(() => null);

    if (bonusTransaction?._id) {
      await Transaction.findByIdAndUpdate(bonusTransaction._id, {
        status: 'FAILED',
        adminNote: `Signup bonus wallet credit failed: ${error.message}`,
      }).catch(() => null);
    }

    console.error('Signup bonus award failed:', error.message);
    return { awarded: false, reason: 'award_failed', error: error.message };
  }
}

export async function safelyAwardSignupBonus(userOrId) {
  try {
    return await awardSignupBonusForUser(userOrId);
  } catch (error) {
    console.error('Signup bonus check failed:', error.message);
    return { awarded: false, reason: 'unexpected_error', error: error.message };
  }
}

export async function getSignupBonusSummary(userId) {
  const bonusTransaction = await Transaction.findOne({
    user: userId,
    type: 'BONUS',
    'gatewayPayload.bonusCode': SIGNUP_BONUS_CODE,
  }).sort({ createdAt: -1 });

  const requirementFilter = bonusTransaction?._id
    ? {
      user: userId,
      type: 'bonus',
      status: 'open',
      remaining: { $gt: 0 },
      $or: [
        { sourceRef: bonusTransaction._id },
        { 'meta.bonusCode': SIGNUP_BONUS_CODE },
        { source: SIGNUP_BONUS_SOURCE },
      ],
    }
    : {
      user: userId,
      type: 'bonus',
      status: 'open',
      remaining: { $gt: 0 },
      $or: [
        { 'meta.bonusCode': SIGNUP_BONUS_CODE },
        { source: SIGNUP_BONUS_SOURCE },
      ],
    };

  const openRequirements = await TurnoverRequirement.find(requirementFilter).sort({ createdAt: 1 });

  const remainingTurnover = money(openRequirements.reduce((sum, item) => sum + Number(item.remaining || 0), 0));
  const totalRequiredTurnover = money(openRequirements.reduce((sum, item) => sum + Number(item.requiredWager || 0), 0));
  const totalWagered = money(openRequirements.reduce((sum, item) => sum + Number(item.wagered || 0), 0));
  const status = bonusTransaction?.status || 'NOT_AWARDED';
  const awarded = status === 'SUCCESS';
  const originalAmount = Number(bonusTransaction?.amount || 0);

  return {
    bonusCode: SIGNUP_BONUS_CODE,
    title: 'New account signup bonus',
    awarded,
    rejected: ['CANCELLED', 'REJECTED'].includes(status),
    canReject: awarded && remainingTurnover > 0,
    amount: awarded ? originalAmount : 0,
    originalAmount,
    currency: bonusTransaction?.currency || '',
    status,
    transactionId: bonusTransaction?._id || null,
    remainingTurnover: awarded ? remainingTurnover : 0,
    totalRequiredTurnover: awarded ? totalRequiredTurnover : 0,
    totalWagered: awarded ? totalWagered : 0,
    withdrawUnlocked: awarded && remainingTurnover <= 0,
    turnoverMultiplier: bonusTransaction?.gatewayPayload?.turnoverMultiplier || getSignupBonusTurnoverMultiplier(),
    createdAt: bonusTransaction?.createdAt || null,
    updatedAt: bonusTransaction?.updatedAt || null,
  };
}


export async function rejectSignupBonusForUser(userId) {
  const bonusTransaction = await Transaction.findOne({
    user: userId,
    type: 'BONUS',
    'gatewayPayload.bonusCode': SIGNUP_BONUS_CODE,
    status: 'SUCCESS',
  }).sort({ createdAt: -1 });

  if (!bonusTransaction) {
    return { rejected: false, reason: 'active_bonus_not_found' };
  }

  const bonusAmount = money(bonusTransaction.amount);
  if (bonusAmount <= 0) {
    return { rejected: false, reason: 'empty_bonus_amount' };
  }

  const user = await User.findById(userId);
  if (!user) return { rejected: false, reason: 'user_not_found' };

  if (Number(user.wallet || 0) < bonusAmount) {
    return {
      rejected: false,
      reason: 'insufficient_wallet_to_remove_bonus',
      message: `You need at least ${bonusAmount} ${bonusTransaction.currency || user.currency || ''} in wallet to reject this signup bonus.`,
      wallet: money(user.wallet),
      requiredWallet: bonusAmount,
    };
  }

  const updatedUser = await debitWallet(userId, bonusAmount, 'signup-bonus-reject');

  const cancelledTurnovers = await TurnoverRequirement.updateMany(
    {
      user: userId,
      type: 'bonus',
      status: 'open',
      remaining: { $gt: 0 },
      $or: [
        { sourceRef: bonusTransaction._id },
        { 'meta.bonusCode': SIGNUP_BONUS_CODE },
        { source: SIGNUP_BONUS_SOURCE },
      ],
    },
    {
      $set: {
        status: 'cancelled',
        remaining: 0,
        completedAt: new Date(),
        'meta.rejectedByUser': true,
        'meta.rejectedAt': new Date(),
      },
    }
  );

  bonusTransaction.status = 'CANCELLED';
  bonusTransaction.processedAt = new Date();
  bonusTransaction.userNote = 'Signup bonus rejected by user. Bonus amount removed and turnover cancelled.';
  bonusTransaction.gatewayPayload = {
    ...(bonusTransaction.gatewayPayload || {}),
    rejectedByUser: true,
    rejectedAt: new Date(),
    cancelledTurnoverCount: cancelledTurnovers.modifiedCount || 0,
  };
  await bonusTransaction.save();

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        signupBonusRejected: true,
        signupBonusRejectedAt: new Date(),
        signupBonusAwarded: false,
        signupBonusAmount: 0,
      },
      $unset: {
        signupBonusSourceTransaction: '',
      },
    }
  ).catch(() => null);

  const summary = await getSignupBonusSummary(userId);

  return {
    rejected: true,
    reason: 'rejected',
    amountRemoved: bonusAmount,
    transactionId: bonusTransaction._id,
    cancelledTurnoverCount: cancelledTurnovers.modifiedCount || 0,
    summary,
    user: updatedUser,
  };
}
