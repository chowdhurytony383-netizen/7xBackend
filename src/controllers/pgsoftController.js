import mongoose from 'mongoose';
import User from '../models/User.js';
import PgsoftTransaction from '../models/PgsoftTransaction.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertUserCanPlay } from '../utils/userPermissions.js';
import { recordWagerTurnover } from '../services/withdrawalGuardService.js';
import {
  assertPgsoftOperatorAuth,
  checkPgsoftIp,
  fetchPgsoftLaunchHtml,
  findUserByPgsoftPlayerName,
  findValidPgsoftSession,
  getClientIp,
  getPgsoftGameList,
  money,
  pgsoftError,
  pgsoftSuccess,
  resolvePgsoftCurrency,
  validateRealTransferAmount,
} from '../services/pgsoftService.js';

function body(req) {
  return req.body || {};
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value = '') {
  return String(value ?? '').trim();
}

function currentTimeMs() {
  return Date.now();
}

function authOrError(req) {
  if (!checkPgsoftIp(req)) return { ok: false, response: pgsoftError('1034', 'IP is not allowed.') };

  const auth = assertPgsoftOperatorAuth(body(req));
  if (!auth.ok) return { ok: false, response: pgsoftError(auth.code, auth.message) };

  return { ok: true };
}

export const listPgsoftGames = asyncHandler(async (_req, res) => {
  const games = getPgsoftGameList();
  res.json({ success: true, data: games, games });
});

export const launchPgsoftGame = asyncHandler(async (req, res) => {
  assertUserCanPlay(req.user);

  if (String(req.user.countryCode || '').toUpperCase() === 'US') {
    return res.status(403).json({
      success: false,
      message: 'PG SOFT games are not available in the United States market.',
    });
  }

  const gameId = stringValue(req.body.gameId || req.params.gameId || req.query.gameId);
  if (!gameId) return res.status(400).json({ success: false, message: 'PG SOFT gameId is required.' });

  const language = stringValue(req.body.language || req.query.language || 'en');

  try {
    const result = await fetchPgsoftLaunchHtml({
      user: req.user,
      gameId,
      language,
      clientIp: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-PGSoft-Session', result.session.token);
    return res.status(200).send(result.buffer);
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: error.message || 'PG SOFT launch failed.',
    });
  }
});

export const verifyPgsoftSession = asyncHandler(async (req, res) => {
  const auth = authOrError(req);
  if (!auth.ok) return res.json(auth.response);

  const token = stringValue(body(req).operator_player_session || body(req).ops);
  const session = await findValidPgsoftSession(token);

  if (!session) return res.json(pgsoftError('1034', 'Invalid or expired session.'));

  session.lastVerifiedAt = new Date();
  await session.save();

  return res.json(pgsoftSuccess({
    player_name: session.playerName,
    nickname: session.nickname || session.playerName,
    currency: session.currency,
  }));
});

export const getPgsoftWallet = asyncHandler(async (req, res) => {
  const auth = authOrError(req);
  if (!auth.ok) return res.json(auth.response);

  const playerName = stringValue(body(req).player_name);
  const identity = await findUserByPgsoftPlayerName(playerName);
  if (!identity?.user) return res.json(pgsoftError('3004', 'Player does not exist.'));

  const expectedCurrency = resolvePgsoftCurrency(identity.user);
  const requestedCurrency = stringValue(body(req).currency_code || body(req).currency || expectedCurrency).toUpperCase();

  if (requestedCurrency && requestedCurrency !== expectedCurrency) {
    return res.json(pgsoftError('3107', 'Currency mismatch.'));
  }

  return res.json(pgsoftSuccess({
    currency_code: expectedCurrency,
    balance_amount: money(identity.user.wallet || 0),
    updated_time: currentTimeMs(),
  }));
});

async function returnDuplicate(transaction) {
  return transaction?.responsePayload || pgsoftError('1200', 'Duplicate transaction response not found.');
}

