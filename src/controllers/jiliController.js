import mongoose from 'mongoose';
import User from '../models/User.js';
import JiliTransaction from '../models/JiliTransaction.js';
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
    const prefix = String(env.JILI_USERNAME_PREFIX || '7xbet_').replace(/[^a-zA-Z0-9_]/g, '');
    const possibleUserId = prefix && username.startsWith(prefix) ? username.slice(prefix.length) : username;

    const user = await User.findOne({
      status: 'active',
      $or: [
        { userId: possibleUserId },
        { username: possibleUserId },
        { userId: username },
        { username },
      ],
    });

    if (user && buildJiliUsername(user) === username) {
      return {
        user,
        username,
        currency: normalizeCurrency(env.JILI_CURRENCY || user.currency || 'BDT'),
        tokenRecord: null,
      };
    }
  }

  return null;
}

function validateCurrency(requestCurrency, playerCurrency) {
  const expected = normalizeCurrency(playerCurrency);
  const received = normalizeCurrency(requestCurrency || expected);
  return expected === received;
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
  const games = await getJiliGameList();
  res.json({ success: true, data: games, games });
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
