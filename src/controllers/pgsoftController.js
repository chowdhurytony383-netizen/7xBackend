import mongoose from 'mongoose';
import Game from '../models/Game.js';
import User from '../models/User.js';
import PgsoftTransaction from '../models/PgsoftTransaction.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertUserCanPlay } from '../utils/userPermissions.js';
import { recordWagerTurnover } from '../services/withdrawalGuardService.js';
import { env } from '../config/env.js';
import {
  assertPgsoftOperatorAuth,
  checkPgsoftIp,
  consumePgsoftLaunchTicket,
  createPgsoftSession,
  fetchPgsoftLaunchHtml,
  findUserByPgsoftPlayerName,
  findValidPgsoftSession,
  getClientIp,
  getPgsoftGameList,
  getPgsoftSupportedCurrencies,
  isGuid,
  isPgsoftConfigured,
  isPgsoftCountryRestricted,
  money,
  normalizePgsoftLanguage,
  pgsoftError,
  pgsoftSuccess,
  requestPgsoftLaunchHtml,
  resolvePgsoftCurrency,
  toMinorUnits,
  validateBetTransferAmount,
  validateRealTransferAmount,
  verifyPgsoftHashHeaders,
} from '../services/pgsoftService.js';

function body(req) {
  return req.body || {};
}

