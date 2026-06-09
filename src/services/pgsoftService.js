import crypto from 'crypto';
import { URLSearchParams } from 'url';
import PgsoftSession from '../models/PgsoftSession.js';
import User from '../models/User.js';
import { env } from '../config/env.js';

const DEFAULT_GAMES = [
  {
    id: '126',
    title: 'Fortune Tiger',
    category: 'Slots',
    image: '/images/others/banner1.png',
    description: 'PG SOFT slot game. Replace/update with official game list from PG SOFT.',
  },
  {
    id: '98',
    title: 'Fortune Ox',
    category: 'Slots',
    image: '/images/others/banner2.png',
    description: 'PG SOFT slot game. Replace/update with official game list from PG SOFT.',
  },
  {
    id: '68',
    title: 'Fortune Mouse',
    category: 'Slots',
    image: '/images/others/banner3.png',
    description: 'PG SOFT slot game. Replace/update with official game list from PG SOFT.',
  },
];

export function money(value = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.floor(number * 100) / 100;
}

export function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwarded || req.ip || req.socket?.remoteAddress || '';
}

export function pgsoftSuccess(data) {
  return { data, error: null };
}

export function pgsoftError(code = '1034', message = 'Invalid request') {
  return {
    data: null,
    error: {
      code: String(code),
      message: String(message),
    },
  };
}

export function normalizeCurrency(currency = '') {
  return String(currency || '').trim().toUpperCase();
}

export function getPgsoftSupportedCurrencies() {
  return String(env.PGSOFT_SUPPORTED_CURRENCIES || 'BDT,INR,PKR,NPR,LKR,USD')
    .split(',')
    .map((item) => normalizeCurrency(item))
    .filter(Boolean);
}

export function getPgsoftFallbackCurrency() {
  const fallback = normalizeCurrency(env.PGSOFT_FALLBACK_CURRENCY || 'USD') || 'USD';
  const supported = getPgsoftSupportedCurrencies();
  return supported.includes(fallback) ? fallback : (supported[0] || fallback);
}

export function resolvePgsoftCurrency(user = {}) {
  const requested = normalizeCurrency(user.currency || user.walletCurrency || user.preferredCurrency || '');
  const supported = getPgsoftSupportedCurrencies();
  if (requested && supported.includes(requested)) return requested;
  return getPgsoftFallbackCurrency();
}

