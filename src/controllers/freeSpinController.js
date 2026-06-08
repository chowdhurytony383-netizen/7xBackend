import crypto from 'crypto';
import FreeSpinAccount from '../models/FreeSpinAccount.js';
import FreeSpinHistory from '../models/FreeSpinHistory.js';
import Transaction from '../models/Transaction.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/appError.js';
import { creditWallet } from '../utils/wallet.js';

const FREE_SPIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SCHEDULED_GRANT_AMOUNT = 1;
// Lazy accrual cap prevents a dormant account from receiving unlimited stored spins.
// Set FREE_SPIN_MAX_SCHEDULED_CATCHUP=0 to disable the cap.
const parsedCatchup = Number(process.env.FREE_SPIN_MAX_SCHEDULED_CATCHUP || 4);
const MAX_SCHEDULED_CATCHUP = Number.isFinite(parsedCatchup) ? Math.max(0, Math.floor(parsedCatchup)) : 4;

const WHEEL_SEGMENTS = [
  { id: 'seg-x2-a', label: '×2', resultKey: 'EXTRA_SPINS', weight: 10000, extraSpins: 2 },
  { id: 'seg-50000', label: '50,000', resultKey: 'LOCKED_50000', weight: 0, amount: 50000, locked: true },
  { id: 'seg-20', label: '20', resultKey: 'CASH_20', weight: 9334, amount: 20 },
  { id: 'seg-bomb-a', label: '💣', resultKey: 'BOMB', weight: 10000 },
  { id: 'seg-15', label: '15', resultKey: 'CASH_15', weight: 6000, amount: 15 },
  { id: 'seg-60', label: '60', resultKey: 'CASH_60', weight: 3333, amount: 60 },
  { id: 'seg-bomb-b', label: '💣', resultKey: 'BOMB', weight: 10000 },
  { id: 'seg-30', label: '30', resultKey: 'CASH_30', weight: 3333, amount: 30 },
  { id: 'seg-5', label: '5', resultKey: 'CASH_5', weight: 6000, amount: 5 },
  { id: 'seg-0', label: '0', resultKey: 'ZERO', weight: 20000 },
  { id: 'seg-25000', label: '25,000', resultKey: 'LOCKED_25000', weight: 0, amount: 25000, locked: true },
  { id: 'seg-10', label: '10', resultKey: 'CASH_10', weight: 6000, amount: 10 },
  { id: 'seg-3', label: '3', resultKey: 'CASH_3', weight: 6000, amount: 3 },
  { id: 'seg-x2-b', label: '×2', resultKey: 'EXTRA_SPINS', weight: 10000, extraSpins: 2 },
  { id: 'seg-5000', label: '5,000', resultKey: 'LOCKED_5000', weight: 0, amount: 5000, locked: true },
  { id: 'seg-bomb-c', label: '💣', resultKey: 'BOMB', weight: 0 },
];

const ACTIVE_SEGMENTS = WHEEL_SEGMENTS.filter((segment) => Number(segment.weight || 0) > 0);
const TOTAL_WEIGHT = ACTIVE_SEGMENTS.reduce((sum, segment) => sum + segment.weight, 0);

const GROUP_ODDS = [
  { label: '0 / Bomb / ×2', chance: 60, description: '0, bomb, and +2 free spins together.' },
  { label: '3 / 5 / 10 / 15 / 20', chance: 30, description: 'Small cash rewards group.' },
  { label: '20 / 30 / 60', chance: 10, description: 'Special cash rewards group.' },
];

function publicWheelSegments() {
  return WHEEL_SEGMENTS.map((segment, index) => ({
    id: segment.id,
    label: segment.label,
    index,
    locked: Boolean(segment.locked),
    active: Number(segment.weight || 0) > 0,
  }));
}

