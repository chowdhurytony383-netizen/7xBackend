import Bet from '../models/Bet.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getMyBets = asyncHandler(async (req, res) => {
  const bets = await Bet.find({ user: req.user._id }).populate('game', 'name displayName image').sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: bets, bets });
});

export const getMyBetsByGame = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.gameId) filter.game = req.query.gameId;
  const bets = await Bet.find(filter).populate('game', 'name displayName image').sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: bets, bets });
});

export const getMyBetStats = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id, status: { $ne: 'PENDING' } };
  const bets = await Bet.find(filter).sort({ createdAt: 1 });
  const totalWins = bets.filter((bet) => bet.isWin).length;
  const totalLose = bets.filter((bet) => !bet.isWin).length;
  const totalWinningAmount = bets.reduce((sum, bet) => sum + Number(bet.winAmount || 0) - Number(bet.betAmount || 0), 0);
  let streak = 0;
  for (let i = bets.length - 1; i >= 0; i -= 1) {
    if (bets[i].isWin) streak += 1;
    else break;
  }
  res.json({ totalWins, totalLose, totalWinningAmount, totalWinningStreak: streak });
});

export const getMyBetStatsByGame = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id, status: { $ne: 'PENDING' } };
  if (req.query.gameId) filter.game = req.query.gameId;
  const bets = await Bet.find(filter).sort({ createdAt: 1 });
  const totalWins = bets.filter((bet) => bet.isWin).length;
  const totalLose = bets.filter((bet) => !bet.isWin).length;
  const totalWinningAmount = bets.reduce((sum, bet) => sum + Number(bet.winAmount || 0) - Number(bet.betAmount || 0), 0);
  let streak = 0;
  for (let i = bets.length - 1; i >= 0; i -= 1) {
    if (bets[i].isWin) streak += 1;
    else break;
  }
  res.json({ totalWins, totalLose, totalWinningAmount, totalWinningStreak: streak });
});
