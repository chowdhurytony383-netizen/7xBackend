import AffiliatePartner from '../models/AffiliatePartner.js';
import AffiliatePeriod from '../models/AffiliatePeriod.js';
import Bet from '../models/Bet.js';
import CrashBet from '../models/CrashBet.js';
import JiliTransaction from '../models/JiliTransaction.js';
import ProviderWalletTxn from '../models/ProviderWalletTxn.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';

function toDate(value, fallback) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function roundMoney(value) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDayExclusive(date) {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

async function getAffiliateUsers(affiliateId) {
  return User.find({ affiliatePartner: affiliateId }).select('_id userId').lean();
}

async function aggregateInternalBets(userIds, start, end) {
  const result = await Bet.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: { $in: ['WIN', 'LOSE', 'CASHED_OUT'] } } },
    { $group: { _id: null, bets: { $sum: '$betAmount' }, wins: { $sum: '$winAmount' } } },
  ]);
  return { bets: roundMoney(result[0]?.bets), wins: roundMoney(result[0]?.wins) };
}

async function aggregateCrashBets(userIds, start, end) {
  const result = await CrashBet.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: { $in: ['CASHED_OUT', 'LOST'] } } },
    { $group: { _id: null, bets: { $sum: '$amount' }, wins: { $sum: '$payoutAmount' } } },
  ]);
  return { bets: roundMoney(result[0]?.bets), wins: roundMoney(result[0]?.wins) };
}

async function aggregateJiliBets(userIds, start, end) {
  const result = await JiliTransaction.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: 'accepted', action: { $in: ['bet', 'sessionBet'] } } },
    { $group: { _id: null, bets: { $sum: '$betAmount' }, wins: { $sum: '$winloseAmount' } } },
  ]);
  return { bets: roundMoney(result[0]?.bets), wins: roundMoney(result[0]?.wins) };
}

async function aggregateProviderWallet(userCodes, start, end) {
  if (!userCodes.length) return { bets: 0, wins: 0 };
  const rows = await ProviderWalletTxn.aggregate([
    { $match: { userId: { $in: userCodes }, createdAt: { $gte: start, $lt: end }, status: 'success', type: { $in: ['debit', 'credit', 'rollback'] } } },
    { $group: { _id: '$type', amountCents: { $sum: '$amountCents' } } },
  ]);
  let bets = 0;
  let wins = 0;
  for (const row of rows) {
    const amount = Number(row.amountCents || 0) / 100;
    if (row._id === 'debit') bets += amount;
    if (row._id === 'credit' || row._id === 'rollback') wins += amount;
  }
  return { bets: roundMoney(bets), wins: roundMoney(wins) };
}

async function aggregateBonusCost(userIds, start, end) {
  const result = await Transaction.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: 'SUCCESS', type: 'BONUS' } },
    { $group: { _id: null, amount: { $sum: '$amount' } } },
  ]);
  return roundMoney(result[0]?.amount);
}

async function aggregateRefundsVoidsChargebacks(userIds, start, end) {
  const result = await Transaction.aggregate([
    { $match: { user: { $in: userIds }, updatedAt: { $gte: start, $lt: end }, status: { $in: ['REJECTED', 'CANCELLED', 'FAILED'] }, type: { $in: ['DEPOSIT', 'WITHDRAW'] } } },
    { $group: { _id: null, amount: { $sum: '$amount' } } },
  ]);
  return roundMoney(result[0]?.amount);
}

