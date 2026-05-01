import CrashRound from '../models/CrashRound.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { crashEngine, roundPublic } from '../gameEngines/crashEngine.js';

export const getCrashState = asyncHandler(async (req, res) => {
  const state = await crashEngine.stateForUser(req.user?._id);
  res.json(state);
});

export const placeCrashBet = asyncHandler(async (req, res) => {
  const result = await crashEngine.placeBet(req.user._id, req.body.amount, req.body.autoCashout);
  res.status(201).json(result);
});

export const cashoutCrashBet = asyncHandler(async (req, res) => {
  const result = await crashEngine.cashout(req.user._id);
  res.json(result);
});

export const getCrashHistory = asyncHandler(async (_req, res) => {
  const rounds = await CrashRound.find({ status: 'CRASHED' }).sort({ crashedAt: -1, createdAt: -1 }).limit(50).select('+serverSeed');
  res.json({ success: true, rounds: rounds.map((round) => roundPublic(round, round.crashMultiplier)) });
});
