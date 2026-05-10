import Verification from '../models/Verification.js';
import TurnoverRequirement from '../models/TurnoverRequirement.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { env } from '../config/env.js';

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function boolEnv(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function getTurnoverMultiplier() {
  const multiplier = Number(env.WITHDRAW_TURNOVER_MULTIPLIER || 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function isEmailVerified(user = {}) {
  if (user.isVerified === true || user.emailVerified === true) return true;
  // OAuth providers normally return a verified email from the provider.
  return ['google', 'facebook'].includes(String(user.provider || '').toLowerCase())
    || ['google', 'facebook'].includes(String(user.registrationType || '').toLowerCase());
}

function isDepositCreditSource(source = '') {
  const value = String(source || '').toLowerCase();
  return value === 'deposit-success'
    || value === 'admin-deposit-approval'
    || value === 'agent-deposit-confirm'
    || value.startsWith('crypto:')
    || value.includes('deposit-confirm')
    || value.includes('deposit-success');
}

function isBonusCreditSource(source = '') {
  const value = String(source || '').toLowerCase();
  return value.includes('bonus')
    || value.includes('cashback')
    || value.includes('promo')
    || value.includes('promotion')
    || value.includes('vip')
    || value.includes('reward');
}

function getTurnoverTypeForCredit(source = '') {
  if (isBonusCreditSource(source)) return 'bonus';
  if (isDepositCreditSource(source)) return 'deposit';
  return '';
}

function isWagerDebitSource(source = '') {
  const value = String(source || '').toLowerCase();
  return value.includes('sports-bet')
    || value.includes('dice-bet')
    || value.includes('mines-start')
    || value.includes('mines-bet')
    || value.includes('crash-bet')
    || value.includes('casino-bet')
    || value.includes('slot-bet')
    || value.includes('vgames-bet')
    || value.includes('game-bet')
    || value.includes('wager');
}

export async function recordTurnoverCredit({ userId, amount, source = '', sourceRef = null, meta = {} }) {
  const type = getTurnoverTypeForCredit(source);
  const creditAmount = money(amount);
  if (!type || creditAmount <= 0) return null;
  if (!boolEnv(env.WITHDRAW_TURNOVER_REQUIRED, true)) return null;

  const requiredWager = money(creditAmount * getTurnoverMultiplier());
  if (requiredWager <= 0) return null;

  return TurnoverRequirement.create({
    user: userId,
    type,
    source,
    sourceRef,
    amount: creditAmount,
    requiredWager,
    remaining: requiredWager,
    wagered: 0,
    status: 'open',
    meta,
  });
}

export async function recordWagerTurnover(userId, stake, source = '') {
  const amount = money(stake);
  if (!userId || amount <= 0) return { applied: 0, remainingStake: amount };
  if (!boolEnv(env.WITHDRAW_TURNOVER_REQUIRED, true)) return { applied: 0, remainingStake: amount };
  if (!isWagerDebitSource(source)) return { applied: 0, remainingStake: amount };

  let remainingStake = amount;
  let applied = 0;
  const requirements = await TurnoverRequirement.find({
    user: userId,
    status: 'open',
    remaining: { $gt: 0 },
  }).sort({ createdAt: 1 }).limit(100);

  for (const requirement of requirements) {
    if (remainingStake <= 0) break;
    const useAmount = money(Math.min(remainingStake, Number(requirement.remaining || 0)));
    if (useAmount <= 0) continue;

    requirement.wagered = money(Number(requirement.wagered || 0) + useAmount);
    requirement.remaining = money(Number(requirement.remaining || 0) - useAmount);
    if (requirement.remaining <= 0) {
      requirement.remaining = 0;
      requirement.status = 'completed';
      requirement.completedAt = new Date();
    }
    await requirement.save();
    remainingStake = money(remainingStake - useAmount);
    applied = money(applied + useAmount);
  }

  return { applied, remainingStake };
}

export async function getWithdrawalTurnoverSummary(userId, walletBalance = 0) {
  const openRequirements = await TurnoverRequirement.find({
    user: userId,
    status: 'open',
    remaining: { $gt: 0 },
  }).sort({ createdAt: 1 });

  const lockedAmount = money(openRequirements.reduce((sum, item) => sum + Number(item.remaining || 0), 0));
  const availableForWithdraw = money(Math.max(0, Number(walletBalance || 0) - lockedAmount));

  return {
    lockedAmount,
    availableForWithdraw,
    openRequirementCount: openRequirements.length,
    requirements: openRequirements.map((item) => ({
      id: item._id,
      type: item.type,
      source: item.source,
      amount: item.amount,
      requiredWager: item.requiredWager,
      wagered: item.wagered,
      remaining: item.remaining,
      createdAt: item.createdAt,
    })),
  };
}

export async function getWithdrawalProfileStatus(user) {
  const verification = await Verification.findOne({ user: user._id }).sort({ updatedAt: -1 });
  const missing = [];

  if (!isEmailVerified(user)) missing.push('Email verification');

  const fullName = hasText(user.fullName) || hasText(user.name) || hasText(verification?.fullName);
  if (!fullName) missing.push('Full name');

  const address = hasText(user.address) || hasText(verification?.address);
  if (!address) missing.push('Address');

  const documentSubmitted = Boolean(
    verification
    && verification.status !== 'rejected'
    && (hasText(verification.documentFront) || hasText(verification.documentBack))
  );
  if (!documentSubmitted) missing.push('Identity document');

  return {
    ok: missing.length === 0,
    missing,
    verificationStatus: verification?.status || user.verificationStatus || 'not_submitted',
  };
}

export async function assertWithdrawalAllowedForUser(user, amount) {
  if (boolEnv(env.WITHDRAW_KYC_REQUIRED, true)) {
    const profileStatus = await getWithdrawalProfileStatus(user);
    assertOrThrow(
      profileStatus.ok,
      `Withdrawal locked. Please submit: ${profileStatus.missing.join(', ')}.`,
      403,
      { code: 'WITHDRAW_KYC_REQUIRED', missing: profileStatus.missing, verificationStatus: profileStatus.verificationStatus }
    );
  }

  if (boolEnv(env.WITHDRAW_TURNOVER_REQUIRED, true)) {
    const summary = await getWithdrawalTurnoverSummary(user._id, user.wallet || 0);
    const requestedAmount = money(amount);
    if (requestedAmount > summary.availableForWithdraw) {
      throw new AppError(
        `Withdrawal locked. You must place bets worth ${summary.lockedAmount} before withdrawing this balance. Available to withdraw: ${summary.availableForWithdraw}.`,
        403,
        { code: 'WITHDRAW_TURNOVER_REQUIRED', requestedAmount, ...summary }
      );
    }
  }
}