function stringValue(value = '') {
  return String(value ?? '').trim();
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

function hasValue(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
    && object[key] !== null
    && object[key] !== undefined
    && String(object[key]).trim() !== '';
}

function currentTimeMs() {
  return Date.now();
}

function sendPgsoft(res, payload) {
  return res.status(200).type('application/json').json(payload);
}

function callbackContentTypeIsValid(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  return type.includes('application/x-www-form-urlencoded');
}

function authOrError(req, { requireTraceId = false } = {}) {
  if (!callbackContentTypeIsValid(req)) {
    return { ok: false, response: pgsoftError('1034', 'Content-Type must be application/x-www-form-urlencoded.') };
  }

  if (!checkPgsoftIp(req)) return { ok: false, response: pgsoftError('1034', 'IP is not allowed.') };

  const auth = assertPgsoftOperatorAuth(body(req));
  if (!auth.ok) return { ok: false, response: pgsoftError(auth.code, auth.message) };

  const hashAuth = verifyPgsoftHashHeaders(req);
  if (!hashAuth.ok) return { ok: false, response: pgsoftError(hashAuth.code, hashAuth.message) };

  if (requireTraceId && env.PGSOFT_REQUIRE_TRACE_ID && !isGuid(req.query.trace_id)) {
    return { ok: false, response: pgsoftError('1034', 'Valid trace_id is required.') };
  }

  return { ok: true };
}

function getPublicApiOrigin(req) {
  const configured = String(env.PGSOFT_PUBLIC_API_ORIGIN || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function launchErrorHtml(message, traceId = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PG SOFT launch error</title><style>
html,body{height:100%;margin:0;background:#050b12;color:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
main{min-height:100%;display:grid;place-items:center;padding:24px;box-sizing:border-box}.card{max-width:640px;padding:28px;border:1px solid #26364a;border-radius:18px;background:#0d1724;text-align:center}h1{margin:0 0 12px;font-size:1.45rem}p{color:#cbd5e1;line-height:1.55}.trace{font-family:monospace;font-size:.82rem;color:#94a3b8;word-break:break-all}
</style></head><body><main><div class="card"><h1>PG SOFT game could not be launched</h1><p>${escapeHtml(message)}</p>${traceId ? `<p class="trace">Trace ID: ${escapeHtml(traceId)}</p>` : ''}<p>Close this window and try again.</p></div></main></body></html>`;
}

function providerGameToPublic(game = {}) {
  const gameId = game.config?.gameId || game.config?.providerGame?.GameId || game.gameId || game.gameCode?.replace(/^pgsoft-?/i, '');
  if (!gameId) return null;
  return {
    id: String(gameId),
    title: game.displayName || game.name || `PG SOFT ${gameId}`,
    category: game.category || 'Slots',
    image: game.image || '/images/pgsoft/pgsoft-lobby.svg',
    description: game.description || 'PG SOFT game',
    launchType: 'game-entry',
  };
}

export const listPgsoftGames = asyncHandler(async (_req, res) => {
  const configuredGames = getPgsoftGameList();
  const databaseGames = await Game.find({
    isActive: true,
    $or: [
      { provider: /^PGSOFT$/i },
      { 'config.provider': /^PGSOFT$/i },
    ],
  }).sort({ sortOrder: 1, createdAt: -1 }).lean().catch(() => []);

  const games = [...configuredGames];
  for (const record of databaseGames) {
    const mapped = providerGameToPublic(record);
    if (mapped && !games.some((item) => String(item.id) === String(mapped.id))) games.push(mapped);
  }

  res.json({
    success: true,
    data: games,
    games,
    integration: {
      enabled: Boolean(env.PGSOFT_ENABLED),
      configured: isPgsoftConfigured(),
      currencies: getPgsoftSupportedCurrencies(),
      webLobbyEnabled: Boolean(env.PGSOFT_ENABLE_WEB_LOBBY),
    },
  });
});

export const createPgsoftLaunchTicket = asyncHandler(async (req, res) => {
  assertUserCanPlay(req.user);

  if (!isPgsoftConfigured()) {
    return res.status(503).json({ success: false, message: 'PG SOFT integration is waiting for provider credentials.' });
  }

  if (isPgsoftCountryRestricted(req.user.countryCode)) {
    return res.status(403).json({ success: false, message: 'PG SOFT games are not available in your country.' });
  }

  const gameId = stringValue(req.body.gameId || req.params.gameId || req.query.gameId || 'lobby');
  if (!['lobby', 'web-lobby', 'web_lobby'].includes(gameId.toLowerCase()) && !/^\d+$/.test(gameId)) {
    return res.status(400).json({ success: false, message: 'PG SOFT gameId must be numeric or lobby.' });
  }

  const language = normalizePgsoftLanguage(req.body.language || req.query.language || 'en');
  const session = await createPgsoftSession(req.user, {
    gameId,
    language,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || '',
  });

  const launchUrl = `${getPublicApiOrigin(req)}/api/pgsoft/play/${encodeURIComponent(session.launchTicket)}`;
  return res.json({
    success: true,
    data: {
      launchUrl,
      expiresAt: session.launchTicketExpiresAt,
      sessionExpiresAt: session.expiresAt,
      gameId,
      language,
    },
  });
});

export const servePgsoftLaunch = asyncHandler(async (req, res) => {
  const session = await consumePgsoftLaunchTicket(req.params.ticket);
  if (!session?.user) {
    return res.status(410).type('text/html').send(launchErrorHtml('This launch link is invalid, expired, or already used.'));
  }

  try {
    assertUserCanPlay(session.user);
    if (isPgsoftCountryRestricted(session.user.countryCode)) {
      return res.status(403).type('text/html').send(launchErrorHtml('PG SOFT games are not available in your country.'));
    }

    const result = await requestPgsoftLaunchHtml({
      session,
      clientIp: getClientIp(req) || session.ip,
      userAgent: req.headers['user-agent'] || session.userAgent || '',
    });

    // Helmet's default CSP and SAMEORIGIN frame header would block PG SOFT's inline
    // launcher script and the frontend iframe (frontend and API use different subdomains).
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.status(200).send(result.buffer);
  } catch (error) {
    console.error('PG SOFT launch failed:', error.message);
    return res.status(503).type('text/html').send(launchErrorHtml(error.message || 'PG SOFT launch failed.'));
  }
});

// Backward-compatible direct HTML launch. The ticket/iframe flow above is preferred.
export const launchPgsoftGame = asyncHandler(async (req, res) => {
  assertUserCanPlay(req.user);
  if (isPgsoftCountryRestricted(req.user.countryCode)) {
    return res.status(403).json({ success: false, message: 'PG SOFT games are not available in your country.' });
  }

  const gameId = stringValue(req.body.gameId || req.params.gameId || req.query.gameId || 'lobby');
  const result = await fetchPgsoftLaunchHtml({
    user: req.user,
    gameId,
    language: req.body.language || req.query.language || 'en',
    clientIp: getClientIp(req),
    userAgent: req.headers['user-agent'] || '',
  });

  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.status(200).send(result.buffer);
});

export async function verifyPgsoftSession(req, res) {
  const auth = authOrError(req, { requireTraceId: true });
  if (!auth.ok) return sendPgsoft(res, auth.response);

  const payload = body(req);
  const token = stringValue(payload.operator_player_session);
  if (!token || !hasValue(payload, 'bet_type') || !Number.isInteger(Number(payload.bet_type))) {
    return sendPgsoft(res, pgsoftError('1034', 'Invalid request.'));
  }

  const session = await findValidPgsoftSession(token);
  if (!session) return sendPgsoft(res, pgsoftError('1034', 'Invalid or expired session.'));

  const requestedGameId = stringValue(payload.game_id);
  const sessionGameId = stringValue(session.gameId);
  const lobbySession = ['lobby', 'web-lobby', 'web_lobby'].includes(sessionGameId.toLowerCase());
  if (requestedGameId && !/^\d+$/.test(requestedGameId)) {
    return sendPgsoft(res, pgsoftError('1034', 'Invalid game_id.'));
  }
  if (requestedGameId && sessionGameId && !lobbySession && requestedGameId !== sessionGameId) {
    return sendPgsoft(res, pgsoftError('1034', 'Game session does not match.'));
  }

  session.lastVerifiedAt = new Date();
  await session.save();

  return sendPgsoft(res, pgsoftSuccess({
    player_name: session.playerName,
    nickname: session.nickname || session.playerName,
    currency: session.currency,
  }));
}

export async function getPgsoftWallet(req, res) {
  const auth = authOrError(req, { requireTraceId: true });
  if (!auth.ok) return sendPgsoft(res, auth.response);

  const payload = body(req);
  const playerName = stringValue(payload.player_name);
  if (!playerName) return sendPgsoft(res, pgsoftError('1034', 'Invalid request.'));

  const identity = await findUserByPgsoftPlayerName(playerName);
  if (!identity?.user) return sendPgsoft(res, pgsoftError('3005', 'Player wallet does not exist.'));

  if (payload.operator_player_session) {
    const session = await findValidPgsoftSession(payload.operator_player_session);
    if (!session || session.playerName.toLowerCase() !== playerName.toLowerCase()) {
      return sendPgsoft(res, pgsoftError('1034', 'Invalid player session.'));
    }
  }

  const expectedCurrency = resolvePgsoftCurrency(identity.user);
  if (!Number.isFinite(Number(identity.user.wallet))) {
    return sendPgsoft(res, pgsoftError('3005', 'Player wallet does not exist.'));
  }

  return sendPgsoft(res, pgsoftSuccess({
    currency_code: expectedCurrency,
    balance_amount: money(identity.user.wallet),
    updated_time: currentTimeMs(),
  }));
}

function storedTransactionResponse(transaction) {
  return transaction?.responsePayload?.data !== undefined
    ? transaction.responsePayload
    : pgsoftError(transaction?.errorCode || '1200', transaction?.errorMessage || 'Transaction response is unavailable.');
}

function isRetryableStoredFailure(transaction) {
  // Transient/system failures may be retried. Business failures that cancel a bet
  // (for example 3004/3107/3202/3073) must return the same stored error on duplicates.
  return transaction?.status === 'failed'
    && ['1035', '1200', '1303', '1315'].includes(String(transaction.errorCode || ''));
}

async function findTerminalDuplicate(transactionId) {
  const existing = await PgsoftTransaction.findOne({ transactionId });
  if (!existing) return null;
  if (existing.status === 'success') return storedTransactionResponse(existing);
  if (existing.status === 'failed' && !isRetryableStoredFailure(existing)) return storedTransactionResponse(existing);
  if (existing.status === 'processing') return pgsoftError('1315', 'Player operation is in progress.');
  return null;
}

function sanitizedRequestPayload(payload = {}) {
  const safePayload = { ...payload };
  delete safePayload.operator_token;
  delete safePayload.operatorToken;
  delete safePayload.secret_key;
  delete safePayload.secretKey;
  return safePayload;
}

function baseTransactionFields({ req, payload, transactionId, type, playerName, identity }) {
  return {
    transactionId,
    traceId: stringValue(req.query.trace_id),
    type,
    user: identity?.user?._id,
    playerName,
    operatorPlayerSession: stringValue(payload.operator_player_session),
    currency: stringValue(payload.currency_code).toUpperCase(),
    gameId: stringValue(payload.game_id),
    parentBetId: stringValue(payload.parent_bet_id),
    betId: stringValue(payload.bet_id),
    betAmount: money(payload.bet_amount),
    winAmount: money(payload.win_amount),
    transferAmount: money(payload.transfer_amount),
    realTransferAmount: money(payload.real_transfer_amount),
    updatedTime: numberValue(payload.updated_time || payload.adjustment_time),
    createTime: numberValue(payload.create_time),
    transactionType: stringValue(payload.transaction_type),
    walletType: stringValue(payload.wallet_type),
    isValidateBet: booleanValue(payload.is_validate_bet),
    isAdjustment: booleanValue(payload.is_adjustment),
    requestPayload: sanitizedRequestPayload(payload),
  };
}

async function prepareTransactionRecord({ mongoSession, fields }) {
  let transaction = await PgsoftTransaction.findOne({ transactionId: fields.transactionId }).session(mongoSession);

  if (transaction?.status === 'success') {
    return { terminalResponse: storedTransactionResponse(transaction), transaction, duplicate: true };
  }
  if (transaction?.status === 'failed' && !isRetryableStoredFailure(transaction)) {
    return { terminalResponse: storedTransactionResponse(transaction), transaction, duplicate: true };
  }
  if (transaction?.status === 'processing') {
    return { terminalResponse: pgsoftError('1315', 'Player operation is in progress.'), transaction, duplicate: true };
  }

  if (!transaction) transaction = new PgsoftTransaction(fields);
  else {
    Object.assign(transaction, fields);
    transaction.attempts = Number(transaction.attempts || 1) + 1;
  }
  transaction.status = 'processing';
  transaction.errorCode = '';
  transaction.errorMessage = '';
  await transaction.save({ session: mongoSession });
  return { transaction, duplicate: false };
}

async function failTransaction({ transaction, response, code, message, mongoSession, balanceBefore = 0 }) {
  transaction.status = 'failed';
  transaction.responsePayload = response;
  transaction.errorCode = String(code);
  transaction.errorMessage = String(message);
  transaction.balanceBefore = money(balanceBefore);
  transaction.balanceAfter = money(balanceBefore);
  await transaction.save({ session: mongoSession });
}

async function processBetPayout({ req, payload, identity, playerName, transactionId }) {
  const mongoSession = await mongoose.startSession();
  let response;
  let applied = false;

  try {
    await mongoSession.withTransaction(async () => {
      const fields = baseTransactionFields({ req, payload, transactionId, type: 'BET_PAYOUT', playerName, identity });
      const prepared = await prepareTransactionRecord({ mongoSession, fields });
      if (prepared.terminalResponse) {
        response = prepared.terminalResponse;
        return;
      }

      const transaction = prepared.transaction;
      const user = identity?.user?._id
        ? await User.findById(identity.user._id).session(mongoSession)
        : null;

      if (!user || user.status !== 'active') {
        response = pgsoftError('3004', 'Player does not exist.');
        await failTransaction({ transaction, response, code: '3004', message: 'Player does not exist.', mongoSession });
        return;
      }

      const expectedCurrency = resolvePgsoftCurrency(user);
      if (stringValue(payload.currency_code).toUpperCase() !== expectedCurrency) {
        response = pgsoftError('3107', 'Invalid configuration.');
        await failTransaction({ transaction, response, code: '3107', message: 'Currency mismatch.', mongoSession, balanceBefore: user.wallet });
        return;
      }

      const balanceBeforeMinor = toMinorUnits(user.wallet) ?? 0;
      const betAmountMinor = toMinorUnits(payload.bet_amount) ?? 0;
      const transferAmountMinor = toMinorUnits(payload.transfer_amount) ?? 0;
      const isFeature = booleanValue(payload.is_feature);

      if ((!isFeature && betAmountMinor > 0 && balanceBeforeMinor < betAmountMinor)
        || balanceBeforeMinor + transferAmountMinor < 0) {
        response = pgsoftError('3202', 'Insufficient player balance.');
        await failTransaction({ transaction, response, code: '3202', message: 'Insufficient player balance.', mongoSession, balanceBefore: user.wallet });
        return;
      }

      const balanceAfter = (balanceBeforeMinor + transferAmountMinor) / 100;
      user.wallet = balanceAfter;
      await user.save({ session: mongoSession });

      response = pgsoftSuccess({
        currency_code: expectedCurrency,
        balance_amount: money(balanceAfter),
        updated_time: numberValue(payload.updated_time),
        real_transfer_amount: money(payload.real_transfer_amount),
      });

      transaction.user = user._id;
      transaction.currency = expectedCurrency;
      transaction.balanceBefore = balanceBeforeMinor / 100;
      transaction.balanceAfter = balanceAfter;
      transaction.responsePayload = response;
      transaction.status = 'success';
      transaction.errorCode = '';
      transaction.errorMessage = '';
      await transaction.save({ session: mongoSession });
      applied = true;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await PgsoftTransaction.findOne({ transactionId });
      if (existing) return { response: storedTransactionResponse(existing), applied: false };
    }
    throw error;
  } finally {
    await mongoSession.endSession();
  }

  return { response: response || pgsoftError('1200', 'Internal server error.'), applied };
}

export async function betPayoutPgsoft(req, res) {
  const auth = authOrError(req, { requireTraceId: true });
  if (!auth.ok) return sendPgsoft(res, auth.response);

  const payload = body(req);
  const transactionId = stringValue(payload.transaction_id);
  if (!transactionId || transactionId.length > 50) return sendPgsoft(res, pgsoftError('1034', 'Invalid transaction_id.'));

  const duplicateResponse = await findTerminalDuplicate(transactionId);
  if (duplicateResponse) return sendPgsoft(res, duplicateResponse);

  const required = [
    'player_name', 'game_id', 'parent_bet_id', 'bet_id', 'currency_code', 'bet_amount',
    'win_amount', 'transfer_amount', 'real_transfer_amount', 'bet_type', 'create_time', 'updated_time',
  ];
  if (required.some((key) => !hasValue(payload, key))) return sendPgsoft(res, pgsoftError('1034', 'Invalid request.'));

  const playerName = stringValue(payload.player_name);
  if (playerName.length > 50) return sendPgsoft(res, pgsoftError('1034', 'Invalid player_name.'));

  const amountFields = ['bet_amount', 'win_amount', 'transfer_amount', 'real_transfer_amount'];
  if (amountFields.some((key) => !Number.isFinite(Number(payload[key])))
    || !Number.isInteger(Number(payload.game_id))
    || !Number.isInteger(Number(payload.bet_type))
    || !Number.isInteger(Number(payload.create_time))
    || !Number.isInteger(Number(payload.updated_time))) {
    return sendPgsoft(res, pgsoftError('1034', 'Invalid numeric parameter.'));
  }

  if (!validateBetTransferAmount({
    winAmount: payload.win_amount,
    betAmount: payload.bet_amount,
    transferAmount: payload.transfer_amount,
  })) {
    return sendPgsoft(res, pgsoftError('3073', 'Bet failed.'));
  }

  const currency = stringValue(payload.currency_code).toUpperCase();
  if (!validateRealTransferAmount({ currency, transferAmount: payload.transfer_amount, realTransferAmount: payload.real_transfer_amount })) {
    return sendPgsoft(res, pgsoftError('3107', 'Invalid configuration.'));
  }

  const identity = await findUserByPgsoftPlayerName(playerName);
  const isValidationOrAdjustment = booleanValue(payload.is_validate_bet) || booleanValue(payload.is_adjustment);
  if (payload.operator_player_session && !isValidationOrAdjustment) {
    const session = await findValidPgsoftSession(payload.operator_player_session);
    if (!session || session.playerName.toLowerCase() !== playerName.toLowerCase()) {
      return sendPgsoft(res, pgsoftError('1034', 'Invalid player session.'));
    }
  }

  const result = await processBetPayout({ req, payload, identity, playerName, transactionId });

  if (result.applied && Number(payload.bet_amount) > 0 && identity?.user?._id) {
    await recordWagerTurnover(identity.user._id, money(payload.bet_amount), 'pgsoft-bet').catch((error) => {
      console.error('PG SOFT turnover tracking failed:', error.message);
    });
  }

  return sendPgsoft(res, result.response);
}

async function processAdjustment({ req, payload, identity, playerName, transactionId }) {
  const mongoSession = await mongoose.startSession();
  let response;

  try {
    await mongoSession.withTransaction(async () => {
      const fields = baseTransactionFields({ req, payload, transactionId, type: 'ADJUSTMENT', playerName, identity });
      const prepared = await prepareTransactionRecord({ mongoSession, fields });
      if (prepared.terminalResponse) {
        response = prepared.terminalResponse;
        return;
      }

      const transaction = prepared.transaction;
      const user = identity?.user?._id
        ? await User.findById(identity.user._id).session(mongoSession)
        : null;

      if (!user || user.status !== 'active') {
        response = pgsoftError('3004', 'Player does not exist.');
        await failTransaction({ transaction, response, code: '3004', message: 'Player does not exist.', mongoSession });
        return;
      }

      const expectedCurrency = resolvePgsoftCurrency(user);
      if (stringValue(payload.currency_code).toUpperCase() !== expectedCurrency) {
        response = pgsoftError('3107', 'Invalid configuration.');
        await failTransaction({ transaction, response, code: '3107', message: 'Currency mismatch.', mongoSession, balanceBefore: user.wallet });
        return;
      }

      const balanceBeforeMinor = toMinorUnits(user.wallet) ?? 0;
      const transferAmountMinor = toMinorUnits(payload.transfer_amount) ?? 0;
      if (balanceBeforeMinor + transferAmountMinor < 0) {
        response = pgsoftError('3202', 'Insufficient player balance.');
        await failTransaction({ transaction, response, code: '3202', message: 'Insufficient player balance.', mongoSession, balanceBefore: user.wallet });
        return;
      }

      const balanceAfter = (balanceBeforeMinor + transferAmountMinor) / 100;
      user.wallet = balanceAfter;
      await user.save({ session: mongoSession });

      response = pgsoftSuccess({
        adjust_amount: money(payload.transfer_amount),
        balance_before: balanceBeforeMinor / 100,
        balance_after: money(balanceAfter),
        updated_time: numberValue(payload.adjustment_time),
        real_transfer_amount: money(payload.real_transfer_amount),
      });

      transaction.user = user._id;
      transaction.currency = expectedCurrency;
      transaction.balanceBefore = balanceBeforeMinor / 100;
      transaction.balanceAfter = balanceAfter;
      transaction.updatedTime = numberValue(payload.adjustment_time);
      transaction.responsePayload = response;
      transaction.status = 'success';
      transaction.errorCode = '';
      transaction.errorMessage = '';
      await transaction.save({ session: mongoSession });
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await PgsoftTransaction.findOne({ transactionId });
      if (existing) return storedTransactionResponse(existing);
    }
    throw error;
  } finally {
    await mongoSession.endSession();
  }

  return response || pgsoftError('1200', 'Internal server error.');
}

export async function adjustPgsoftBalance(req, res) {
  const auth = authOrError(req);
  if (!auth.ok) return sendPgsoft(res, auth.response);

  const payload = body(req);
  const transactionId = stringValue(payload.adjustment_transaction_id);
  if (!transactionId || transactionId.length > 200) return sendPgsoft(res, pgsoftError('1034', 'Invalid adjustment_transaction_id.'));

  const duplicateResponse = await findTerminalDuplicate(transactionId);
  if (duplicateResponse) return sendPgsoft(res, duplicateResponse);

  const required = [
    'player_name', 'currency_code', 'transfer_amount', 'real_transfer_amount', 'adjustment_id',
    'adjustment_time', 'transaction_type', 'bet_type',
  ];
  if (required.some((key) => !hasValue(payload, key))) return sendPgsoft(res, pgsoftError('1034', 'Invalid request.'));

  if (!Number.isFinite(Number(payload.transfer_amount))
    || !Number.isFinite(Number(payload.real_transfer_amount))
    || !Number.isInteger(Number(payload.adjustment_time))
    || !Number.isInteger(Number(payload.bet_type))) {
    return sendPgsoft(res, pgsoftError('1034', 'Invalid numeric parameter.'));
  }

  const playerName = stringValue(payload.player_name);
  const currency = stringValue(payload.currency_code).toUpperCase();
  if (!validateRealTransferAmount({ currency, transferAmount: payload.transfer_amount, realTransferAmount: payload.real_transfer_amount })) {
    return sendPgsoft(res, pgsoftError('3107', 'Invalid configuration.'));
  }

  const identity = await findUserByPgsoftPlayerName(playerName);
  const response = await processAdjustment({ req, payload, identity, playerName, transactionId });
  return sendPgsoft(res, response);
}

export async function updatePgsoftBetDetails(req, res) {
  const auth = authOrError(req);
  if (!auth.ok) return sendPgsoft(res, auth.response);

  const payload = body(req);
  let betDetails = payload.bet_details;
  if (typeof betDetails === 'string') {
    try {
      betDetails = JSON.parse(betDetails);
    } catch (_) {
      return sendPgsoft(res, pgsoftError('1034', 'Invalid bet_details JSON.'));
    }
  }

  if (!Array.isArray(betDetails) || !hasValue(payload, 'updated_time')) {
    return sendPgsoft(res, pgsoftError('1034', 'Invalid request.'));
  }

  const operations = betDetails
    .filter((item) => item && stringValue(item.bet_id) && Number.isFinite(Number(item.end_time)))
    .map((item) => ({
      updateMany: {
        filter: { betId: stringValue(item.bet_id) },
        update: { $set: { betEndTime: Number(item.end_time) } },
      },
    }));

  if (operations.length) await PgsoftTransaction.bulkWrite(operations, { ordered: false });
  return sendPgsoft(res, pgsoftSuccess({ is_success: true }));
}
