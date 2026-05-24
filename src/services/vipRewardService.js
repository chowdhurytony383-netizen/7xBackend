import mongoose from 'mongoose';

import Bet from '../models/Bet.js';
import CrashBet from '../models/CrashBet.js';
import JiliTransaction from '../models/JiliTransaction.js';
import ProviderWalletTxn from '../models/ProviderWalletTxn.js';
import SportsAutoBet from '../models/SportsAutoBet.js';
import Transaction from '../models/Transaction.js';
import TurnoverRequirement from '../models/TurnoverRequirement.js';
import User from '../models/User.js';
import VipLevel from '../models/VipLevel.js';
import VipReward from '../models/VipReward.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { creditWallet } from '../utils/wallet.js';

const DEFAULT_VIP_LEVELS = [
  { key: 'bronze', name: 'Bronze', minMonthlyTurnover: 10000, cashbackRate: 0.002, unlockBonus: 0, sortOrder: 10, color: '#cd7f32', benefits: ['Basic VIP badge', 'Monthly cashback'] },
  { key: 'silver', name: 'Silver', minMonthlyTurnover: 50000, cashbackRate: 0.004, unlockBonus: 0, sortOrder: 20, color: '#c0c0c0', benefits: ['Faster withdrawal review', 'Monthly cashback'] },
  { key: 'gold', name: 'Gold', minMonthlyTurnover: 200000, cashbackRate: 0.007, unlockBonus: 0, sortOrder: 30, color: '#ffd700', benefits: ['Weekly priority support', 'Monthly cashback'] },
  { key: 'platinum', name: 'Platinum', minMonthlyTurnover: 1000000, cashbackRate: 0.01, unlockBonus: 0, sortOrder: 40, color: '#9fe7ff', benefits: ['Priority support', 'Higher withdrawal review priority'] },
  { key: 'diamond', name: 'Diamond', minMonthlyTurnover: 5000000, cashbackRate: 0.015, unlockBonus: 0, sortOrder: 50, color: '#b9f2ff', benefits: ['Personal manager review', 'Custom VIP offers'] },
];

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

export function getVipPeriod(referenceDate = new Date(), offsetMonths = 0) {
  const ref = normalizeDate(referenceDate);
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + offsetMonths, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  const periodKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { periodKey, periodStart: start, periodEnd: end };
}

function userIdentifiers(user) {
  return [user?._id, user?.id, user?.userId, user?.username]
    .filter(Boolean)
    .map((value) => String(value))
    .filter((value, index, list) => value && list.indexOf(value) === index);
}

async function ensureDefaultVipLevels() {
  const existing = await VipLevel.countDocuments();
  if (existing > 0) return;
  await VipLevel.insertMany(DEFAULT_VIP_LEVELS.map((level) => ({ ...level, isActive: true })));
}

export async function getVipLevels({ includeInactive = false } = {}) {
  await ensureDefaultVipLevels();
  const filter = includeInactive ? {} : { isActive: true };
  return VipLevel.find(filter).sort({ minMonthlyTurnover: 1, sortOrder: 1 });
}

export async function upsertVipLevel(payload = {}) {
  const key = String(payload.key || payload.name || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!key) throw new AppError('VIP level key is required', 400);

  const update = {
    key,
    name: String(payload.name || key).trim(),
    minMonthlyTurnover: money(payload.minMonthlyTurnover),
    cashbackRate: Number(payload.cashbackRate || 0),
    unlockBonus: money(payload.unlockBonus),
    turnoverMultiplier: Number(payload.turnoverMultiplier ?? 1),
    benefits: Array.isArray(payload.benefits) ? payload.benefits.map((item) => String(item).trim()).filter(Boolean) : [],
    color: String(payload.color || '').trim(),
    sortOrder: Number(payload.sortOrder || 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
  };

  return VipLevel.findOneAndUpdate({ key }, update, { upsert: true, new: true, setDefaultsOnInsert: true });
}

export function pickVipLevel(levels = [], monthlyTurnover = 0) {
  const sorted = [...levels].filter((level) => level.isActive !== false).sort((a, b) => Number(a.minMonthlyTurnover || 0) - Number(b.minMonthlyTurnover || 0));
  let selected = null;
  for (const level of sorted) {
    if (Number(monthlyTurnover || 0) >= Number(level.minMonthlyTurnover || 0)) selected = level;
  }
  return selected;
}

export function getNextVipLevel(levels = [], monthlyTurnover = 0) {
  const sorted = [...levels].filter((level) => level.isActive !== false).sort((a, b) => Number(a.minMonthlyTurnover || 0) - Number(b.minMonthlyTurnover || 0));
  return sorted.find((level) => Number(monthlyTurnover || 0) < Number(level.minMonthlyTurnover || 0)) || null;
}

function matchDateRange(periodStart, periodEnd) {
  return { $gte: periodStart, $lt: periodEnd };
}

async function aggregateClassicBets(userId, periodStart, periodEnd) {
  const rows = await Bet.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId), status: { $in: ['WIN', 'LOSE', 'CASHED_OUT'] }, createdAt: matchDateRange(periodStart, periodEnd) } },
    { $group: { _id: null, turnover: { $sum: '$betAmount' }, wins: { $sum: '$winAmount' }, count: { $sum: 1 } } },
  ]);
  return rows[0] || { turnover: 0, wins: 0, count: 0 };
}

