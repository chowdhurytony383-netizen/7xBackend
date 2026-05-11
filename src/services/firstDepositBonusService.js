import Transaction from '../models/Transaction.js';
import TurnoverRequirement from '../models/TurnoverRequirement.js';
import User from '../models/User.js';
import Verification from '../models/Verification.js';
import { env } from '../config/env.js';
import { creditWallet } from '../utils/wallet.js';

const BONUS_CODE = 'FIRST_DEPOSIT_100';
const BONUS_SOURCE = 'first-deposit-bonus';
const BASE_CURRENCY = 'BDT';
const DEFAULT_BASE_CAP_BDT = 15000;

const rateCache = new Map();
let envRateCache = null;
let envCapCache = null;

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
    console.error('Invalid first deposit bonus currency JSON:', error.message);
    return fallback;
  }
}

function envRates() {
  if (!envRateCache) {
    envRateCache = parseJsonMap(env.FIRST_DEPOSIT_BONUS_BDT_RATES_JSON, {});
  }
  return envRateCache;
}

function envCaps() {
  if (!envCapCache) {
    envCapCache = parseJsonMap(env.FIRST_DEPOSIT_BONUS_CAPS_JSON, {});
  }
  return envCapCache;
}

async function fetchLiveBdtRates() {
  const apiUrl = String(env.FIRST_DEPOSIT_BONUS_EXCHANGE_API_URL || '').trim();
  if (!apiUrl || !boolEnv(env.FIRST_DEPOSIT_BONUS_USE_LIVE_RATES, true)) return null;

  const key = 'BDT:LIVE';
  const cached = rateCache.get(key);
  const now = Date.now();
  const cacheMs = Number(env.FIRST_DEPOSIT_BONUS_RATE_CACHE_MS || 6 * 60 * 60 * 1000);
  if (cached && now - cached.time < cacheMs) return cached.rates;

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
    rateCache.set(key, { rates, time: now });
    return rates;
  } catch (error) {
    console.error('First deposit bonus live exchange-rate fetch failed:', error.message);
    return null;
  }
}

async function getBdtToCurrencyRate(currency) {
  const targetCurrency = cleanCurrency(currency);
  if (targetCurrency === BASE_CURRENCY) return 1;

  const configuredRate = envRates()[targetCurrency];
  if (configuredRate) return configuredRate;

  const liveRates = await fetchLiveBdtRates();
  if (liveRates?.[targetCurrency]) return liveRates[targetCurrency];

  return fallbackBdtRates[targetCurrency] || 1;
}

