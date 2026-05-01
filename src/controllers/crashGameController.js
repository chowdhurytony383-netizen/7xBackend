import CrashRound from '../models/CrashRound.js';
import CrashBet from '../models/CrashBet.js';
import User from '../models/User.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { creditWallet, debitWallet } from '../utils/wallet.js';
import {
  CRASH_PAUSE_MS,
  WAIT_DURATION_MS,
  crashDurationMs,
  currentMultiplierForRound,
  generateCrashMultiplier,
  generateRoundId,
  randomServerSeed,
  sha256,
} from '../utils/crashGame.js';

const MIN_BET = 1;
const MAX_BET = 1000000;

function numberFromBody(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundPublic(round, currentMultiplier = 1) {
  if (!round) return null;
  const plain = typeof round.toObject === 'function' ? round.toObject() : round;
  return {
    _id: plain._id,
    roundId: plain.roundId,
    status: plain.status,
    startsAt: plain.startsAt,
    crashAt: plain.crashAt,
    crashedAt: plain.crashedAt,
    crashMultiplier: plain.status === 'CRASHED' ? plain.crashMultiplier : null,
    currentMultiplier,
    serverSeedHash: plain.serverSeedHash,
    serverSeed: plain.status === 'CRASHED' ? plain.serverSeed : undefined,
    totalBets: plain.totalBets || 0,
    totalBetAmount: plain.totalBetAmount || 0,
    totalPayoutAmount: plain.totalPayoutAmount || 0,
  };
}

async function settleLostBets(round) {
  await CrashBet.updateMany(
    { round: round._id, status: 'ACTIVE' },
    { $set: { status: 'LOST', crashMultiplier: round.crashMultiplier } }
  );
}

async function createRound() {
  const lastRound = await CrashRound.findOne().sort({ createdAt: -1 }).select('+serverSeed');
  const nonce = Number(lastRound?.nonce || 0) + 1;
  const serverSeed = randomServerSeed();
  const crashMultiplier = generateCrashMultiplier(serverSeed, nonce);
  const startsAt = new Date(Date.now() + WAIT_DURATION_MS);
  const crashAt = new Date(startsAt.getTime() + crashDurationMs(crashMultiplier));

  return CrashRound.create({
    roundId: generateRoundId(),
    nonce,
    serverSeed,
    serverSeedHash: sha256(serverSeed),
    status: 'WAITING',
    startsAt,
    crashAt,
    crashMultiplier,
  });
}

async function refreshRound(round) {
  if (!round) return round;
  const now = new Date();

  if (round.status === 'WAITING' && now >= round.startsAt) {
    round.status = 'RUNNING';
    await round.save();
  }

  if (round.status === 'RUNNING' && now >= round.crashAt) {
    round.status = 'CRASHED';
    round.crashedAt = round.crashAt;
    await round.save();
    await settleLostBets(round);
  }

  return round;
}

async function getCurrentRound() {
  let round = await CrashRound.findOne({ status: { $in: ['WAITING', 'RUNNING'] } })
    .sort({ createdAt: -1 })
    .select('+serverSeed');

  if (round) return refreshRound(round);

  const lastCrashed = await CrashRound.findOne({ status: 'CRASHED' }).sort({ crashedAt: -1, createdAt: -1 }).select('+serverSeed');
  if (lastCrashed) {
    const crashedAt = new Date(lastCrashed.crashedAt || lastCrashed.updatedAt).getTime();
    if (Date.now() - crashedAt < CRASH_PAUSE_MS) return lastCrashed;
  }

  return createRound();
}

async function autoCashoutEligible(round) {
  if (!round || round.status !== 'RUNNING') return;
  const currentMultiplier = currentMultiplierForRound(round);
  const bets = await CrashBet.find({
    round: round._id,
    status: 'ACTIVE',
    autoCashout: { $gt: 1, $lte: currentMultiplier },
  }).limit(100);

  for (const bet of bets) {
    const multiplier = Math.min(Number(bet.autoCashout), currentMultiplier);
    const payoutAmount = Number((bet.amount * multiplier).toFixed(2));
    bet.status = 'CASHED_OUT';
    bet.payoutMultiplier = multiplier;
    bet.payoutAmount = payoutAmount;
    bet.cashedOutAt = new Date();
    await bet.save();
    await creditWallet(bet.user, payoutAmount, 'crash-auto-cashout');
    await CrashRound.updateOne({ _id: round._id }, { $inc: { totalPayoutAmount: payoutAmount } });
  }
}

export const getCrashState = asyncHandler(async (req, res) => {
  const round = await getCurrentRound();
  await autoCashoutEligible(round);
  const refreshed = await refreshRound(round);
  const currentMultiplier = currentMultiplierForRound(refreshed);

  const [recentRounds, activePlayers, userBet, myBets] = await Promise.all([
    CrashRound.find({ status: 'CRASHED' }).sort({ crashedAt: -1, createdAt: -1 }).limit(12),
    CrashBet.countDocuments({ round: refreshed._id, status: 'ACTIVE' }),
    req.user ? CrashBet.findOne({ user: req.user._id, round: refreshed._id }).sort({ createdAt: -1 }) : null,
    req.user ? CrashBet.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(12) : [],
  ]);

  res.json({
    success: true,
    serverTime: new Date(),
    round: roundPublic(refreshed, currentMultiplier),
    activePlayers,
    userBet,
    myBets,
    recentRounds: recentRounds.map((item) => roundPublic(item, item.crashMultiplier)),
    limits: { minBet: MIN_BET, maxBet: MAX_BET },
  });
});

export const placeCrashBet = asyncHandler(async (req, res) => {
  const amount = Number(numberFromBody(req.body.amount, 0).toFixed(2));
  const autoCashout = Number(numberFromBody(req.body.autoCashout, 0).toFixed(2));

  assertOrThrow(amount >= MIN_BET && amount <= MAX_BET, `Bet amount must be between ${MIN_BET} and ${MAX_BET}`, 400);
  if (autoCashout) assertOrThrow(autoCashout >= 1.01 && autoCashout <= 100, 'Auto cashout must be between 1.01x and 100x', 400);

  const round = await refreshRound(await getCurrentRound());
  assertOrThrow(round.status === 'WAITING', 'Betting is closed for this round. Wait for the next round.', 400);

  const existing = await CrashBet.findOne({ user: req.user._id, round: round._id });
  assertOrThrow(!existing, 'You already placed a bet in this round', 409);

  await debitWallet(req.user._id, amount, 'crash-bet');

  const bet = await CrashBet.create({
    user: req.user._id,
    round: round._id,
    roundId: round.roundId,
    amount,
    autoCashout,
    status: 'ACTIVE',
  });

  await CrashRound.updateOne(
    { _id: round._id },
    { $inc: { totalBets: 1, totalBetAmount: amount } }
  );

  const user = await User.findById(req.user._id);
  res.status(201).json({ success: true, message: 'Crash bet placed', bet, wallet: user?.wallet });
});

export const cashoutCrashBet = asyncHandler(async (req, res) => {
  const round = await refreshRound(await getCurrentRound());
  assertOrThrow(round.status === 'RUNNING', 'Cashout is available only while the round is running', 400);

  const currentMultiplier = currentMultiplierForRound(round);
  if (currentMultiplier >= Number(round.crashMultiplier)) {
    await refreshRound(round);
    throw new AppError('Round has already crashed', 400);
  }

  const bet = await CrashBet.findOne({ user: req.user._id, round: round._id, status: 'ACTIVE' });
  assertOrThrow(bet, 'No active crash bet found for this round', 404);

  const payoutAmount = Number((bet.amount * currentMultiplier).toFixed(2));
  bet.status = 'CASHED_OUT';
  bet.payoutMultiplier = currentMultiplier;
  bet.payoutAmount = payoutAmount;
  bet.cashedOutAt = new Date();
  await bet.save();

  const user = await creditWallet(req.user._id, payoutAmount, 'crash-cashout');
  await CrashRound.updateOne({ _id: round._id }, { $inc: { totalPayoutAmount: payoutAmount } });

  res.json({ success: true, message: `Cashed out at ${currentMultiplier.toFixed(2)}x`, bet, wallet: user.wallet });
});

export const getCrashHistory = asyncHandler(async (_req, res) => {
  const rounds = await CrashRound.find({ status: 'CRASHED' }).sort({ crashedAt: -1, createdAt: -1 }).limit(50);
  res.json({ success: true, rounds: rounds.map((round) => roundPublic(round, round.crashMultiplier)) });
});