export async function calculateAffiliatePeriod({ affiliateId, periodStart, periodEnd, adminUserId, overwrite = false }) {
  const affiliate = await AffiliatePartner.findById(affiliateId);
  if (!affiliate) throw new Error('Affiliate partner not found');
  if (affiliate.status !== 'approved') throw new Error('Affiliate partner is not approved');

  const start = startOfDay(toDate(periodStart, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const end = periodEnd ? toDate(periodEnd, endOfDayExclusive(start)) : endOfDayExclusive(start);
  if (end <= start) throw new Error('Invalid period range');

  const existing = await AffiliatePeriod.findOne({ affiliate: affiliate._id, periodStart: start, periodEnd: end });
  if (existing && existing.status !== 'calculated' && !overwrite) {
    throw new Error('This period is already approved/paid. Use a new adjustment instead.');
  }

  const affiliateUsers = await getAffiliateUsers(affiliate._id);
  const userIds = affiliateUsers.map((user) => user._id);
  const userCodes = affiliateUsers.map((user) => user.userId).filter(Boolean);

  const [internal, crash, jili, providerWallet, bonusCost, refundsVoidsChargebacks] = await Promise.all([
    aggregateInternalBets(userIds, start, end),
    aggregateCrashBets(userIds, start, end),
    aggregateJiliBets(userIds, start, end),
    aggregateProviderWallet(userCodes, start, end),
    aggregateBonusCost(userIds, start, end),
    aggregateRefundsVoidsChargebacks(userIds, start, end),
  ]);

  const totalBets = roundMoney(internal.bets + crash.bets + jili.bets + providerWallet.bets);
  const totalWins = roundMoney(internal.wins + crash.wins + jili.wins + providerWallet.wins);
  const grossGgr = roundMoney(totalBets - totalWins - bonusCost - refundsVoidsChargebacks);
  const previousCarryover = affiliate.negativeCarryover ? roundMoney(affiliate.carryoverBalance || 0) : 0;
  const netGgrAfterCarryover = roundMoney(grossGgr + previousCarryover);
  const commissionAmount = Math.max(0, roundMoney(netGgrAfterCarryover * affiliate.commissionRate));
  const carryoverAfter = affiliate.negativeCarryover && netGgrAfterCarryover < 0 ? roundMoney(netGgrAfterCarryover) : 0;

  const payload = {
    affiliate: affiliate._id,
    periodStart: start,
    periodEnd: end,
    totalBets,
    totalWins,
    bonusCost,
    refundsVoidsChargebacks,
    grossGgr,
    previousCarryover,
    netGgrAfterCarryover,
    commissionRate: affiliate.commissionRate,
    commissionAmount,
    carryoverAfter,
    sourceBreakdown: { internal, crash, jili, providerWallet },
    status: 'calculated',
    calculatedBy: adminUserId,
  };

  let period;
  if (existing) {
    Object.assign(existing, payload);
    period = await existing.save();
  } else {
    period = await AffiliatePeriod.create(payload);
  }

  return period;
}

export async function approveAffiliatePeriod(periodId, adminUserId) {
  const period = await AffiliatePeriod.findById(periodId);
  if (!period) throw new Error('Affiliate period not found');
  if (period.status !== 'calculated') return period;

  period.status = 'approved';
  period.approvedBy = adminUserId;
  period.approvedAt = new Date();
  await period.save();

  const affiliate = await AffiliatePartner.findById(period.affiliate);
  if (affiliate) {
    affiliate.carryoverBalance = period.carryoverAfter;
    affiliate.stats.totalBets = roundMoney(Number(affiliate.stats.totalBets || 0) + period.totalBets);
    affiliate.stats.totalWins = roundMoney(Number(affiliate.stats.totalWins || 0) + period.totalWins);
    affiliate.stats.totalBonusCost = roundMoney(Number(affiliate.stats.totalBonusCost || 0) + period.bonusCost);
    affiliate.stats.totalRefundsVoidsChargebacks = roundMoney(Number(affiliate.stats.totalRefundsVoidsChargebacks || 0) + period.refundsVoidsChargebacks);
    affiliate.stats.totalGgr = roundMoney(Number(affiliate.stats.totalGgr || 0) + period.grossGgr);
    affiliate.stats.commissionEarned = roundMoney(Number(affiliate.stats.commissionEarned || 0) + period.commissionAmount);
    affiliate.stats.commissionApproved = roundMoney(Number(affiliate.stats.commissionApproved || 0) + period.commissionAmount);
    affiliate.stats.pendingCommission = roundMoney(Number(affiliate.stats.pendingCommission || 0) + period.commissionAmount);
    await affiliate.save();
  }

  return period;
}