function sanitizeAccount(account) {
  const now = Date.now();
  const nextAt = account?.nextFreeSpinAt ? new Date(account.nextFreeSpinAt) : new Date(now + FREE_SPIN_INTERVAL_MS);
  const msUntilNextFreeSpin = Math.max(0, nextAt.getTime() - now);

  return {
    spinsAvailable: Number(account?.spinsAvailable || 0),
    nextFreeSpinAt: nextAt.toISOString(),
    msUntilNextFreeSpin,
    totalSpins: Number(account?.totalSpins || 0),
    totalCashReward: Number(account?.totalCashReward || 0),
    totalExtraSpinsWon: Number(account?.totalExtraSpinsWon || 0),
  };
}

function nextIntervalAfter(date, periods = 1) {
  return new Date(date.getTime() + FREE_SPIN_INTERVAL_MS * periods);
}

async function getOrCreateAccount(userId) {
  const now = new Date();

  return FreeSpinAccount.findOneAndUpdate(
    { user: userId },
    {
      $setOnInsert: {
        user: userId,
        spinsAvailable: SCHEDULED_GRANT_AMOUNT,
        nextFreeSpinAt: nextIntervalAfter(now),
        lastAutoGrantAt: now,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function applyScheduledGrant(account) {
  const now = new Date();
  const nextAt = account.nextFreeSpinAt ? new Date(account.nextFreeSpinAt) : now;

  if (nextAt.getTime() > now.getTime()) return account;

  const elapsedPeriods = Math.floor((now.getTime() - nextAt.getTime()) / FREE_SPIN_INTERVAL_MS) + 1;
  const periodsToGrant = MAX_SCHEDULED_CATCHUP > 0 ? Math.min(elapsedPeriods, MAX_SCHEDULED_CATCHUP) : elapsedPeriods;
  const grantAmount = periodsToGrant * SCHEDULED_GRANT_AMOUNT;
  const nextFreeSpinAt = nextIntervalAfter(nextAt, elapsedPeriods);

  return FreeSpinAccount.findByIdAndUpdate(
    account._id,
    {
      $inc: { spinsAvailable: grantAmount },
      $set: { nextFreeSpinAt, lastAutoGrantAt: now },
    },
    { new: true }
  );
}

async function loadFreshAccount(userId) {
  const account = await getOrCreateAccount(userId);
  return applyScheduledGrant(account);
}

function pickWeightedSegment() {
  const ticket = crypto.randomInt(1, TOTAL_WEIGHT + 1);
  let cursor = 0;

  for (const segment of ACTIVE_SEGMENTS) {
    cursor += segment.weight;
    if (ticket <= cursor) return segment;
  }

  return ACTIVE_SEGMENTS[0];
}

function normalizeResult(segment) {
  if (segment.resultKey === 'EXTRA_SPINS') {
    return {
      resultKey: 'EXTRA_SPINS',
      resultType: 'EXTRA_SPINS',
      label: '×2',
      amount: 0,
      extraSpinsAwarded: Number(segment.extraSpins || 2),
      message: 'You won 2 extra free spins!',
    };
  }

  if (segment.resultKey === 'BOMB') {
    return {
      resultKey: 'BOMB',
      resultType: 'BOMB',
      label: 'Bomb',
      amount: 0,
      extraSpinsAwarded: 0,
      message: 'Bomb blast! No reward this spin.',
    };
  }

  if (segment.resultKey === 'ZERO') {
    return {
      resultKey: 'ZERO',
      resultType: 'ZERO',
      label: '0',
      amount: 0,
      extraSpinsAwarded: 0,
      message: 'No reward this spin.',
    };
  }

  return {
    resultKey: segment.resultKey,
    resultType: 'CASH_REWARD',
    label: String(segment.amount || segment.label),
    amount: Number(segment.amount || 0),
    extraSpinsAwarded: 0,
    message: `You won ${segment.amount}!`,
  };
}

function buildStatusResponse(account, recent = []) {
  return {
    success: true,
    data: {
      account: sanitizeAccount(account),
      wheel: publicWheelSegments(),
      odds: GROUP_ODDS,
      recent,
      rules: {
        intervalHours: 6,
        scheduledGrantAmount: SCHEDULED_GRANT_AMOUNT,
        extraSpinAward: 2,
        note: 'Spin results are generated on the backend. Locked large-prize segments have 0% chance unless you change the backend weights.',
      },
    },
  };
}

export const getFreeSpinStatus = asyncHandler(async (req, res) => {
  const account = await loadFreshAccount(req.user._id);
  const recent = await FreeSpinHistory.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(12)
    .select('resultKey label amount extraSpinsAwarded createdAt')
    .lean();

  res.json(buildStatusResponse(account, recent));
});

export const spinFreeWheel = asyncHandler(async (req, res) => {
  await loadFreshAccount(req.user._id);

  const debitedAccount = await FreeSpinAccount.findOneAndUpdate(
    { user: req.user._id, spinsAvailable: { $gt: 0 } },
    { $inc: { spinsAvailable: -1, totalSpins: 1 }, $set: { lastSpinAt: new Date() } },
    { new: true }
  );

  if (!debitedAccount) {
    const account = await loadFreshAccount(req.user._id);
    throw new AppError('No free spins available right now', 400, { account: sanitizeAccount(account) });
  }

  const selectedSegment = pickWeightedSegment();
  const segmentIndex = WHEEL_SEGMENTS.findIndex((segment) => segment.id === selectedSegment.id);
  const result = normalizeResult(selectedSegment);

  let updatedAccount = debitedAccount;
  let updatedUser = null;
  let transaction = null;
  let rewardCredited = false;

  if (result.extraSpinsAwarded > 0) {
    updatedAccount = await FreeSpinAccount.findByIdAndUpdate(
      debitedAccount._id,
      {
        $inc: {
          spinsAvailable: result.extraSpinsAwarded,
          totalExtraSpinsWon: result.extraSpinsAwarded,
        },
      },
      { new: true }
    );
  }

  if (result.amount > 0) {
    updatedUser = await creditWallet(req.user._id, result.amount, 'free-spin-reward', {
      turnoverMeta: { source: 'free-spin', resultKey: result.resultKey },
    });
    rewardCredited = true;

    transaction = await Transaction.create({
      user: req.user._id,
      type: 'BONUS',
      amount: result.amount,
      status: 'SUCCESS',
      method: 'FREE_SPIN',
      currency: req.user.currency || updatedUser.currency || '',
      balanceType: 'MAIN',
      userNote: `Lucky Wheel reward: ${result.label}`,
      gatewayPayload: {
        source: 'free-spin',
        resultKey: result.resultKey,
        segmentId: selectedSegment.id,
      },
      processedAt: new Date(),
    });

    updatedAccount = await FreeSpinAccount.findByIdAndUpdate(
      debitedAccount._id,
      { $inc: { totalCashReward: result.amount } },
      { new: true }
    );
  }

  const history = await FreeSpinHistory.create({
    user: req.user._id,
    account: debitedAccount._id,
    resultKey: result.resultKey,
    label: result.label,
    segmentId: selectedSegment.id,
    segmentIndex,
    amount: result.amount,
    extraSpinsAwarded: result.extraSpinsAwarded,
    rewardCredited,
    transaction: transaction?._id,
    walletAfter: Number(updatedUser?.wallet ?? req.user.wallet ?? 0),
    spinsRemainingAfter: Number(updatedAccount?.spinsAvailable || 0),
    ipAddress: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });

  const safeUser = updatedUser?.toSafeObject ? updatedUser.toSafeObject() : updatedUser;

  res.json({
    success: true,
    message: result.message,
    data: {
      result: {
        ...result,
        segmentId: selectedSegment.id,
        segmentIndex,
        historyId: history._id,
      },
      account: sanitizeAccount(updatedAccount),
      user: safeUser,
      wheel: publicWheelSegments(),
      odds: GROUP_ODDS,
    },
  });
});
