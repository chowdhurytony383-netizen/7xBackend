import mongoose from 'mongoose';
import Game from '../models/Game.js';
import Bet from '../models/Bet.js';
import CrashBet from '../models/CrashBet.js';
import ProviderWalletTxn from '../models/ProviderWalletTxn.js';
import PgsoftTransaction from '../models/PgsoftTransaction.js';
import JiliTransaction from '../models/JiliTransaction.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { requireInteger, requireNumber, requireString } from '../utils/validation.js';
import { randomFloat0To100, randomInt, randomToken, hashValue } from '../utils/random.js';
import { creditWallet, debitWallet } from '../utils/wallet.js';
import { assertUserCanPlay } from '../utils/userPermissions.js';

async function findGame(slug) {
  const game = await Game.findOne({ slug, isActive: true });
  if (!game) throw new AppError(`${slug} game is not active`, 404);
  return game;
}

function asPlainGame(game = {}) {
  return typeof game.toObject === 'function' ? game.toObject() : game;
}

function normalizeGameKey(value) {
  return String(value || '').trim().toLowerCase();
}

function gameIdentityKeys(game = {}) {
  const raw = asPlainGame(game);
  const keys = new Set();

  [
    raw._id,
    raw.id,
    raw.name,
    raw.slug,
    raw.gameCode,
    raw.displayName,
    raw.config?.gameId,
    raw.config?.providerGame?.GameId,
    raw.config?.providerGame?.gameId,
  ].filter(Boolean).forEach((value) => keys.add(normalizeGameKey(value)));

  const provider = String(raw.provider || raw.config?.provider || '').toUpperCase();
  const gameId = raw.config?.gameId || raw.config?.providerGame?.GameId || raw.config?.providerGame?.gameId;

  if (provider === 'JILI' && gameId) {
    keys.add(`jili-${normalizeGameKey(gameId)}`);
    keys.add(`jili${normalizeGameKey(gameId)}`);
  }

  if (provider === 'PGSOFT' && gameId) {
    keys.add(`pgsoft-${normalizeGameKey(gameId)}`);
    keys.add(`pgsoft${normalizeGameKey(gameId)}`);
  }

  return [...keys].filter(Boolean);
}

function publicGamePayload(game = {}, extra = {}) {
  const raw = asPlainGame(game);
  return {
    ...raw,
    playCount: Number(extra.playCount || 0),
    lastPlayedAt: extra.lastPlayedAt || null,
  };
}

function addPopularScore(scoreMap, key, playCount = 1, lastPlayedAt = null) {
  const normalizedKey = normalizeGameKey(key);
  if (!normalizedKey) return;

  const current = scoreMap.get(normalizedKey) || { playCount: 0, lastPlayedAt: null };
  current.playCount += Number(playCount || 0);

  if (lastPlayedAt) {
    const nextDate = new Date(lastPlayedAt);
    const currentDate = current.lastPlayedAt ? new Date(current.lastPlayedAt) : null;
    if (!currentDate || nextDate > currentDate) current.lastPlayedAt = nextDate;
  }

  scoreMap.set(normalizedKey, current);
}

