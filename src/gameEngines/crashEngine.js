import mongoose from 'mongoose';
import CrashRound from '../models/CrashRound.js';
import CrashBet from '../models/CrashBet.js';
import User from '../models/User.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { creditWallet } from '../utils/wallet.js';
import { recordWagerTurnover } from '../services/withdrawalGuardService.js';
import { recordReferralTurnover } from '../services/referralRewardService.js';
import { assertUserCanPlay } from '../utils/userPermissions.js';
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

const MIN_BET = Number(process.env.CRASH_MIN_BET || 1);
const MAX_BET = Number(process.env.CRASH_MAX_BET || 1000000);
const TICK_MS = Number(process.env.CRASH_TICK_MS || 50);
const STATE_MS = Number(process.env.CRASH_STATE_MS || 120);
const HISTORY_LIMIT = Number(process.env.CRASH_HISTORY_LIMIT || 16);
const CLIENT_SEED = process.env.CRASH_CLIENT_SEED || '7XBET-ASIA-CRUSH';
const VALID_SEATS = ['A', 'B'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeSeat(value) {
  const seat = String(value || 'A').trim().toUpperCase();
  return VALID_SEATS.includes(seat) ? seat : 'A';
}

function roundPublic(round, currentMultiplier = 1) {
  if (!round) return null;
  const plain = typeof round.toObject === 'function' ? round.toObject() : round;
  const startsAt = plain.startsAt ? new Date(plain.startsAt) : null;
  const waitMsLeft = plain.status === 'WAITING' && startsAt
    ? Math.max(0, startsAt.getTime() - Date.now())
    : 0;
  const elapsedMs = plain.status === 'RUNNING' && startsAt
    ? Math.max(0, Date.now() - startsAt.getTime())
    : 0;

  return {
    _id: plain._id,
    roundId: plain.roundId,
    nonce: plain.nonce,
    status: plain.status,
    startsAt: plain.startsAt,
    crashAt: plain.crashAt,
    crashedAt: plain.crashedAt,
    waitMsLeft,
    elapsedMs,
    currentMultiplier: Number(currentMultiplier || 1),
    multiplier: Number(currentMultiplier || 1),
    crashMultiplier: plain.status === 'CRASHED' ? Number(plain.crashMultiplier || 1) : null,
    crashPoint: plain.status === 'CRASHED' ? Number(plain.crashMultiplier || 1) : null,
    serverSeedHash: plain.serverSeedHash,
    serverSeed: plain.status === 'CRASHED' ? plain.serverSeed : undefined,
    clientSeed: plain.clientSeed || CLIENT_SEED,
    totalBets: Number(plain.totalBets || 0),
    totalBetAmount: money(plain.totalBetAmount || 0),
    totalPayoutAmount: money(plain.totalPayoutAmount || 0),
    activePlayers: Number(plain.activePlayers || 0),
  };
}

function betPublic(bet) {
  if (!bet) return null;
  const plain = typeof bet.toObject === 'function' ? bet.toObject() : bet;
  return {
    _id: plain._id,
    id: plain._id,
    roundId: plain.roundId,
    seat: plain.seat || 'A',
    amount: money(plain.amount),
    autoCashout: Number(plain.autoCashout || 0),
    status: plain.status,
    payoutMultiplier: Number(plain.payoutMultiplier || 0),
    payoutAmount: money(plain.payoutAmount || 0),
    payout: money(plain.payoutAmount || 0),
    crashMultiplier: Number(plain.crashMultiplier || 0),
    createdAt: plain.createdAt,
    cashedOutAt: plain.cashedOutAt,
  };
}

function numberFromBody(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildUserBetsMap(bets = []) {
  return VALID_SEATS.reduce((acc, seat) => {
    acc[seat] = betPublic(bets.find((bet) => normalizeSeat(bet.seat) === seat));
    return acc;
  }, {});
}

class CrashEngine {
  constructor() {
    this.io = null;
    this.round = null;
    this.running = false;
    this.loopPromise = null;
    this.lastStateEmit = 0;
    this.recentRounds = [];
    this.activeBetCache = new Map();
    this.settlingBetIds = new Set();
  }

  async init(io) {
    this.io = io;
    await this.recoverOpenRounds();
    await this.loadRecentRounds();
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop().catch((error) => {
      console.error('Crash engine loop failed:', error);
      this.running = false;
      setTimeout(() => this.start(), 1500);
    });
  }

  async recoverOpenRounds() {
    const openRounds = await CrashRound.find({ status: { $in: ['WAITING', 'RUNNING'] } }).select('+serverSeed');
    for (const round of openRounds) {
      round.status = 'CRASHED';
      round.crashedAt = new Date();
      await round.save();
      await CrashBet.updateMany(
        { round: round._id, status: 'ACTIVE' },
        { $set: { status: 'LOST', crashMultiplier: round.crashMultiplier } }
      );
    }
  }

  async loadRecentRounds() {
    this.recentRounds = await CrashRound.find({ status: 'CRASHED' })
      .sort({ crashedAt: -1, createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .select('+serverSeed');
  }

  async createRound() {
    const lastRound = await CrashRound.findOne().sort({ createdAt: -1 }).select('+serverSeed');
    const nonce = Number(lastRound?.nonce || 0) + 1;
    const serverSeed = randomServerSeed();
    const crashMultiplier = generateCrashMultiplier(`${serverSeed}:${CLIENT_SEED}`, nonce);
    const startsAt = new Date(Date.now() + WAIT_DURATION_MS);
    const crashAt = new Date(startsAt.getTime() + crashDurationMs(crashMultiplier));

    this.activeBetCache.clear();
    this.settlingBetIds.clear();

    this.round = await CrashRound.create({
      roundId: generateRoundId(),
      nonce,
      serverSeed,
      serverSeedHash: sha256(serverSeed),
      clientSeed: CLIENT_SEED,
      status: 'WAITING',
      startsAt,
      crashAt,
      crashMultiplier,
    });

    this.emitState(true);
    return this.round;
  }

  currentMultiplier(at = new Date()) {
    return currentMultiplierForRound(this.round, at);
  }

  async loop() {
    while (this.running) {
      const round = await this.createRound();

      while (Date.now() < new Date(round.startsAt).getTime()) {
        this.emitState();
        await sleep(STATE_MS);
      }

      round.status = 'RUNNING';
      await round.save();
      await this.cacheActiveBetsForRound(round._id);
      this.emitState(true);

      while (Date.now() < new Date(round.crashAt).getTime()) {
        const current = this.currentMultiplier();
        await this.processAutoCashouts(current);
        this.emitTick(current);
        await sleep(TICK_MS);
      }

      await this.crashCurrentRound();
      await sleep(CRASH_PAUSE_MS);
    }
  }

  async cacheActiveBetsForRound(roundId) {
    const active = await CrashBet.find({ round: roundId, status: 'ACTIVE' });
    this.activeBetCache.clear();
    active.forEach((bet) => this.activeBetCache.set(String(bet._id), bet));
  }

  emitTick(currentMultiplier) {
    const now = Date.now();
    if (this.io) {
      this.io.to('crash').emit('crash:tick', {
        serverTime: new Date().toISOString(),
        roundId: this.round?.roundId,
        status: this.round?.status,
        currentMultiplier,
        multiplier: currentMultiplier,
      });
    }
    if (now - this.lastStateEmit >= STATE_MS) this.emitState();
  }

  async crashCurrentRound() {
    if (!this.round || this.round.status === 'CRASHED') return;

    this.round.status = 'CRASHED';
    this.round.crashedAt = new Date();
    await this.round.save();

    await CrashBet.updateMany(
      { round: this.round._id, status: 'ACTIVE' },
      { $set: { status: 'LOST', crashMultiplier: this.round.crashMultiplier } }
    );

    for (const bet of this.activeBetCache.values()) {
      if (bet.status === 'ACTIVE') {
        bet.status = 'LOST';
        bet.crashMultiplier = this.round.crashMultiplier;
      }
    }

    await this.loadRecentRounds();
    this.emitState(true);
    if (this.io) {
      this.io.to('crash').emit('crash:crashed', {
        serverTime: new Date().toISOString(),
        round: roundPublic(this.round, this.round.crashMultiplier),
      });
    }
  }

  emitState(force = false) {
    const now = Date.now();
    if (!force && now - this.lastStateEmit < STATE_MS) return;
    this.lastStateEmit = now;
    if (!this.io) return;
    this.io.to('crash').emit('crash:state', this.publicState());
  }

  publicState() {
    const currentMultiplier = this.currentMultiplier();
    return {
      success: true,
      realtime: true,
      serverTime: new Date().toISOString(),
      round: roundPublic(this.round, currentMultiplier),
      activeBets: this.activeBetCache.size,
      activePlayers: new Set(Array.from(this.activeBetCache.values()).map((bet) => String(bet.user))).size,
      recentRounds: this.recentRounds.map((item) => roundPublic(item, item.crashMultiplier)),
      recent: this.recentRounds.map((item) => Number(item.crashMultiplier || 1)),
      limits: { minBet: MIN_BET, maxBet: MAX_BET },
      tickMs: TICK_MS,
      waitMs: WAIT_DURATION_MS,
    };
  }

  async stateForUser(userId) {
    const state = this.publicState();
    if (userId && this.round) {
      const [userBets, myBets, user] = await Promise.all([
        CrashBet.find({ user: userId, round: this.round._id }).sort({ createdAt: -1 }),
        CrashBet.find({ user: userId }).sort({ createdAt: -1 }).limit(20),
        User.findById(userId).select('wallet currency'),
      ]);
      state.userBets = buildUserBetsMap(userBets);
      state.userBet = state.userBets.A;
      state.myBets = myBets.map(betPublic);
      state.wallet = user ? { balance: money(user.wallet), currency: user.currency || 'BDT' } : null;
    } else {
      state.userBets = { A: null, B: null };
      state.userBet = null;
      state.myBets = [];
      state.wallet = null;
    }
    return state;
  }

  async placeBet(userId, amountValue, autoCashoutValue = 0, seatValue = 'A') {
    const seat = normalizeSeat(seatValue);
    const amount = money(numberFromBody(amountValue, 0));
    const autoCashout = Number(numberFromBody(autoCashoutValue, 0).toFixed(2));

    assertOrThrow(userId, 'Authentication required', 401);
    assertOrThrow(amount >= MIN_BET && amount <= MAX_BET, `Bet amount must be between ${MIN_BET} and ${MAX_BET}`, 400);
    if (autoCashout) assertOrThrow(autoCashout >= 1.01 && autoCashout <= 100, 'Auto cashout must be between 1.01x and 100x', 400);
    assertOrThrow(this.round?.status === 'WAITING', 'Betting is closed for this round. Wait for the next round.', 400);

    const account = await User.findById(userId).select('gameplayEnabled bettingEnabled status wallet currency');
    assertUserCanPlay(account);

    const session = await mongoose.startSession();
    let bet;
    let wallet;
    let debitSnapshotId = null;

    try {
      await session.withTransaction(async () => {
        const existing = await CrashBet.findOne({ user: userId, round: this.round._id, seat }).session(session);
        if (existing) throw new AppError(`You already placed a bet on Seat ${seat} in this round`, 409);

        const user = await User.findOneAndUpdate(
          { _id: userId, wallet: { $gte: amount }, status: 'active' },
          { $inc: { wallet: -amount } },
          { new: true, session }
        );
        if (!user) throw new AppError('Insufficient wallet balance', 400);
        wallet = user.wallet;

        const snapshot = await WalletSnapshot.create([{
          user: userId,
          walletAmount: user.wallet,
          actualWalletAfterBets: user.wallet,
          netBetResult: -amount,
          source: `crash-bet-seat-${seat}`,
        }], { session });
        debitSnapshotId = snapshot[0]._id;

        const created = await CrashBet.create([{
          user: userId,
          round: this.round._id,
          roundId: this.round.roundId,
          seat,
          amount,
          autoCashout,
          status: 'ACTIVE',
          debitSnapshot: debitSnapshotId,
        }], { session });
        bet = created[0];

        await CrashRound.updateOne(
          { _id: this.round._id },
          { $inc: { totalBets: 1, totalBetAmount: amount } },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    await recordWagerTurnover(userId, amount, 'crash-bet').catch((error) => {
      console.error('Crash turnover tracking failed:', error.message);
    });
    await recordReferralTurnover(userId, amount, 'crash-bet').catch((error) => {
      console.error('Crash referral tracking failed:', error.message);
    });

    this.activeBetCache.set(String(bet._id), bet);
    this.emitState(true);
    const result = { success: true, message: `Seat ${seat} crash bet placed`, bet: betPublic(bet), wallet: money(wallet) };
    if (this.io) this.io.to(`user:${userId}`).emit('crash:bet:placed', result);
    return result;
  }

  async cashout(userId, seatValue = 'A') {
    const seat = normalizeSeat(seatValue);
    assertOrThrow(userId, 'Authentication required', 401);
    assertOrThrow(this.round?.status === 'RUNNING', 'Cashout is available only while the round is running', 400);

    const currentMultiplier = this.currentMultiplier();
    if (currentMultiplier >= Number(this.round.crashMultiplier)) {
      await this.crashCurrentRound();
      throw new AppError('Round has already crashed', 400);
    }

    const activeBet = await CrashBet.findOne({ user: userId, round: this.round._id, seat, status: 'ACTIVE' });
    assertOrThrow(activeBet, `No active crash bet found on Seat ${seat}`, 404);
    return this.cashoutBet(activeBet, currentMultiplier, 'manual');
  }

  async processAutoCashouts(currentMultiplier) {
    const eligible = await CrashBet.find({
      round: this.round._id,
      status: 'ACTIVE',
      autoCashout: { $gt: 1, $lte: currentMultiplier },
    }).limit(250);

    for (const bet of eligible) {
      const multiplier = Math.min(Number(bet.autoCashout), currentMultiplier);
      await this.cashoutBet(bet, multiplier, 'auto').catch((error) => {
        console.error('Auto cashout failed:', error.message);
      });
    }
  }

  async cashoutBet(bet, multiplier, mode = 'manual') {
    const betId = String(bet._id);
    if (this.settlingBetIds.has(betId)) throw new AppError('Cashout already processing', 409);
    this.settlingBetIds.add(betId);

    try {
      const payoutAmount = money(Number(bet.amount) * Number(multiplier));
      const updatedBet = await CrashBet.findOneAndUpdate(
        { _id: bet._id, status: 'ACTIVE' },
        {
          $set: {
            status: 'CASHED_OUT',
            payoutMultiplier: Number(multiplier.toFixed(2)),
            payoutAmount,
            cashedOutAt: new Date(),
          },
        },
        { new: true }
      );
      if (!updatedBet) throw new AppError('Bet is no longer active', 409);

      const user = await creditWallet(updatedBet.user, payoutAmount, `crash-${mode}-cashout`, {
        turnoverSourceRef: updatedBet._id,
        turnoverMeta: { roundId: updatedBet.roundId, seat: updatedBet.seat, multiplier: Number(multiplier.toFixed(2)) },
      });
      await CrashRound.updateOne({ _id: this.round._id }, { $inc: { totalPayoutAmount: payoutAmount } });

      this.activeBetCache.delete(betId);
      this.emitState(true);

      const result = {
        success: true,
        message: `Cashed out Seat ${updatedBet.seat} at ${Number(multiplier).toFixed(2)}x`,
        bet: betPublic(updatedBet),
        wallet: money(user.wallet),
        mode,
      };

      if (this.io) {
        this.io.to(`user:${updatedBet.user}`).emit('crash:cashout:success', result);
      }

      return result;
    } finally {
      this.settlingBetIds.delete(betId);
    }
  }
}

export const crashEngine = new CrashEngine();
export { roundPublic, betPublic, MIN_BET, MAX_BET, normalizeSeat };
