import mongoose from 'mongoose';
import User from '../models/User.js';
import JiliTransaction from '../models/JiliTransaction.js';
import Game from '../models/Game.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertUserCanPlay } from '../utils/userPermissions.js';
import { recordWagerTurnover } from '../services/withdrawalGuardService.js';
import {
  findValidJiliToken,
  getJiliLaunchUrl,
  getJiliGameList,
  jiliError,
  jiliSuccess,
  normalizeCurrency,
  buildJiliUsername,
  getJiliPlayerCurrency,
} from '../services/jiliService.js';
import { env } from '../config/env.js';

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function stringValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function getReqBody(req) {
  return req.body || {};
}

function parseGameId(value) {
  const gameId = Number(value);
  if (!Number.isInteger(gameId) || gameId <= 0) return 0;
  return gameId;
}

function getClientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

function stripJiliUsernameToUserId(username = '') {
  const raw = String(username || '').trim();
  const prefix = String(env.JILI_USERNAME_PREFIX || '7xbet_').replace(/[^a-zA-Z0-9_]/g, '');
  let value = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;

  // Supports the new multi-currency username format: 7xbet_inr_USERID, 7xbet_usd_USERID, etc.
  value = value.replace(/^[a-zA-Z]{3,5}_/, '');
  return value;
}

function formatBalance(userOrBalance) {
  if (typeof userOrBalance === 'number') return money(userOrBalance);
  return money(userOrBalance?.wallet || 0);
}

