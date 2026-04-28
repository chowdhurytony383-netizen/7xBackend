import mongoose from 'mongoose';
import Game from '../models/Game.js';
import Bet from '../models/Bet.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { requireInteger, requireNumber, requireString } from '../utils/validation.js';
import { randomFloat0To100, randomInt, randomToken, hashValue } from '../utils/random.js';
import { creditWallet, debitWallet } from '../utils/wallet.js';

async function findGame(slug) {
  const game = await Game.findOne({ slug, isActive: true });
  if (!game) throw new AppError(`${slug} game is not active`, 404);
  return game;
}

export const getAllGames = asyncHandler(async (_req, res) => {
  const games = await Game.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ success: true, data: games, games });
});

export const rollDice = asyncHandler(async (req, res) => {
  const amount = requireNumber(req.body.amount, 'Bet amount', 1, 1_000_000);
  const condition = requireString(req.body.condition, 'Condition', 3, 10).toLowerCase();
  assertOrThrow(['above', 'below'].includes(condition), 'Condition must be above or below', 400);
  const target = requireNumber(req.body.target, 'Target', 1, 99);
  const game = await findGame('dice');

  await debitWallet(req.user._id, amount, 'dice-bet');

  const roll = randomFloat0To100();
  const isWin = condition === 'above' ? roll > target : roll < target;
  const chance = condition === 'above' ? 100 - target : target;
  const houseEdge = 0.98;
  const payoutMultiplier = Number((houseEdge * (100 / chance)).toFixed(4));
  const winAmount = isWin ? Number((amount * payoutMultiplier).toFixed(2)) : 0;
  if (isWin) await creditWallet(req.user._id, winAmount, 'dice-win');

  const bet = await Bet.create({
    user: req.user._id,
    game: game._id,
    gameName: 'dice',
    betAmount: amount,
    winAmount,
    isWin,
    status: isWin ? 'WIN' : 'LOSE',
    gameData: {
      diceRoll: {
        serverSeedHash: hashValue(randomToken(16)),
        state: { result: roll, condition, target },
        payoutMultiplier,
        payout: winAmount,
      },
    },
  });

  const populated = await bet.populate('game', 'name displayName image');
  res.json({ success: true, message: isWin ? 'Dice roll won' : 'Dice roll lost', bet: populated });
});

function generateMineBoard(minesCount) {
  const mines = new Set();
  while (mines.size < minesCount) mines.add(randomInt(0, 25));
  return [...mines];
}

function minesMultiplier(safeHits, minesCount) {
  if (safeHits <= 0) return 1;
  const safeTiles = 25 - minesCount;
  let probability = 1;
  for (let i = 0; i < safeHits; i += 1) {
    probability *= (safeTiles - i) / (25 - i);
  }
  return Number(((0.96 / probability)).toFixed(4));
}

export const startMines = asyncHandler(async (req, res) => {
  const amount = requireNumber(req.body.amount, 'Bet amount', 1, 1_000_000);
  const minesCount = requireInteger(req.body.minesCount, 'Mines count', 1, 24);
  const game = await findGame('mines');
  const pending = await Bet.findOne({ user: req.user._id, gameName: 'mines', status: 'PENDING' });
  assertOrThrow(!pending, 'You already have a pending mines game', 409);

  await debitWallet(req.user._id, amount, 'mines-start');
  const mines = generateMineBoard(minesCount);
  const serverSeed = randomToken(24);

  const bet = await Bet.create({
    user: req.user._id,
    game: game._id,
    gameName: 'mines',
    betAmount: amount,
    status: 'PENDING',
    gameData: {
      mineCount: minesCount,
      mines,
      revealedTiles: [],
      safeHits: 0,
      multiplier: 1,
      profit: 0,
      serverSeedHash: hashValue(serverSeed),
      serverSeed,
    },
  });

  res.status(201).json({ success: true, message: 'Mines game started', bet: bet._id, data: bet });
});

export const pendingMines = asyncHandler(async (req, res) => {
  const bet = await Bet.findOne({ user: req.user._id, gameName: 'mines', status: 'PENDING' }).populate('game', 'name displayName image');
  res.json({ success: true, bet });
});

export const revealMineTile = asyncHandler(async (req, res) => {
  const betId = requireString(req.body.betId, 'Bet ID', 6, 60);
  const tileIndex = requireInteger(req.body.tileIndex, 'Tile index', 0, 24);
  const bet = await Bet.findOne({ _id: betId, user: req.user._id, gameName: 'mines', status: 'PENDING' });
  assertOrThrow(bet, 'Pending mines game not found', 404);

  const gameData = bet.gameData || {};
  const revealed = Array.isArray(gameData.revealedTiles) ? gameData.revealedTiles : [];
  assertOrThrow(!revealed.includes(tileIndex), 'Tile already revealed', 400);

  const mines = Array.isArray(gameData.mines) ? gameData.mines : [];
  const isMine = mines.includes(tileIndex);
  const revealedTiles = [...revealed, tileIndex];

  if (isMine) {
    bet.status = 'LOSE';
    bet.isWin = false;
    bet.winAmount = 0;
    bet.gameData = { ...gameData, revealedTiles, hitMine: tileIndex, endedAt: new Date() };
    await bet.save();
    return res.json({ success: true, message: 'Mine revealed', isMine: true, revealedTiles, multiplier: 0, profit: 0, bet });
  }

  const safeHits = revealedTiles.length;
  const multiplier = minesMultiplier(safeHits, Number(gameData.mineCount || 3));
  const profit = Number((bet.betAmount * multiplier).toFixed(2));

  bet.gameData = { ...gameData, revealedTiles, safeHits, multiplier, profit };
  await bet.save();

  res.json({ success: true, message: 'Safe tile', isMine: false, revealedTiles, multiplier, profit, bet });
});

export const endMines = asyncHandler(async (req, res) => {
  const betId = requireString(req.body.betId, 'Bet ID', 6, 60);
  const bet = await Bet.findOne({ _id: betId, user: req.user._id, gameName: 'mines', status: 'PENDING' });
  assertOrThrow(bet, 'Pending mines game not found', 404);

  const gameData = bet.gameData || {};
  const safeHits = Number(gameData.safeHits || 0);
  assertOrThrow(safeHits > 0, 'Reveal at least one safe tile before cash out', 400);
  const multiplier = Number(gameData.multiplier || minesMultiplier(safeHits, Number(gameData.mineCount || 3)));
  const winAmount = Number((bet.betAmount * multiplier).toFixed(2));

  await creditWallet(req.user._id, winAmount, 'mines-cashout');

  bet.status = 'CASHED_OUT';
  bet.isWin = true;
  bet.winAmount = winAmount;
  bet.gameData = { ...gameData, multiplier, profit: winAmount, endedAt: new Date() };
  await bet.save();

  res.json({ success: true, message: 'Game ended', bet, winAmount });
});