export async function getFirstDepositBonusCap(user = {}) {
  const currency = cleanCurrency(user.currency || BASE_CURRENCY);
  const directCap = envCaps()[currency];
  if (directCap) {
    return {
      currency,
      capAmount: money(directCap),
      baseCurrency: BASE_CURRENCY,
      baseCapAmount: Number(env.FIRST_DEPOSIT_BONUS_BASE_CAP_BDT || DEFAULT_BASE_CAP_BDT),
      rate: null,
      rateSource: 'env-direct-cap',
    };
  }

  const baseCapAmount = Number(env.FIRST_DEPOSIT_BONUS_BASE_CAP_BDT || DEFAULT_BASE_CAP_BDT);
  const safeBaseCap = Number.isFinite(baseCapAmount) && baseCapAmount > 0 ? baseCapAmount : DEFAULT_BASE_CAP_BDT;
  const rate = await getBdtToCurrencyRate(currency);

  return {
    currency,
    capAmount: money(safeBaseCap * rate),
    baseCurrency: BASE_CURRENCY,
    baseCapAmount: safeBaseCap,
    rate,
    rateSource: envRates()[currency] ? 'env-rate' : (fallbackBdtRates[currency] ? 'live-or-fallback-rate' : 'fallback-bdt-rate'),
  };
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function isEmailVerified(user = {}) {
  if (user.isVerified === true || user.emailVerified === true) return true;
  return ['google', 'facebook'].includes(String(user.provider || '').toLowerCase())
    || ['google', 'facebook'].includes(String(user.registrationType || '').toLowerCase());
}

export async function getFirstDepositBonusEligibility(user = {}) {
  const verification = await Verification.findOne({ user: user._id }).sort({ updatedAt: -1 });
  const missing = [];

  if (!isEmailVerified(user)) missing.push('Email verification');
  if (!(hasText(user.fullName) || hasText(user.name) || hasText(verification?.fullName))) missing.push('Full Name');
  if (!(hasText(user.address) || hasText(verification?.address))) missing.push('Address');

  return {
    eligible: missing.length === 0,
    missing,
    verificationStatus: verification?.status || user.verificationStatus || 'not_submitted',
  };
}

export async function awardFirstDepositBonusForTransaction(depositTransaction) {
  if (!boolEnv(env.FIRST_DEPOSIT_BONUS_ENABLED, true)) {
    return { awarded: false, reason: 'bonus_disabled' };
  }

  const transaction = depositTransaction?._id
    ? depositTransaction
    : await Transaction.findById(depositTransaction);

  if (!transaction) return { awarded: false, reason: 'deposit_transaction_not_found' };
  if (transaction.type !== 'DEPOSIT' || transaction.status !== 'SUCCESS') {
    return { awarded: false, reason: 'not_successful_deposit' };
  }

  const alreadyAwardedTransaction = await Transaction.findOne({
    user: transaction.user,
    type: 'BONUS',
    'gatewayPayload.bonusCode': BONUS_CODE,
    status: 'SUCCESS',
  }).select('_id amount');
  if (alreadyAwardedTransaction) {
    return { awarded: false, reason: 'already_awarded', bonusTransaction: alreadyAwardedTransaction };
  }

  const successfulDepositCount = await Transaction.countDocuments({
    user: transaction.user,
    type: 'DEPOSIT',
    status: 'SUCCESS',
  });
  if (successfulDepositCount !== 1) {
    return { awarded: false, reason: 'not_first_successful_deposit', successfulDepositCount };
  }

  const user = await User.findById(transaction.user);
  if (!user) return { awarded: false, reason: 'user_not_found' };

  const eligibility = await getFirstDepositBonusEligibility(user);
  if (!eligibility.eligible) {
    return { awarded: false, reason: 'profile_not_eligible', eligibility };
  }

  const cap = await getFirstDepositBonusCap(user);
  const depositAmount = money(transaction.amount);
  const bonusAmount = money(Math.min(depositAmount, cap.capAmount));
  if (bonusAmount <= 0) return { awarded: false, reason: 'empty_bonus_amount' };

  const claimedUser = await User.findOneAndUpdate(
    { _id: user._id, firstDepositBonusAwarded: { $ne: true } },
    {
      $set: {
        firstDepositBonusAwarded: true,
        firstDepositBonusAwardedAt: new Date(),
        firstDepositBonusAmount: bonusAmount,
        firstDepositBonusCurrency: cap.currency,
        firstDepositBonusSourceTransaction: transaction._id,
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
      amount: bonusAmount,
      status: 'SUCCESS',
      method: 'first-deposit-bonus',
      methodKey: 'first-deposit-bonus',
      currency: cap.currency,
      balanceType: 'BONUS',
      processedAt: new Date(),
      userNote: `First deposit 100% bonus credited. Turnover required: ${bonusAmount} ${cap.currency}.`,
      gatewayPayload: {
        source: BONUS_SOURCE,
        bonusCode: BONUS_CODE,
        bonusBalance: true,
        sourceDepositTransaction: transaction._id,
        sourceDepositAmount: depositAmount,
        bonusAmount,
        currency: cap.currency,
        capAmount: cap.capAmount,
        baseCurrency: cap.baseCurrency,
        baseCapAmount: cap.baseCapAmount,
        rate: cap.rate,
        rateSource: cap.rateSource,
        turnoverMultiplier: Number(env.WITHDRAW_TURNOVER_MULTIPLIER || 1),
      },
    });

    const updatedUser = await creditWallet(user._id, bonusAmount, BONUS_SOURCE, {
      turnoverSourceRef: bonusTransaction._id,
      turnoverMeta: {
        bonusCode: BONUS_CODE,
        sourceDepositTransaction: transaction._id,
        sourceDepositAmount: depositAmount,
        currency: cap.currency,
      },
    });

    return {
      awarded: true,
      amount: bonusAmount,
      currency: cap.currency,
      cap,
      bonusTransaction,
      user: updatedUser,
    };
  } catch (error) {
    await User.updateOne(
      { _id: user._id, firstDepositBonusSourceTransaction: transaction._id },
      {
        $set: {
          firstDepositBonusAwarded: false,
          firstDepositBonusAmount: 0,
          firstDepositBonusCurrency: '',
        },
        $unset: {
          firstDepositBonusAwardedAt: '',
          firstDepositBonusSourceTransaction: '',
        },
      }
    ).catch(() => null);

    if (bonusTransaction?._id) {
      await Transaction.findByIdAndUpdate(bonusTransaction._id, {
        status: 'FAILED',
        adminNote: `Bonus wallet credit failed: ${error.message}`,
      }).catch(() => null);
    }

    console.error('First deposit bonus award failed:', error.message);
    return { awarded: false, reason: 'award_failed', error: error.message };
  }
}

export async function safelyAwardFirstDepositBonus(depositTransaction) {
  try {
    return await awardFirstDepositBonusForTransaction(depositTransaction);
  } catch (error) {
    console.error('First deposit bonus check failed:', error.message);
    return { awarded: false, reason: 'unexpected_error', error: error.message };
  }
}

export async function getFirstDepositBonusSummary(userId) {
  const [bonusTransaction, openRequirements] = await Promise.all([
    Transaction.findOne({ user: userId, type: 'BONUS', 'gatewayPayload.bonusCode': BONUS_CODE })
      .sort({ createdAt: -1 }),
    TurnoverRequirement.find({
      user: userId,
      type: 'bonus',
      status: 'open',
      remaining: { $gt: 0 },
    }).sort({ createdAt: 1 }),
  ]);

  const remainingTurnover = money(openRequirements.reduce((sum, item) => sum + Number(item.remaining || 0), 0));
  const totalRequiredTurnover = money(openRequirements.reduce((sum, item) => sum + Number(item.requiredWager || 0), 0));
  const totalWagered = money(openRequirements.reduce((sum, item) => sum + Number(item.wagered || 0), 0));

  return {
    bonusCode: BONUS_CODE,
    awarded: bonusTransaction?.status === 'SUCCESS',
    amount: Number(bonusTransaction?.amount || 0),
    status: bonusTransaction?.status || 'NOT_AWARDED',
    transactionId: bonusTransaction?._id || null,
    remainingTurnover,
    totalRequiredTurnover,
    totalWagered,
    withdrawUnlocked: Boolean(bonusTransaction) && remainingTurnover <= 0,
    createdAt: bonusTransaction?.createdAt || null,
    updatedAt: bonusTransaction?.updatedAt || null,
  };
}