export function buildPgsoftPlayerName(user = {}, currency = '') {
  const base = String(user.userId || user.username || user._id || '')
    .trim()
    .replace(/[^a-zA-Z0-9@_-]/g, '')
    .slice(0, 35);

  const prefix = String(env.PGSOFT_PLAYER_PREFIX || '7xbet_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 12) || '7xbet_';

  const code = normalizeCurrency(currency || resolvePgsoftCurrency(user)).toLowerCase();
  return `${prefix}${code}_${base}`.slice(0, 50);
}

export function assertPgsoftOperatorAuth(body = {}) {
  const expectedToken = String(env.PGSOFT_OPERATOR_TOKEN || '');
  const expectedSecret = String(env.PGSOFT_SECRET_KEY || '');

  if (!expectedToken || !expectedSecret) {
    return { ok: false, code: '1200', message: 'PGSOFT_OPERATOR_TOKEN or PGSOFT_SECRET_KEY is not configured.' };
  }

  const operatorToken = String(body.operator_token || body.operatorToken || '');
  const secretKey = String(body.secret_key || body.secretKey || '');

  if (operatorToken !== expectedToken || secretKey !== expectedSecret) {
    return { ok: false, code: '1034', message: 'Invalid operator credentials.' };
  }

  return { ok: true };
}

export function checkPgsoftIp(req) {
  const allowed = String(env.PGSOFT_ALLOWED_IPS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!allowed.length) return true;

  const ip = getClientIp(req);
  return allowed.includes(ip);
}

export async function createPgsoftSession(user, { gameId = '', language = 'en', ip = '', userAgent = '' } = {}) {
  const ttlMinutes = Math.max(5, Number(env.PGSOFT_SESSION_TTL_MINUTES || 60));
  const currency = resolvePgsoftCurrency(user);
  const token = crypto.randomUUID();
  const playerName = buildPgsoftPlayerName(user, currency);
  const nickname = String(user.fullName || user.name || user.username || user.userId || 'Player').slice(0, 50);

  const session = await PgsoftSession.create({
    token,
    user: user._id,
    playerName,
    nickname,
    currency,
    gameId: String(gameId || ''),
    language: String(language || 'en'),
    ip,
    userAgent,
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  });

  return session;
}

export async function findValidPgsoftSession(token = '') {
  const session = await PgsoftSession.findOne({
    token: String(token || ''),
    status: 'active',
    expiresAt: { $gt: new Date() },
  }).populate('user');

  if (!session || !session.user || session.user.status !== 'active') return null;

  session.lastUsedAt = new Date();
  await session.save();
  return session;
}

export async function findUserByPgsoftPlayerName(playerName = '') {
  const session = await PgsoftSession.findOne({
    playerName: String(playerName || ''),
    status: 'active',
  }).sort({ createdAt: -1 }).populate('user');

  if (session?.user && session.user.status === 'active') return { user: session.user, session };

  const prefix = String(env.PGSOFT_PLAYER_PREFIX || '7xbet_').replace(/[^a-zA-Z0-9_]/g, '');
  let raw = String(playerName || '').trim();
  if (prefix && raw.startsWith(prefix)) raw = raw.slice(prefix.length);
  raw = raw.replace(/^[a-zA-Z]{3,5}_/, '');

  const user = await User.findOne({
    status: 'active',
    $or: [
      { userId: raw },
      { username: raw },
      { email: raw.toLowerCase() },
    ],
  });

  if (!user) return null;

  return {
    user,
    session: {
      playerName,
      currency: resolvePgsoftCurrency(user),
    },
  };
}

export function getPgsoftGameList() {
  try {
    const raw = String(env.PGSOFT_GAME_LIST || '').trim();
    if (!raw) return DEFAULT_GAMES;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_GAMES;

    return parsed
      .map((item) => ({
        id: String(item.id || item.gameId || item.code || '').trim(),
        title: String(item.title || item.name || item.displayName || item.id || '').trim(),
        category: String(item.category || 'Slots'),
        image: String(item.image || '/images/others/banner1.png'),
        description: String(item.description || 'PG SOFT game'),
      }))
      .filter((item) => item.id && item.title);
  } catch (_) {
    return DEFAULT_GAMES;
  }
}

function getLaunchBaseUrl() {
  const baseUrl = String(env.PGSOFT_API_DOMAIN || '').trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('PGSOFT_API_DOMAIN is not configured.');
  return baseUrl;
}

export async function fetchPgsoftLaunchHtml({
  user,
  gameId,
  language = 'en',
  clientIp = '',
  userAgent = '',
}) {
  if (!env.PGSOFT_OPERATOR_TOKEN) throw new Error('PGSOFT_OPERATOR_TOKEN is not configured.');

  // We do not block by currency here. resolvePgsoftCurrency() already falls back to USD
  // when a requested currency is not enabled.
  const session = await createPgsoftSession(user, {
    gameId,
    language,
    ip: clientIp,
    userAgent,
  });

  const traceId = crypto.randomUUID();
  const url = `${getLaunchBaseUrl()}/external-game-launcher/api/v1/GetLaunchURLHTML?trace_id=${encodeURIComponent(traceId)}`;

  const extraArgs = new URLSearchParams();
  extraArgs.set('btt', String(Number(env.PGSOFT_DEFAULT_BET_TYPE || 1)));
  extraArgs.set('ops', session.token);
  extraArgs.set('l', String(language || env.PGSOFT_DEFAULT_LANGUAGE || 'en'));
  extraArgs.set('op', String(user._id));
  extraArgs.set('f', env.PGSOFT_GAME_EXIT_URL || env.FRONTEND_URL || 'https://7xbet.asia');
  extraArgs.set('oc', String(Number(env.PGSOFT_ORIENTATION_CHECK || 1)));

  const body = new URLSearchParams();
  body.set('operator_token', env.PGSOFT_OPERATOR_TOKEN);
  body.set('path', `/${String(gameId || '').replace(/^\/+/, '')}/index.html`);
  body.set('extra_args', extraArgs.toString());
  body.set('url_type', 'game-entry');
  body.set('client_ip', String(clientIp || '127.0.0.1'));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent || '7XBET-PGSOFT-Integration/1.0',
    },
    body,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'text/html; charset=utf-8';

  if (!response.ok) {
    const text = buffer.toString('utf8');
    throw new Error(text || `PG SOFT launch failed with HTTP ${response.status}`);
  }

  return {
    buffer,
    contentType,
    session,
  };
}

export function validateRealTransferAmount({ transferAmount, realTransferAmount }) {
  const transfer = money(transferAmount);
  const real = money(realTransferAmount);

  // Current 7XBET form requested 1:1 base unit currencies only.
  return Math.abs(transfer - real) < 0.01;
}