async function buildPopularGameScores() {
  const scoreMap = new Map();

  const [
    internalBets,
    jiliBets,
    pgsoftBets,
    providerWalletBets,
    crashBets,
  ] = await Promise.all([
    Bet.aggregate([
      { $match: { status: { $in: ['WIN', 'LOSE', 'CASHED_OUT', 'CANCELLED'] } } },
      { $group: { _id: '$game', playCount: { $sum: 1 }, lastPlayedAt: { $max: '$createdAt' } } },
      { $sort: { playCount: -1, lastPlayedAt: -1 } },
      { $limit: 100 },
    ]).catch(() => []),
    JiliTransaction.aggregate([
      { $match: { status: 'accepted', action: { $in: ['bet', 'sessionBet'] }, game: { $gt: 0 } } },
      { $group: { _id: '$game', playCount: { $sum: 1 }, lastPlayedAt: { $max: '$createdAt' } } },
      { $sort: { playCount: -1, lastPlayedAt: -1 } },
      { $limit: 150 },
    ]).catch(() => []),
    PgsoftTransaction.aggregate([
      { $match: { status: 'success', gameId: { $ne: '' } } },
      { $group: { _id: '$gameId', playCount: { $sum: 1 }, lastPlayedAt: { $max: '$createdAt' } } },
      { $sort: { playCount: -1, lastPlayedAt: -1 } },
      { $limit: 100 },
    ]).catch(() => []),
    ProviderWalletTxn.aggregate([
      { $match: { status: 'success', type: 'debit' } },
      { $group: { _id: '$slot', playCount: { $sum: 1 }, lastPlayedAt: { $max: '$createdAt' } } },
      { $sort: { playCount: -1, lastPlayedAt: -1 } },
      { $limit: 100 },
    ]).catch(() => []),
    CrashBet.aggregate([
      { $match: { status: { $in: ['LOST', 'CASHED_OUT', 'CANCELLED', 'AUTO_CASHED_OUT'] } } },
      { $group: { _id: 'crash', playCount: { $sum: 1 }, lastPlayedAt: { $max: '$createdAt' } } },
    ]).catch(() => []),
  ]);

  for (const item of internalBets) addPopularScore(scoreMap, item._id, item.playCount, item.lastPlayedAt);
  for (const item of jiliBets) {
    addPopularScore(scoreMap, `jili-${item._id}`, item.playCount, item.lastPlayedAt);
    addPopularScore(scoreMap, item._id, item.playCount, item.lastPlayedAt);
  }
  for (const item of pgsoftBets) {
    addPopularScore(scoreMap, `pgsoft-${item._id}`, item.playCount, item.lastPlayedAt);
    addPopularScore(scoreMap, item._id, item.playCount, item.lastPlayedAt);
  }
  for (const item of providerWalletBets) {
    if (item._id !== null && item._id !== undefined) {
      addPopularScore(scoreMap, `provider-${item._id}`, item.playCount, item.lastPlayedAt);
      addPopularScore(scoreMap, item._id, item.playCount, item.lastPlayedAt);
    }
  }
  for (const item of crashBets) addPopularScore(scoreMap, 'crash', item.playCount, item.lastPlayedAt);

  return scoreMap;
}

function pickPopularScoreForGame(game, scoreMap) {
  let best = { playCount: 0, lastPlayedAt: null };
  for (const key of gameIdentityKeys(game)) {
    const score = scoreMap.get(key);
    if (!score) continue;
    if (score.playCount > best.playCount) best = score;
  }
  return best;
}

export const getHomeGameSections = asyncHandler(async (req, res) => {
  const limit = Math.min(20, Math.max(1, Number(req.query.limit || 20)));

  const [activeGames, newGames, scoreMap] = await Promise.all([
    Game.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(800).lean(),
    Game.find({ isActive: true }).sort({ createdAt: -1, sortOrder: -1 }).limit(limit).lean(),
    buildPopularGameScores(),
  ]);

  const popularRanked = activeGames
    .map((game) => {
      const score = pickPopularScoreForGame(game, scoreMap);
      return { game, score };
    })
    .filter((item) => item.score.playCount > 0)
    .sort((a, b) => (
      (b.score.playCount - a.score.playCount)
      || (new Date(b.score.lastPlayedAt || 0) - new Date(a.score.lastPlayedAt || 0))
      || ((a.game.sortOrder || 0) - (b.game.sortOrder || 0))
    ))
    .slice(0, limit);

  const fallbackPopular = activeGames
    .filter((game) => !popularRanked.some((item) => String(item.game._id) === String(game._id)))
    .slice(0, Math.max(0, limit - popularRanked.length))
    .map((game) => ({ game, score: { playCount: 0, lastPlayedAt: null } }));

  const popularGames = [...popularRanked, ...fallbackPopular].slice(0, limit);

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    success: true,
    data: {
      newGames: newGames.map((game) => publicGamePayload(game)),
      popularGames: popularGames.map(({ game, score }) => publicGamePayload(game, score)),
    },
  });
});


export const getAllGames = asyncHandler(async (_req, res) => {
  const games = await Game.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ success: true, data: games, games });
});

export const rollDice = asyncHandler(async (req, res) => {
  assertUserCanPlay(req.user);
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
  assertUserCanPlay(req.user);
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