export const betPayoutPgsoft = asyncHandler(async (req, res) => {
  const auth = authOrError(req);
  if (!auth.ok) return res.json(auth.response);

  const payload = body(req);
  const playerName = stringValue(payload.player_name);
  const transactionId = stringValue(
    payload.transaction_id
    || payload.bet_transaction_id
    || payload.bet_id
    || `${payload.parent_bet_id || 'pgsoft'}-${payload.bet_id || payload.updated_time || Date.now()}`
  );

  if (!playerName || !transactionId) return res.json(pgsoftError('1034', 'Invalid request.'));

  const duplicate = await PgsoftTransaction.findOne({ transactionId });
  if (duplicate) return res.json(await returnDuplicate(duplicate));

  const identity = await findUserByPgsoftPlayerName(playerName);
  if (!identity?.user) return res.json(pgsoftError('3004', 'Player does not exist.'));

  const expectedCurrency = resolvePgsoftCurrency(identity.user);
  const currencyCode = stringValue(payload.currency_code || payload.currency || expectedCurrency).toUpperCase();
  if (currencyCode !== expectedCurrency) return res.json(pgsoftError('3107', 'Currency mismatch.'));

  const transferAmount = money(payload.transfer_amount);
  const realTransferAmount = money(payload.real_transfer_amount ?? payload.transfer_amount);
  if (!validateRealTransferAmount({ transferAmount, realTransferAmount })) {
    return res.json(pgsoftError('3107', 'Invalid real_transfer_amount.'));
  }

  const session = await mongoose.startSession();

  try {
    let response;
    let savedTransaction;
    let wagerAmountForTurnover = 0;

    await session.withTransaction(async () => {
      const user = await User.findById(identity.user._id).session(session);
      if (!user || user.status !== 'active') {
        response = pgsoftError('3004', 'Player does not exist.');
        return;
      }

      const balanceBefore = money(user.wallet || 0);
      const balanceAfter = money(balanceBefore + transferAmount);

      if (balanceAfter < 0) {
        response = pgsoftError('3202', 'Not enough cash balance.');
        await PgsoftTransaction.create([{
          transactionId,
          type: 'BET_PAYOUT',
          user: user._id,
          playerName,
          currency: expectedCurrency,
          gameId: stringValue(payload.game_id),
          parentBetId: stringValue(payload.parent_bet_id),
          betId: stringValue(payload.bet_id),
          betAmount: money(payload.bet_amount),
          winAmount: money(payload.win_amount),
          transferAmount,
          realTransferAmount,
          balanceBefore,
          balanceAfter: balanceBefore,
          updatedTime: numberValue(payload.updated_time, currentTimeMs()),
          requestPayload: payload,
          responsePayload: response,
          status: 'failed',
          errorCode: '3202',
          errorMessage: 'Not enough cash balance.',
        }], { session });
        return;
      }

      user.wallet = balanceAfter;
      await user.save({ session });

      response = pgsoftSuccess({
        currency_code: expectedCurrency,
        balance_amount: balanceAfter,
        updated_time: numberValue(payload.updated_time, currentTimeMs()),
        real_transfer_amount: realTransferAmount,
      });

      const betAmount = money(payload.bet_amount);
      if (betAmount > 0) wagerAmountForTurnover = betAmount;

      const [tx] = await PgsoftTransaction.create([{
        transactionId,
        type: 'BET_PAYOUT',
        user: user._id,
        playerName,
        currency: expectedCurrency,
        gameId: stringValue(payload.game_id),
        parentBetId: stringValue(payload.parent_bet_id),
        betId: stringValue(payload.bet_id),
        betAmount,
        winAmount: money(payload.win_amount),
        transferAmount,
        realTransferAmount,
        balanceBefore,
        balanceAfter,
        updatedTime: numberValue(payload.updated_time, currentTimeMs()),
        requestPayload: payload,
        responsePayload: response,
        status: 'success',
      }], { session });

      savedTransaction = tx;
    });

    if (savedTransaction && wagerAmountForTurnover > 0) {
      await recordWagerTurnover(identity.user._id, wagerAmountForTurnover, 'pgsoft-bet').catch((error) => {
        console.error('PG SOFT turnover tracking failed:', error.message);
      });
    }

    return res.json(response || pgsoftError('1200', 'Internal server error.'));
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await PgsoftTransaction.findOne({ transactionId });
      if (existing) return res.json(await returnDuplicate(existing));
    }
    throw error;
  } finally {
    await session.endSession();
  }
});