async function aggregateCrashBets(userId, periodStart, periodEnd) {
  const rows = await CrashBet.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId), status: { $in: ['CASHED_OUT', 'LOST'] }, createdAt: matchDateRange(periodStart, periodEnd) } },
    { $group: { _id: null, turnover: { $sum: '$amount' }, wins: { $sum: '$payoutAmount' }, count: { $sum: 1 } } },
  ]);
  return rows[0] || { turnover: 0, wins: 0, count: 0 };
}

async function aggregateSportsBets(userId, periodStart, periodEnd) {
  const rows = await SportsAutoBet.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId), status: { $in: ['WON', 'LOST'] }, settledAt: matchDateRange(periodStart, periodEnd) } },
    { $group: { _id: null, turnover: { $sum: '$stake' }, wins: { $sum: '$payoutAmount' }, count: { $sum: 1 } } },
  ]);
  return rows[0] || { turnover: 0, wins: 0, count: 0 };
}

async function aggregateJiliBets(user, periodStart, periodEnd) {
  const ids = userIdentifiers(user);
  const usernameRegex = ids.length ? new RegExp(`(^|_)(${ids.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i') : null;
  const match = {
    action: { $in: ['bet', 'sessionBet'] },
    status: 'accepted',
    createdAt: matchDateRange(periodStart, periodEnd),
    $or: [{ user: user._id }],
  };
  if (usernameRegex) match.$or.push({ username: usernameRegex });

  const rows = await JiliTransaction.aggregate([
    { $match: match },
    {
      $project: {
        turnover: { $cond: [{ $gt: ['$turnoverAmount', 0] }, '$turnoverAmount', '$betAmount'] },
        wins: {
          $max: [
            0,
            { $add: [{ $cond: [{ $gt: ['$turnoverAmount', 0] }, '$turnoverAmount', '$betAmount'] }, { $ifNull: ['$walletDelta', 0] }] },
          ],
        },
      },
    },
    { $group: { _id: null, turnover: { $sum: '$turnover' }, wins: { $sum: '$wins' }, count: { $sum: 1 } } },
  ]);
  return rows[0] || { turnover: 0, wins: 0, count: 0 };
}

async function aggregateProviderWalletBets(user, periodStart, periodEnd) {
  const ids = userIdentifiers(user);
  if (!ids.length) return { turnover: 0, wins: 0, count: 0 };
  const rows = await ProviderWalletTxn.aggregate([
    { $match: { userId: { $in: ids }, status: 'success', createdAt: matchDateRange(periodStart, periodEnd) } },
    {
      $group: {
        _id: null,
        turnoverCents: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amountCents', 0] } },
        winsCents: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amountCents', 0] } },
        count: { $sum: { $cond: [{ $in: ['$type', ['debit', 'credit']] }, 1, 0] } },
      },
    },
  ]);
  const row = rows[0] || { turnoverCents: 0, winsCents: 0, count: 0 };
  return { turnover: money(Number(row.turnoverCents || 0) / 100), wins: money(Number(row.winsCents || 0) / 100), count: row.count || 0 };
}

export async function calculateUserVipMetrics(user, period = getVipPeriod(new Date())) {
  const { periodStart, periodEnd } = period;
  const [classic, crash, sports, jili, providerWallet] = await Promise.all([
    aggregateClassicBets(user._id, periodStart, periodEnd),
    aggregateCrashBets(user._id, periodStart, periodEnd),
    aggregateSportsBets(user._id, periodStart, periodEnd),
    aggregateJiliBets(user, periodStart, periodEnd),
    aggregateProviderWalletBets(user, periodStart, periodEnd),
  ]);

  const casinoTurnover = money(Number(classic.turnover || 0) + Number(crash.turnover || 0) + Number(jili.turnover || 0) + Number(providerWallet.turnover || 0));
  const casinoWins = money(Number(classic.wins || 0) + Number(crash.wins || 0) + Number(jili.wins || 0) + Number(providerWallet.wins || 0));
  const sportsTurnover = money(sports.turnover || 0);
  const sportsWins = money(sports.wins || 0);
  const monthlyTurnover = money(casinoTurnover + sportsTurnover);
  const monthlyWinAmount = money(casinoWins + sportsWins);
  const monthlyNetLoss = money(Math.max(0, monthlyTurnover - monthlyWinAmount));

  return {
    periodKey: period.periodKey,
    periodStart,
    periodEnd,
    monthlyTurnover,
    monthlyWinAmount,
    monthlyNetLoss,
    breakdown: {
      casino: { turnover: casinoTurnover, wins: casinoWins, count: (classic.count || 0) + (crash.count || 0) + (jili.count || 0) + (providerWallet.count || 0) },
      sports: { turnover: sportsTurnover, wins: sportsWins, count: sports.count || 0 },
      classic,
      crash,
      jili,
      providerWallet,
    },
  };
}

export async function getUserVipSummary(userId) {
  const user = await User.findById(userId);
  assertOrThrow(user, 'User not found', 404);
  const levels = await getVipLevels();
  const currentPeriod = getVipPeriod(new Date());
  const currentMetrics = await calculateUserVipMetrics(user, currentPeriod);
  const currentLevel = pickVipLevel(levels, currentMetrics.monthlyTurnover);
  const nextLevel = getNextVipLevel(levels, currentMetrics.monthlyTurnover);
  const progress = nextLevel
    ? Math.min(100, Math.round((currentMetrics.monthlyTurnover / Math.max(Number(nextLevel.minMonthlyTurnover || 1), 1)) * 100))
    : 100;

  const rewards = await VipReward.find({ user: user._id }).sort({ periodStart: -1 }).limit(24);

  return {
    user: {
      id: user._id,
      isVerified: Boolean(user.isVerified || user.verificationStatus === 'approved'),
      verificationStatus: user.verificationStatus,
      currency: user.currency || 'BDT',
    },
    levels,
    currentPeriod,
    currentMetrics,
    currentLevel,
    nextLevel,
    progress,
    rewards,
  };
}

export async function calculateMonthlyVipRewards({ period = getVipPeriod(new Date(), -1), userId = null, recalculate = false } = {}) {
  await ensureDefaultVipLevels();
  const levels = await getVipLevels();
  const userFilter = { role: 'user', status: 'active' };
  if (userId) userFilter._id = userId;

  const users = await User.find(userFilter).select('_id userId username name fullName currency isVerified verificationStatus status role');
  const result = { periodKey: period.periodKey, checked: users.length, created: 0, updated: 0, skipped: 0, zeroReward: 0, rewards: [] };

  for (const user of users) {
    const metrics = await calculateUserVipMetrics(user, period);
    const level = pickVipLevel(levels, metrics.monthlyTurnover);
    if (!level) {
      await User.findByIdAndUpdate(user._id, {
        vipLevel: 'none',
        vipLevelName: 'No VIP',
        vipMonthlyTurnover: metrics.monthlyTurnover,
        vipMonthlyNetLoss: metrics.monthlyNetLoss,
        vipLastCalculatedAt: new Date(),
      });
      result.skipped += 1;
      continue;
    }

    const cashbackAmount = money(metrics.monthlyNetLoss * Number(level.cashbackRate || 0));
    const unlockBonusAmount = money(level.unlockBonus || 0);
    const rewardAmount = money(cashbackAmount + unlockBonusAmount);
    const requiredTurnover = money(rewardAmount * Number(level.turnoverMultiplier ?? 1));

    await User.findByIdAndUpdate(user._id, {
      vipLevel: level.key,
      vipLevelName: level.name,
      vipMonthlyTurnover: metrics.monthlyTurnover,
      vipMonthlyNetLoss: metrics.monthlyNetLoss,
      vipLastCalculatedAt: new Date(),
    });

    if (rewardAmount <= 0) {
      result.zeroReward += 1;
      continue;
    }

    const existing = await VipReward.findOne({ user: user._id, periodKey: period.periodKey });
    if (existing && !recalculate && existing.status !== 'PENDING_APPROVAL') {
      result.skipped += 1;
      continue;
    }

    const payload = {
      user: user._id,
      periodKey: period.periodKey,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      levelKey: level.key,
      levelName: level.name,
      monthlyTurnover: metrics.monthlyTurnover,
      monthlyWinAmount: metrics.monthlyWinAmount,
      monthlyNetLoss: metrics.monthlyNetLoss,
      cashbackRate: Number(level.cashbackRate || 0),
      cashbackAmount,
      unlockBonusAmount,
      rewardAmount,
      requiredTurnover,
      currency: user.currency || 'BDT',
      status: 'PENDING_APPROVAL',
      calculatedAt: new Date(),
      meta: { breakdown: metrics.breakdown, turnoverMultiplier: Number(level.turnoverMultiplier ?? 1) },
    };

    const reward = existing
      ? await VipReward.findByIdAndUpdate(existing._id, payload, { new: true })
      : await VipReward.create(payload);

    result[existing ? 'updated' : 'created'] += 1;
    result.rewards.push(reward);
  }

  return result;
}

export async function approveVipReward({ rewardId, adminId, note = '' }) {
  const reward = await VipReward.findById(rewardId).populate('user', 'name fullName email isVerified verificationStatus currency');
  assertOrThrow(reward, 'VIP reward not found', 404);
  assertOrThrow(reward.status === 'PENDING_APPROVAL', 'Only pending VIP rewards can be approved', 400);

  reward.status = 'APPROVED';
  reward.approvedAt = new Date();
  reward.approvedBy = adminId;
  reward.adminNote = note || reward.adminNote || '';
  await reward.save();
  return reward;
}

export async function rejectVipReward({ rewardId, adminId, reason = '' }) {
  const reward = await VipReward.findById(rewardId).populate('user', 'name fullName email');
  assertOrThrow(reward, 'VIP reward not found', 404);
  assertOrThrow(['PENDING_APPROVAL', 'APPROVED'].includes(reward.status), 'This VIP reward cannot be rejected', 400);

  reward.status = 'REJECTED';
  reward.rejectedAt = new Date();
  reward.rejectedBy = adminId;
  reward.rejectedReason = reason || 'Rejected by admin';
  await reward.save();
  return reward;
}

export async function claimVipReward({ rewardId, userId }) {
  const reward = await VipReward.findOne({ _id: rewardId, user: userId });
  assertOrThrow(reward, 'VIP reward not found', 404);
  assertOrThrow(reward.status === 'APPROVED', 'VIP reward is not approved yet', 400);

  const user = await User.findById(userId);
  assertOrThrow(user, 'User not found', 404);
  assertOrThrow(user.isVerified || user.verificationStatus === 'approved', 'KYC verification is required before claiming VIP rewards.', 403, { code: 'VIP_KYC_REQUIRED' });

  const amount = money(reward.rewardAmount);
  assertOrThrow(amount > 0, 'VIP reward amount is empty', 400);

  const transaction = await Transaction.create({
    user: user._id,
    type: 'BONUS',
    amount,
    status: 'SUCCESS',
    method: 'vip-reward',
    methodKey: 'vip-reward',
    currency: reward.currency || user.currency || 'BDT',
    balanceType: 'BONUS',
    userNote: `VIP ${reward.levelName} reward credited. Required turnover before withdrawal: ${reward.requiredTurnover}.`,
    adminNote: reward.adminNote || '',
    processedAt: new Date(),
    gatewayPayload: {
      bonusCode: 'VIP_REWARD',
      vipReward: true,
      periodKey: reward.periodKey,
      levelKey: reward.levelKey,
      levelName: reward.levelName,
      cashbackAmount: reward.cashbackAmount,
      unlockBonusAmount: reward.unlockBonusAmount,
      requiredTurnover: reward.requiredTurnover,
      turnoverMultiplier: reward.rewardAmount > 0 ? reward.requiredTurnover / reward.rewardAmount : 1,
    },
  });

  await creditWallet(user._id, amount, 'vip-reward', {
    turnoverSourceRef: transaction._id,
    turnoverMeta: {
      bonusCode: 'VIP_REWARD',
      vipRewardId: reward._id,
      periodKey: reward.periodKey,
      levelKey: reward.levelKey,
      requiredTurnover: reward.requiredTurnover,
      turnoverMultiplier: reward.rewardAmount > 0 ? reward.requiredTurnover / reward.rewardAmount : 1,
    },
  });

  const requirement = await TurnoverRequirement.findOne({ sourceRef: transaction._id }).sort({ createdAt: -1 });

  reward.status = 'CLAIMED';
  reward.claimedAt = new Date();
  reward.transaction = transaction._id;
  reward.turnoverRequirement = requirement?._id || null;
  await reward.save();

  return { reward, transaction, turnoverRequirement: requirement };
}