function generateJiliTxId() {
  // JILI examples use bigint-style numeric txId.
  // A Mongo ObjectId string can be rejected by some game clients, so keep it numeric.
  const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${Date.now()}${suffix}`;
}

function responseTxId(value) {
  const text = String(value || '');
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    if (Number.isSafeInteger(number)) return number;
  }
  return text;
}

function buildDuplicateResponse(existing, message = 'already accepted', errorCode = 0) {
  const response = existing?.response || {};
  return {
    errorCode,
    message: response?.message || message,
    username: response?.username || existing?.username || '',
    currency: response?.currency || existing?.currency || env.JILI_CURRENCY || 'BDT',
    balance: money(response?.balance ?? existing?.balanceAfter ?? 0),
    txId: responseTxId(response?.txId || existing?.txId),
    token: response?.token || existing?.token || undefined,
  };
}

async function findUserByTokenOrUserId({ token, userId }) {
  const tokenRecord = await findValidJiliToken(token);
  if (tokenRecord) {
    return {
      user: tokenRecord.user,
      username: tokenRecord.username,
      currency: tokenRecord.currency,
      tokenRecord,
    };
  }

  if (userId) {
    const username = String(userId).trim();
    const possibleUserId = stripJiliUsernameToUserId(username);

    const user = await User.findOne({
      status: 'active',
      $or: [
        { userId: possibleUserId },
        { username: possibleUserId },
        { userId: username },
        { username },
      ],
    });

    if (user) {
      const playerCurrency = getJiliPlayerCurrency(user);
      const expectedNewUsername = buildJiliUsername(user, playerCurrency);
      const expectedLegacyUsername = `${String(env.JILI_USERNAME_PREFIX || '7xbet_').replace(/[^a-zA-Z0-9_]/g, '')}${String(user.userId || user.username || user._id || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 42)}`.slice(0, 50);

      if (expectedNewUsername === username || expectedLegacyUsername === username || possibleUserId === user.userId || possibleUserId === user.username) {
        return {
          user,
          username,
          currency: playerCurrency,
          tokenRecord: null,
        };
      }
    }
  }

  return null;
}

function validateCurrency(requestCurrency, playerCurrency) {
  const expected = normalizeCurrency(playerCurrency);
  const received = normalizeCurrency(requestCurrency || expected);
  return expected === received;
}


const CATEGORY_ID_MAP_FOR_SYNC = {
  1: { category: 'slots', label: 'Slots' },
  2: { category: 'cards', label: 'Card / Poker' },
  3: { category: 'arcade', label: 'Arcade / Lobby' },
  5: { category: 'fish', label: 'Fishing' },
  8: { category: 'casino', label: 'Table / Casino' },
};

const FALLBACK_JILI_IMAGES = {
  slots: '/images/others/banner1.png',
  fish: '/images/others/banner2.png',
  casino: '/images/others/banner3.png',
  crash: '/images/others/banner4.png',
  cards: '/images/others/banner5.png',
  arcade: '/images/others/banner1.png',
};

function getLocalJiliImagePath(gameId) {
  const id = Number(gameId);
  if (!Number.isFinite(id) || id <= 0) return '';
  return `/images/jili/${id}.webp`;
}

function isJiliFallbackImage(value = '') {
  const image = String(value || '').trim();
  return Object.values(FALLBACK_JILI_IMAGES).includes(image);
}

function slugifyJiliGame(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'jili-game';
}

function pickJiliName(raw = {}) {
  const candidates = [
    raw.displayName,
    raw.Name,
    raw.GameName,
    raw.name,
    raw.gameName,
    raw.title,
    raw.config?.providerGame?.Name,
    raw.config?.providerGame?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().replace(/^JILI\s+/i, '');
    if (candidate && typeof candidate === 'object') {
      const value = candidate['en-US'] || candidate.en_US || candidate.en || candidate.English || candidate['zh-CN'] || candidate['zh-TW'];
      if (value) return String(value).trim().replace(/^JILI\s+/i, '');
    }
  }

  return '';
}

function pickJiliGameId(raw = {}) {
  return raw.GameId || raw.gameId || raw.GameID || raw.id || raw.game || raw.config?.gameId || raw.config?.providerGame?.GameId;
}

function pickJiliTypeText(raw = {}) {
  return String(
    raw.Type
    || raw.type
    || raw.GameType
    || raw.gameType
    || raw.Category
    || raw.category
    || raw.categoryLabel
    || raw.GameCategoryName
    || raw.gameCategoryName
    || raw.config?.categoryLabel
    || raw.config?.providerGame?.Type
    || raw.config?.providerGame?.type
    || raw.config?.providerGame?.Category
    || raw.config?.providerGame?.category
    || ''
  ).trim();
}

function pickJiliCategoryId(raw = {}) {
  const value = raw.GameCategoryId
    || raw.gameCategoryId
    || raw.categoryId
    || raw.gameCategory
    || raw.config?.providerGame?.GameCategoryId
    || raw.config?.providerGame?.gameCategoryId;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pickJiliCategoryInfo(raw = {}) {
  const typeText = pickJiliTypeText(raw).toLowerCase();

  if (typeText.includes('fish')) return { category: 'fish', label: 'Fishing' };
  if (typeText.includes('crash') || typeText.includes('mines') || typeText.includes('plinko') || typeText.includes('limbo')) return { category: 'crash', label: 'Crash' };
  if (typeText.includes('card') || typeText.includes('poker') || typeText.includes('rummy') || typeText.includes('teenpatti') || typeText.includes('andar')) return { category: 'cards', label: 'Card / Poker' };
  if (typeText.includes('slot')) return { category: 'slots', label: 'Slots' };
  if (typeText.includes('arcade') || typeText.includes('lobby')) return { category: 'arcade', label: 'Arcade / Lobby' };
  if (typeText.includes('casino') || typeText.includes('table') || typeText.includes('bingo') || typeText.includes('roulette') || typeText.includes('baccarat') || typeText.includes('sic bo') || typeText.includes('keno')) return { category: 'casino', label: 'Table / Casino' };

  return CATEGORY_ID_MAP_FOR_SYNC[pickJiliCategoryId(raw)] || { category: 'casino', label: 'Table / Casino' };
}

function boolFromJili(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = String(value ?? '').toLowerCase();
  return ['true', 'yes', 'y', '1'].includes(text);
}

function isUsableJiliImage(value) {
  if (!value || typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  if (/^(icon|download|material)$/i.test(text)) return false;
  return /^(https?:)?\/\//i.test(text) || text.startsWith('/') || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(text);
}

function pickJiliImage(raw = {}) {
  const providerGame = raw.config?.providerGame || {};
  const candidates = [
    raw.image,
    raw.Image,
    raw.icon,
    raw.Icon,
    raw.thumbnail,
    raw.thumb,
    raw.logo,
    raw.picture,
    raw.cover,
    raw.banner,
    raw.displayImage,
    raw.imageUrl,
    raw.iconUrl,
    raw.IconUrl,
    raw.GameIcon,
    raw.gameIcon,
    providerGame.image,
    providerGame.Image,
    providerGame.icon,
    providerGame.Icon,
    providerGame.thumbnail,
    providerGame.imageUrl,
    providerGame.iconUrl,
    providerGame.IconUrl,
    providerGame.GameIcon,
    providerGame.gameIcon,
  ];

  const found = candidates.find(isUsableJiliImage);
  return found ? String(found).trim() : '';
}

function normalizeJiliProviderGame(raw = {}, index = 0) {
  const numericGameId = Number(pickJiliGameId(raw));
  if (!Number.isFinite(numericGameId) || numericGameId <= 0) return null;

  const name = pickJiliName(raw) || `JILI Game ${numericGameId}`;
  const categoryInfo = pickJiliCategoryInfo(raw);
  const slug = `jili-${slugifyJiliGame(name)}-${numericGameId}`;
  const gameCode = `jili-${numericGameId}`;
  const sorting = Number(raw.Sorting ?? raw.sorting ?? raw.Sort ?? raw.sortOrder ?? raw.config?.providerGame?.Sorting ?? 1000 + index);
  const providerImage = pickJiliImage(raw);
  const localImage = getLocalJiliImagePath(numericGameId);
  const image = providerImage || localImage || FALLBACK_JILI_IMAGES[categoryInfo.category] || FALLBACK_JILI_IMAGES.casino;

  return {
    gameId: numericGameId,
    providerImage,
    name,
    slug,
    gameCode,
    category: categoryInfo.category,
    categoryLabel: categoryInfo.label,
    typeText: pickJiliTypeText(raw),
    sortOrder: Number.isFinite(sorting) ? sorting : 1000 + index,
    image,
    jp: boolFromJili(raw.JP ?? raw.jp ?? raw.config?.providerGame?.JP),
    freeSpin: boolFromJili(raw.Freespin ?? raw.FreeSpin ?? raw.freespin ?? raw.config?.providerGame?.Freespin),
    raw,
  };
}

async function syncJiliGamesFromProvider({ deactivateStale = false } = {}) {
  const providerGames = await getJiliGameList();
  const normalized = providerGames
    .map((game, index) => normalizeJiliProviderGame(game, index))
    .filter(Boolean);

  const uniqueGames = [];
  const seen = new Set();

  for (const game of normalized) {
    if (seen.has(game.gameId)) continue;
    seen.add(game.gameId);
    uniqueGames.push(game);
  }

  let inserted = 0;
  let updated = 0;

  for (const game of uniqueGames) {
    const existingGame = await Game.findOne({ gameCode: game.gameCode }).select('_id image').lean();
    const preservedImage = existingGame?.image && !game.providerImage && !isJiliFallbackImage(existingGame.image)
      ? existingGame.image
      : game.image;

    const payload = {
      name: game.slug,
      slug: game.slug,
      displayName: `JILI ${game.name}`,
      gameCode: game.gameCode,
      description: `${game.categoryLabel} game from JILI Seamless Wallet. Balance is settled through single wallet callbacks.`,
      image: preservedImage,
      category: game.category,
      type: 'provider',
      distribution: 'provider',
      provider: 'JILI',
      route: `/jili/${game.gameId}`,
      isActive: true,
      sortOrder: game.sortOrder,
      config: {
        provider: 'JILI',
        gameId: game.gameId,
        currency: env.JILI_CURRENCY || 'BDT',
        categoryLabel: game.categoryLabel,
        typeText: game.typeText,
        jp: game.jp,
        freeSpin: game.freeSpin,
        providerGame: game.raw,
        syncedAt: new Date(),
        imageSourcePreserved: Boolean(existingGame?.image && !game.providerImage),
      },
    };

    await Game.findOneAndUpdate(
      { gameCode: game.gameCode },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (existingGame) updated += 1;
    else inserted += 1;
  }

  let deactivated = 0;
  if (deactivateStale && uniqueGames.length) {
    const activeCodes = uniqueGames.map((game) => game.gameCode);
    const result = await Game.updateMany(
      { provider: 'JILI', gameCode: { $nin: activeCodes } },
      { $set: { isActive: false } }
    );
    deactivated = result.modifiedCount || 0;
  }

  const totalActiveGames = await Game.countDocuments({ provider: 'JILI', isActive: true });

  return {
    providerCount: providerGames.length,
    syncedCount: uniqueGames.length,
    inserted,
    updated,
    deactivated,
    totalActiveGames,
  };
}

async function getJiliGamesFromDatabase() {
  const rows = await Game.find({
    provider: 'JILI',
    isActive: true,
  })
    .sort({ sortOrder: 1, displayName: 1 })
    .lean();

  return rows.map((game) => ({
    GameId: game.config?.gameId || String(game.gameCode || '').replace(/^jili-/, ''),
    Name: String(game.displayName || '').replace(/^JILI\s+/i, ''),
    Type: game.config?.typeText || game.config?.categoryLabel || game.category || 'JILI',
    GameCategoryId: game.config?.providerGame?.GameCategoryId || game.config?.providerGame?.gameCategoryId || undefined,
    image: game.image,
    category: game.category,
    categoryLabel: game.config?.categoryLabel,
    Sorting: game.sortOrder,
    JP: Boolean(game.config?.jp),
    Freespin: Boolean(game.config?.freeSpin),
    config: game.config,
  }));
}


export const launchJiliGame = asyncHandler(async (req, res) => {
  assertUserCanPlay(req.user);

  const gameId = parseGameId(req.body.gameId || req.params.gameId || req.query.gameId);
  if (!gameId) {
    return res.status(400).json({ success: false, message: 'Valid JILI gameId is required.' });
  }

  const lang = stringValue(req.body.lang || req.query.lang || env.JILI_DEFAULT_LANG || 'en-US');
  const platform = stringValue(req.body.platform || req.query.platform || 'WEB');

  const result = await getJiliLaunchUrl({
    user: req.user,
    gameId,
    lang,
    platform,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || '',
  });

  return res.json({
    success: true,
    launchUrl: result.launchUrl,
    gameId,
    provider: 'JILI',
  });
});

export const listJiliGames = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const dbGames = await getJiliGamesFromDatabase();

  if (dbGames.length) {
    return res.json({
      success: true,
      source: 'database',
      data: dbGames,
      games: dbGames,
    });
  }

  const providerGames = await getJiliGameList();
  return res.json({
    success: true,
    source: 'provider-live-fallback',
    data: providerGames,
    games: providerGames,
  });
});

export const syncJiliGames = asyncHandler(async (req, res) => {
  const result = await syncJiliGamesFromProvider({ deactivateStale: req.query.deactivateStale === 'true' });

  res.json({
    success: true,
    message: `JILI games synced. Provider: ${result.providerCount}, active unique: ${result.syncedCount}, inserted: ${result.inserted}, updated: ${result.updated}.`,
    data: result,
  });
});

export const authJiliPlayer = asyncHandler(async (req, res) => {
  const body = getReqBody(req);
  const token = stringValue(body.token);

  const tokenRecord = await findValidJiliToken(token);
  if (!tokenRecord) {
    return res.json(jiliError(4, 'Token expired'));
  }

  const user = tokenRecord.user;
  const response = jiliSuccess({
    username: tokenRecord.username,
    currency: tokenRecord.currency,
    balance: formatBalance(user),
    token,
  });

  return res.json(response);
});

export const acceptJiliBet = asyncHandler(async (req, res) => {
  const body = getReqBody(req);
  const reqId = stringValue(body.reqId);
  const token = stringValue(body.token);
  const currency = normalizeCurrency(body.currency || env.JILI_CURRENCY || 'BDT');
  const game = Number(body.game || 0);
  const round = stringValue(body.round);
  const betAmount = money(body.betAmount);
  const winloseAmount = money(body.winloseAmount);

  if (!reqId || !token || !round || betAmount < 0 || winloseAmount < 0) {
    return res.json(jiliError(3, 'Invalid parameter'));
  }

  const duplicate = await JiliTransaction.findOne({
    $or: [
      { action: 'bet', round },
      { action: 'bet', reqId },
    ],
  });

  if (duplicate) {
    return res.json(buildDuplicateResponse(duplicate, 'already accepted', 0));
  }

  const identity = await findUserByTokenOrUserId({ token, userId: body.userId });
  if (!identity) {
    return res.json(jiliError(4, 'Token expired'));
  }

  if (!validateCurrency(currency, identity.currency)) {
    return res.json(jiliError(3, 'Currency mismatch'));
  }

  const session = await mongoose.startSession();

  try {
    let response;
    let savedTransaction;

    await session.withTransaction(async () => {
      const currentUser = await User.findById(identity.user._id).session(session);
      if (!currentUser || currentUser.status !== 'active') {
        response = jiliError(4, 'Token expired');
        return;
      }

      const balanceBefore = formatBalance(currentUser);
      if (balanceBefore < betAmount) {
        response = jiliError(2, 'Not enough balance', {
          username: identity.username,
          currency: identity.currency,
          balance: balanceBefore,
        });
        return;
      }

      const delta = money(-betAmount + winloseAmount);
      currentUser.wallet = money(Number(currentUser.wallet || 0) + delta);
      await currentUser.save({ session });

      const tx = new JiliTransaction({
        action: 'bet',
        reqId,
        token,
        user: currentUser._id,
        username: identity.username,
        currency: identity.currency,
        game,
        round,
        betAmount,
        winloseAmount,
        turnoverAmount: betAmount,
        walletDelta: delta,
        balanceBefore,
        balanceAfter: formatBalance(currentUser),
        rawRequest: body,
        status: 'accepted',
        errorCode: 0,
        message: 'success',
        txId: generateJiliTxId(),
      });

      response = jiliSuccess({
        username: identity.username,
        currency: identity.currency,
        balance: currentUser.wallet,
        txId: responseTxId(tx.txId),
        token,
      });

      tx.response = response;
      savedTransaction = await tx.save({ session });
    });

    if (savedTransaction && betAmount > 0 && !body.isFreeRound) {
      await recordWagerTurnover(identity.user._id, betAmount, 'jili-casino-bet').catch((error) => {
        console.error('JILI turnover tracking failed:', error.message);
      });
    }

    return res.json(response || jiliError(5, 'Other error'));
  } finally {
    await session.endSession();
  }
});

export const cancelJiliBet = asyncHandler(async (req, res) => {
  const body = getReqBody(req);
  const reqId = stringValue(body.reqId);
  const token = stringValue(body.token);
  const round = stringValue(body.round);
  const currency = normalizeCurrency(body.currency || env.JILI_CURRENCY || 'BDT');
  const game = Number(body.game || 0);
  const betAmount = money(body.betAmount);
  const winloseAmount = money(body.winloseAmount);

  if (!reqId || !round || betAmount < 0 || winloseAmount < 0) {
    return res.json(jiliError(3, 'Invalid parameter'));
  }

  const alreadyCancelled = await JiliTransaction.findOne({
    $or: [
      { action: 'cancelBet', round },
      { action: 'cancelBet', reqId },
    ],
  });
  if (alreadyCancelled) return res.json(buildDuplicateResponse(alreadyCancelled, 'already canceled', 0));

  const original = await JiliTransaction.findOne({ action: 'bet', round, status: 'accepted' });
  if (!original) return res.json(jiliError(2, 'Round not found'));

  const identity = await findUserByTokenOrUserId({ token, userId: body.userId || original.username });
  if (!identity && !original.user) return res.json(jiliError(4, 'Token expired'));

  const userId = identity?.user?._id || original.user;
  const username = identity?.username || original.username;
  const playerCurrency = identity?.currency || original.currency || env.JILI_CURRENCY || 'BDT';
  if (!validateCurrency(currency, playerCurrency)) return res.json(jiliError(3, 'Currency mismatch'));

  const session = await mongoose.startSession();

  try {
    let response;

    await session.withTransaction(async () => {
      const currentUser = await User.findById(userId).session(session);
      if (!currentUser) {
        response = jiliError(4, 'Token expired');
        return;
      }

      const balanceBefore = formatBalance(currentUser);
      const delta = money(betAmount - winloseAmount);
      if (delta < 0 && balanceBefore < Math.abs(delta)) {
        response = jiliError(6, 'Cancel refused', {
          username,
          currency: playerCurrency,
          balance: balanceBefore,
        });
        return;
      }

      currentUser.wallet = money(Number(currentUser.wallet || 0) + delta);
      await currentUser.save({ session });

      const tx = new JiliTransaction({
        action: 'cancelBet',
        reqId,
        token,
        user: currentUser._id,
        username,
        currency: playerCurrency,
        game,
        round,
        originalRound: round,
        betAmount,
        winloseAmount,
        walletDelta: delta,
        balanceBefore,
        balanceAfter: formatBalance(currentUser),
        rawRequest: body,
        status: 'cancelled',
        errorCode: 0,
        message: 'success',
        txId: generateJiliTxId(),
      });

      response = jiliSuccess({ username, currency: playerCurrency, balance: currentUser.wallet, txId: responseTxId(tx.txId) });
      tx.response = response;
      await tx.save({ session });
    });

    return res.json(response || jiliError(5, 'Other error'));
  } finally {
    await session.endSession();
  }
});

export const acceptJiliSessionBet = asyncHandler(async (req, res) => {
  const body = getReqBody(req);
  const reqId = stringValue(body.reqId);
  const token = stringValue(body.token);
  const round = stringValue(body.round);
  const sessionId = stringValue(body.sessionId);
  const type = Number(body.type || 0);
  const currency = normalizeCurrency(body.currency || env.JILI_CURRENCY || 'BDT');
  const game = Number(body.game || 0);
  const betAmount = money(body.betAmount);
  const winloseAmount = money(body.winloseAmount);
  const turnoverAmount = money(body.turnover || betAmount);
  const preserve = money(body.preserve);

  if (!reqId || !token || !round || !sessionId || ![1, 2].includes(type)) {
    return res.json(jiliError(3, 'Invalid parameter'));
  }

  const duplicate = await JiliTransaction.findOne({
    $or: [
      { action: 'sessionBet', round },
      { action: 'sessionBet', reqId },
    ],
  });
  if (duplicate) return res.json(buildDuplicateResponse(duplicate, 'already accepted', 0));

  const identity = await findUserByTokenOrUserId({ token, userId: body.userId });
  if (!identity) return res.json(jiliError(4, 'Token expired'));
  if (!validateCurrency(currency, identity.currency)) return res.json(jiliError(3, 'Currency mismatch'));

  const session = await mongoose.startSession();

  try {
    let response;
    let savedTransaction;

    await session.withTransaction(async () => {
      const currentUser = await User.findById(identity.user._id).session(session);
      if (!currentUser || currentUser.status !== 'active') {
        response = jiliError(4, 'Token expired');
        return;
      }

      const balanceBefore = formatBalance(currentUser);
      let delta = 0;
      let requiredBalance = 0;

      if (type === 1) {
        delta = preserve > 0 ? money(-preserve) : money(-betAmount);
        requiredBalance = Math.abs(delta);
      } else if (type === 2) {
        delta = preserve > 0 ? money(preserve - betAmount + winloseAmount) : money(winloseAmount);
        requiredBalance = delta < 0 ? Math.abs(delta) : 0;
      }

      if (requiredBalance > 0 && balanceBefore < requiredBalance) {
        response = jiliError(2, 'Not enough balance', {
          username: identity.username,
          currency: identity.currency,
          balance: balanceBefore,
        });
        return;
      }

      currentUser.wallet = money(Number(currentUser.wallet || 0) + delta);
      await currentUser.save({ session });

      const tx = new JiliTransaction({
        action: 'sessionBet',
        reqId,
        token,
        user: currentUser._id,
        username: identity.username,
        currency: identity.currency,
        game,
        round,
        sessionId,
        sessionType: type,
        betAmount,
        winloseAmount,
        turnoverAmount: type === 2 ? turnoverAmount : betAmount,
        preserve,
        walletDelta: delta,
        balanceBefore,
        balanceAfter: formatBalance(currentUser),
        rawRequest: body,
        status: 'accepted',
        errorCode: 0,
        message: 'success',
        txId: generateJiliTxId(),
      });

      response = jiliSuccess({
        username: identity.username,
        currency: identity.currency,
        balance: currentUser.wallet,
        txId: responseTxId(tx.txId),
        token,
      });
      tx.response = response;
      savedTransaction = await tx.save({ session });
    });

    if (savedTransaction && savedTransaction.sessionType === 2) {
      const wager = money(savedTransaction.turnoverAmount || 0);
      if (wager > 0) {
        await recordWagerTurnover(identity.user._id, wager, 'jili-casino-bet').catch((error) => {
          console.error('JILI session turnover tracking failed:', error.message);
        });
      }
    }

    return res.json(response || jiliError(5, 'Other error'));
  } finally {
    await session.endSession();
  }
});

export const cancelJiliSessionBet = asyncHandler(async (req, res) => {
  const body = getReqBody(req);
  const reqId = stringValue(body.reqId);
  const token = stringValue(body.token);
  const round = stringValue(body.round);
  const sessionId = stringValue(body.sessionId);
  const currency = normalizeCurrency(body.currency || env.JILI_CURRENCY || 'BDT');
  const game = Number(body.game || 0);
  const betAmount = money(body.betAmount);
  const preserve = money(body.preserve);

  if (!reqId || !round || !sessionId) return res.json(jiliError(3, 'Invalid parameter'));

  const alreadyCancelled = await JiliTransaction.findOne({
    $or: [
      { action: 'cancelSessionBet', round },
      { action: 'cancelSessionBet', reqId },
    ],
  });
  if (alreadyCancelled) return res.json(buildDuplicateResponse(alreadyCancelled, 'already canceled', 0));

  const original = await JiliTransaction.findOne({ action: 'sessionBet', round, status: 'accepted' });
  if (!original) return res.json(jiliError(2, 'Round not found'));

  const identity = await findUserByTokenOrUserId({ token, userId: body.userId || original.username });
  const userId = identity?.user?._id || original.user;
  const username = identity?.username || original.username;
  const playerCurrency = identity?.currency || original.currency || env.JILI_CURRENCY || 'BDT';
  if (!validateCurrency(currency, playerCurrency)) return res.json(jiliError(3, 'Currency mismatch'));

  const session = await mongoose.startSession();

  try {
    let response;

    await session.withTransaction(async () => {
      const currentUser = await User.findById(userId).session(session);
      if (!currentUser) {
        response = jiliError(4, 'Token expired');
        return;
      }

      const balanceBefore = formatBalance(currentUser);
      const delta = money(preserve > 0 ? preserve : betAmount);
      currentUser.wallet = money(Number(currentUser.wallet || 0) + delta);
      await currentUser.save({ session });

      const tx = new JiliTransaction({
        action: 'cancelSessionBet',
        reqId,
        token,
        user: currentUser._id,
        username,
        currency: playerCurrency,
        game,
        round,
        sessionId,
        sessionType: 1,
        betAmount,
        preserve,
        walletDelta: delta,
        balanceBefore,
        balanceAfter: formatBalance(currentUser),
        originalRound: round,
        rawRequest: body,
        status: 'cancelled',
        errorCode: 0,
        message: 'success',
        txId: generateJiliTxId(),
      });

      response = jiliSuccess({ username, currency: playerCurrency, balance: currentUser.wallet, txId: responseTxId(tx.txId) });
      tx.response = response;
      await tx.save({ session });
    });

    return res.json(response || jiliError(5, 'Other error'));
  } finally {
    await session.endSession();
  }
});