export const adjustPgsoftBalance = asyncHandler(async (req, res) => {
  const auth = authOrError(req);
  if (!auth.ok) return res.json(auth.response);

  const payload = body(req);
  const playerName = stringValue(payload.player_name);
  const transactionId = stringValue(payload.adjustment_transaction_id || payload.transaction_id || payload.adjustment_id);

  if (!playerName || !transactionId) return res.json(pgsoftError('1034', 'Invalid request.'));

  const duplicate = await PgsoftTransaction.findOne({ transactionId });
  if (duplicate) return res.json(await returnDuplicate(duplicate));

  const identity = await findUserByPgsoftPlayerName(playerName);
  if (!identity?.user) return res.json(pgsoftError('3004', 'Player does not exist.'));

  const expectedCurrency = resolvePgsoftCurrency(identity.user);
  const currencyCode = stringValue(payload.currency_code || payload.currency || expectedCurrency).toUpperCase();
  if (currencyCode !== expectedCurrency) return res.json(pgsoftError('3107', 'Currency mismatch.'));

  const transferAmount = money(payload.transfer_amount);
  const realTransferAmount = money(payload.real_transfer_amount ?? payload.transfer_amount);
  if (!validateRealTransferAmount({ transferAmount, realTransferAmount })) {
    return res.json(pgsoftError('3107', 'Invalid real_transfer_amount.'));
  }

  const session = await mongoose.startSession();

  try {
    let response;

    await session.withTransaction(async () => {
      const user = await User.findById(identity.user._id).session(session);
      if (!user || user.status !== 'active') {
        response = pgsoftError('3004', 'Player does not exist.');
        return;
      }

      const balanceBefore = money(user.wallet || 0);
      const balanceAfter = money(balanceBefore + transferAmount);

      if (balanceAfter < 0) {
        response = pgsoftError('3202', 'Not enough cash balance.');
        await PgsoftTransaction.create([{
          transactionId,
          type: 'ADJUSTMENT',
          user: user._id,
          playerName,
          currency: expectedCurrency,
          transferAmount,
          realTransferAmount,
          balanceBefore,
          balanceAfter: balanceBefore,
          updatedTime: numberValue(payload.adjustment_time || payload.updated_time, currentTimeMs()),
          requestPayload: payload,
          responsePayload: response,
          status: 'failed',
          errorCode: '3202',
          errorMessage: 'Not enough cash balance.',
        }], { session });
        return;
      }

      user.wallet = balanceAfter;
      await user.save({ session });

      response = pgsoftSuccess({
        adjust_amount: transferAmount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        updated_time: numberValue(payload.adjustment_time || payload.updated_time, currentTimeMs()),
        real_transfer_amount: realTransferAmount,
      });

      await PgsoftTransaction.create([{
        transactionId,
        type: 'ADJUSTMENT',
        user: user._id,
        playerName,
        currency: expectedCurrency,
        transferAmount,
        realTransferAmount,
        balanceBefore,
        balanceAfter,
        updatedTime: numberValue(payload.adjustment_time || payload.updated_time, currentTimeMs()),
        requestPayload: payload,
        responsePayload: response,
        status: 'success',
      }], { session });
    });

    return res.json(response || pgsoftError('1200', 'Internal server error.'));
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await PgsoftTransaction.findOne({ transactionId });
      if (existing) return res.json(await returnDuplicate(existing));
    }
    throw error;
  } finally {
    await session.endSession();
  }
});
