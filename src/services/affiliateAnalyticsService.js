import Bet from '../models/Bet.js';
import CrashBet from '../models/CrashBet.js';
import JiliTransaction from '../models/JiliTransaction.js';
import ProviderWalletTxn from '../models/ProviderWalletTxn.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';

export function roundMoney(value) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function toDate(value, fallback) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function getRangeFromQuery(query = {}) {
  const end = toDate(query.periodEnd || query.end, new Date());
  const defaultStart = new Date(end);
  defaultStart.setDate(defaultStart.getDate() - 7);
  const start = toDate(query.periodStart || query.start, defaultStart);
  return { start, end };
}

function getDayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function getWeekKey(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 1 - day);
  return d.toISOString().slice(0, 10);
}

async function getAffiliateUsers(affiliateId) {
  return User.find({ affiliatePartner: affiliateId })
    .select('_id userId fullName name email phone country countryCode currency createdAt status wallet registrationMeta')
    .sort({ createdAt: -1 })
    .lean();
}

function makeMap(users) {
  return new Map(users.map((u) => [String(u._id), {
    user: u,
    deposits: 0,
    withdrawals: 0,
    bets: 0,
    wins: 0,
    bonusCost: 0,
    refundsVoidsChargebacks: 0,
    ggr: 0,
    estimatedCommission: 0,
  }]));
}

async function depositWithdrawAgg(userIds, start, end) {
  return Transaction.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: 'SUCCESS', type: { $in: ['DEPOSIT', 'WITHDRAW', 'BONUS'] } } },
    { $group: { _id: { user: '$user', type: '$type' }, amount: { $sum: '$amount' } } },
  ]);
}

async function refundAgg(userIds, start, end) {
  return Transaction.aggregate([
    { $match: { user: { $in: userIds }, updatedAt: { $gte: start, $lt: end }, status: { $in: ['REJECTED', 'CANCELLED', 'FAILED'] }, type: { $in: ['DEPOSIT', 'WITHDRAW'] } } },
    { $group: { _id: '$user', amount: { $sum: '$amount' } } },
  ]);
}

async function internalBetAgg(userIds, start, end) {
  return Bet.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: { $in: ['WIN', 'LOSE', 'CASHED_OUT'] } } },
    { $group: { _id: '$user', bets: { $sum: '$betAmount' }, wins: { $sum: '$winAmount' } } },
  ]);
}

async function crashBetAgg(userIds, start, end) {
  return CrashBet.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: { $in: ['CASHED_OUT', 'LOST'] } } },
    { $group: { _id: '$user', bets: { $sum: '$amount' }, wins: { $sum: '$payoutAmount' } } },
  ]);
}

async function jiliBetAgg(userIds, start, end) {
  return JiliTransaction.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: 'accepted', action: { $in: ['bet', 'sessionBet'] } } },
    { $group: { _id: '$user', bets: { $sum: '$betAmount' }, wins: { $sum: '$winloseAmount' } } },
  ]);
}

async function providerWalletAgg(users, start, end) {
  const codeToUserId = new Map(users.filter((u) => u.userId).map((u) => [u.userId, String(u._id)]));
  if (!codeToUserId.size) return [];
  const rows = await ProviderWalletTxn.aggregate([
    { $match: { userId: { $in: [...codeToUserId.keys()] }, createdAt: { $gte: start, $lt: end }, status: 'success', type: { $in: ['debit', 'credit', 'rollback'] } } },
    { $group: { _id: { userId: '$userId', type: '$type' }, amountCents: { $sum: '$amountCents' } } },
  ]);
  return rows.map((row) => ({ user: codeToUserId.get(row._id.userId), type: row._id.type, amount: Number(row.amountCents || 0) / 100 }));
}

function applyBetRows(map, rows) {
  for (const row of rows) {
    const item = map.get(String(row._id));
    if (!item) continue;
    item.bets += Number(row.bets || 0);
    item.wins += Number(row.wins || 0);
  }
}

export async function getAffiliateUserPerformance({ affiliateId, start, end, commissionRate = 0.30 }) {
  const users = await getAffiliateUsers(affiliateId);
  const userIds = users.map((u) => u._id);
  const map = makeMap(users);
  if (!userIds.length) return [];

  const [txRows, refundRows, internalRows, crashRows, jiliRows, providerRows] = await Promise.all([
    depositWithdrawAgg(userIds, start, end),
    refundAgg(userIds, start, end),
    internalBetAgg(userIds, start, end),
    crashBetAgg(userIds, start, end),
    jiliBetAgg(userIds, start, end),
    providerWalletAgg(users, start, end),
  ]);

  for (const row of txRows) {
    const item = map.get(String(row._id.user));
    if (!item) continue;
    if (row._id.type === 'DEPOSIT') item.deposits += Number(row.amount || 0);
    if (row._id.type === 'WITHDRAW') item.withdrawals += Number(row.amount || 0);
    if (row._id.type === 'BONUS') item.bonusCost += Number(row.amount || 0);
  }
  for (const row of refundRows) {
    const item = map.get(String(row._id));
    if (item) item.refundsVoidsChargebacks += Number(row.amount || 0);
  }
  applyBetRows(map, internalRows);
  applyBetRows(map, crashRows);
  applyBetRows(map, jiliRows);
  for (const row of providerRows) {
    const item = map.get(String(row.user));
    if (!item) continue;
    if (row.type === 'debit') item.bets += row.amount;
    if (row.type === 'credit' || row.type === 'rollback') item.wins += row.amount;
  }

  return [...map.values()].map((item) => {
    const ggr = roundMoney(item.bets - item.wins - item.bonusCost - item.refundsVoidsChargebacks);
    return {
      ...item,
      deposits: roundMoney(item.deposits),
      withdrawals: roundMoney(item.withdrawals),
      bets: roundMoney(item.bets),
      wins: roundMoney(item.wins),
      loss: roundMoney(Math.max(0, item.bets - item.wins)),
      bonusCost: roundMoney(item.bonusCost),
      refundsVoidsChargebacks: roundMoney(item.refundsVoidsChargebacks),
      ggr,
      estimatedCommission: roundMoney(Math.max(0, ggr) * Number(commissionRate || 0)),
    };
  });
}

