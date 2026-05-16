import Transaction from '../models/Transaction.js';
import ReferralReward from '../models/ReferralReward.js';
import User from '../models/User.js';
import { creditWallet } from '../utils/wallet.js';

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function getReferralRewardConfig() {
  return {
    enabled: String(process.env.REFERRAL_REWARD_ENABLED ?? 'true').toLowerCase() !== 'false',
    rate: positiveNumber(process.env.REFERRAL_REWARD_RATE, 0.05),
    maxAmount: positiveNumber(process.env.REFERRAL_REWARD_MAX_AMOUNT, 500),
    turnoverMultiplier: positiveNumber(process.env.REFERRAL_REWARD_TURNOVER_MULTIPLIER, 0.5),
  };
}

export async function handleSuccessfulDepositForReferral(transaction) {
  const config = getReferralRewardConfig();
  if (!config.enabled) return null;
  if (!transaction || transaction.type !== 'DEPOSIT' || transaction.status !== 'SUCCESS') return null;

  const existing = await ReferralReward.findOne({ depositTransaction: transaction._id });
  if (existing) return existing;

  const referredUser = await User.findById(transaction.user);
  if (!referredUser || referredUser.acquisitionSource !== 'invite' || !referredUser.referredByUser) return null;

  const alreadyRewarded = await ReferralReward.exists({ referredUser: referredUser._id });
  if (alreadyRewarded) return null; // first successful deposit only

  const referrerUser = await User.findById(referredUser.referredByUser);
  if (!referrerUser || referrerUser._id.equals(referredUser._id)) return null;

  const depositAmount = Number(transaction.amount || 0);
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) return null;

  const rewardAmount = Math.min(depositAmount * config.rate, config.maxAmount);
  const requiredTurnover = depositAmount * config.turnoverMultiplier;

  const reward = await ReferralReward.create({
    referrerUser: referrerUser._id,
    referredUser: referredUser._id,
    referredByCode: referredUser.referredByCode || referrerUser.inviteCode || '',
    depositTransaction: transaction._id,
    depositAmount,
    rewardAmount,
    rewardCurrency: transaction.currency || referredUser.currency || 'BDT',
    requiredTurnover,
    completedTurnover: 0,
    status: requiredTurnover <= 0 ? 'qualified' : 'pending',
    note: 'Created from referred user first successful deposit',
  });

  if (reward.status === 'qualified') {
    return creditQualifiedReferralReward(reward._id);
  }

  return reward;
}

export async function recordReferralTurnover(userId, amount, source = '') {
  const turnover = Number(amount || 0);
  if (!Number.isFinite(turnover) || turnover <= 0) return null;

  const reward = await ReferralReward.findOne({ referredUser: userId, status: 'pending' });
  if (!reward) return null;

  reward.completedTurnover = Number(reward.completedTurnover || 0) + turnover;
  reward.note = source ? `Last turnover source: ${source}` : reward.note;

  if (reward.completedTurnover >= reward.requiredTurnover) {
    reward.status = 'qualified';
  }

  await reward.save();

  if (reward.status === 'qualified') {
    return creditQualifiedReferralReward(reward._id);
  }

  return reward;
}

export async function creditQualifiedReferralReward(rewardId) {
  const reward = await ReferralReward.findById(rewardId);
  if (!reward || reward.status === 'credited') return reward;
  if (reward.status !== 'qualified') return reward;

  const transaction = await Transaction.create({
    user: reward.referrerUser,
    type: 'BONUS',
    amount: reward.rewardAmount,
    status: 'SUCCESS',
    method: 'referral_reward',
    currency: reward.rewardCurrency || 'BDT',
    balanceType: 'MAIN',
    gatewayPayload: {
      referralReward: reward._id,
      referredUser: reward.referredUser,
      depositTransaction: reward.depositTransaction,
    },
    processedAt: new Date(),
    userNote: 'Referral invite reward credited after turnover qualification',
  });

  await creditWallet(reward.referrerUser, reward.rewardAmount, 'referral-reward', {
    turnoverMeta: { referralReward: reward._id },
  });

  reward.status = 'credited';
  reward.creditedTransaction = transaction._id;
  reward.creditedAt = new Date();
  await reward.save();

  return reward;
}