export async function getAffiliateTimeBreakdown({ affiliateId, start, end, commissionRate = 0.30, groupBy = 'day' }) {
  const users = await getAffiliateUsers(affiliateId);
  const userIds = users.map((u) => u._id);
  const userCodes = users.map((u) => u.userId).filter(Boolean);
  const codeToUserId = new Map(users.filter((u) => u.userId).map((u) => [u.userId, String(u._id)]));
  const finalKey = (dayKey) => groupBy === 'week' ? getWeekKey(`${dayKey}T00:00:00.000Z`) : dayKey;
  const map = new Map();
  const ensure = (key) => {
    if (!map.has(key)) map.set(key, { key, registrations: 0, deposits: 0, withdrawals: 0, bets: 0, wins: 0, loss: 0, bonusCost: 0, refundsVoidsChargebacks: 0, ggr: 0, commission: 0 });
    return map.get(key);
  };

  for (const user of users) {
    const created = new Date(user.createdAt);
    if (created >= start && created < end) ensure(finalKey(getDayKey(created))).registrations += 1;
  }

  if (!userIds.length) return [];

  const [txRows, refundRows, internalRows, crashRows, jiliRows, providerRows] = await Promise.all([
    Transaction.aggregate([
      { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: 'SUCCESS', type: { $in: ['DEPOSIT', 'WITHDRAW', 'BONUS'] } } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, type: '$type' }, amount: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { user: { $in: userIds }, updatedAt: { $gte: start, $lt: end }, status: { $in: ['REJECTED', 'CANCELLED', 'FAILED'] }, type: { $in: ['DEPOSIT', 'WITHDRAW'] } } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } } }, amount: { $sum: '$amount' } } },
    ]),
    Bet.aggregate([
      { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: { $in: ['WIN', 'LOSE', 'CASHED_OUT'] } } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } }, bets: { $sum: '$betAmount' }, wins: { $sum: '$winAmount' } } },
    ]),
    CrashBet.aggregate([
      { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: { $in: ['CASHED_OUT', 'LOST'] } } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } }, bets: { $sum: '$amount' }, wins: { $sum: '$payoutAmount' } } },
    ]),
    JiliTransaction.aggregate([
      { $match: { user: { $in: userIds }, createdAt: { $gte: start, $lt: end }, status: 'accepted', action: { $in: ['bet', 'sessionBet'] } } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } }, bets: { $sum: '$betAmount' }, wins: { $sum: '$winloseAmount' } } },
    ]),
    userCodes.length ? ProviderWalletTxn.aggregate([
      { $match: { userId: { $in: userCodes }, createdAt: { $gte: start, $lt: end }, status: 'success', type: { $in: ['debit', 'credit', 'rollback'] } } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, userId: '$userId', type: '$type' }, amountCents: { $sum: '$amountCents' } } },
    ]) : [],
  ]);

  for (const row of txRows) {
    const item = ensure(finalKey(row._id.day));
    if (row._id.type === 'DEPOSIT') item.deposits += Number(row.amount || 0);
    if (row._id.type === 'WITHDRAW') item.withdrawals += Number(row.amount || 0);
    if (row._id.type === 'BONUS') item.bonusCost += Number(row.amount || 0);
  }
  for (const row of refundRows) ensure(finalKey(row._id.day)).refundsVoidsChargebacks += Number(row.amount || 0);
  for (const row of [...internalRows, ...crashRows, ...jiliRows]) {
    const item = ensure(finalKey(row._id.day));
    item.bets += Number(row.bets || 0);
    item.wins += Number(row.wins || 0);
  }
  for (const row of providerRows) {
    if (!codeToUserId.has(row._id.userId) && row._id.userId) continue;
    const item = ensure(finalKey(row._id.day));
    const amount = Number(row.amountCents || 0) / 100;
    if (row._id.type === 'debit') item.bets += amount;
    if (row._id.type === 'credit' || row._id.type === 'rollback') item.wins += amount;
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).map((item) => {
    const ggr = roundMoney(item.bets - item.wins - item.bonusCost - item.refundsVoidsChargebacks);
    return {
      ...item,
      deposits: roundMoney(item.deposits),
      withdrawals: roundMoney(item.withdrawals),
      bets: roundMoney(item.bets),
      wins: roundMoney(item.wins),
      loss: roundMoney(Math.max(0, item.bets - item.wins)),
      bonusCost: roundMoney(item.bonusCost),
      refundsVoidsChargebacks: roundMoney(item.refundsVoidsChargebacks),
      ggr,
      commission: roundMoney(Math.max(0, ggr) * Number(commissionRate || 0)),
    };
  });
}

export function toCsv(rows, columns) {
  const esc = (value) => {
    const s = value == null ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.header)).join(','), ...rows.map((row) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(','))].join('\n');
}
