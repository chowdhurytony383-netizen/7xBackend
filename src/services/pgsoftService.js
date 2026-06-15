import crypto from 'crypto';
import { URLSearchParams } from 'url';
import PgsoftSession from '../models/PgsoftSession.js';
import User from '../models/User.js';
import { env } from '../config/env.js';

const CURRENCY_BASE_1000 = new Set([
  'BIF', 'CDF', 'COP', 'GNF', 'IDR', 'IQD', 'IRR', 'KHR', 'KRW', 'LAK', 'LBP',
  'MGA', 'MMK', 'MNT', 'PYG', 'RWF', 'SLL', 'TZS', 'UGX', 'UZS', 'VND',
]);

const PGSOFT_LANGUAGE_CODES = new Set([
  'en', 'en-social', 'en-stkus', 'ar-EG', 'az-Latn-AZ', 'bg-BG', 'bn-BD', 'cs-CZ',
  'da-DK', 'de-DE', 'el-GR', 'es-ES', 'et-EE', 'fa-IR', 'fi-FI', 'fr-FR', 'hi-IN',
  'hu-HU', 'hy-AM', 'id-ID', 'it-IT', 'ja-JP', 'ko-KR', 'lo-LA', 'lt-LT', 'mn-MN',
  'my-MM', 'no-NO', 'nl-NL', 'pl-PL', 'pt-PT', 'pt-BR', 'ro-RO', 'ru-RU',
  'sr-Latn-RS', 'si-LK', 'sk-SK', 'sq-AL', 'sv-SE', 'th-TH', 'tr-TR', 'uk-UA',
  'ur-PK', 'uz-Latn-UZ', 'vi-VN', 'zh',
]);

const SITE_LANGUAGE_TO_PGSOFT = {
  ar: 'ar-EG',
  az: 'az-Latn-AZ',
  bg: 'bg-BG',
  bn: 'bn-BD',
  cs: 'cs-CZ',
  da: 'da-DK',
  de: 'de-DE',
  el: 'el-GR',
  es: 'es-ES',
  et: 'et-EE',
  fa: 'fa-IR',
  fi: 'fi-FI',
  fr: 'fr-FR',
  hi: 'hi-IN',
  hu: 'hu-HU',
  hy: 'hy-AM',
  id: 'id-ID',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  lo: 'lo-LA',
  lt: 'lt-LT',
  mn: 'mn-MN',
  my: 'my-MM',
  nl: 'nl-NL',
  no: 'no-NO',
  pl: 'pl-PL',
  pt: 'pt-PT',
  ro: 'ro-RO',
  ru: 'ru-RU',
  si: 'si-LK',
  sk: 'sk-SK',
  sq: 'sq-AL',
  sr: 'sr-Latn-RS',
  sv: 'sv-SE',
  th: 'th-TH',
  tr: 'tr-TR',
  uk: 'uk-UA',
  ur: 'ur-PK',
  uz: 'uz-Latn-UZ',
  vi: 'vi-VN',
  'zh-CN': 'zh',
  'zh-TW': 'zh',
};

const DEFAULT_GAMES = [
  {
    id: 'lobby',
    title: 'PG SOFT Game Lobby',
    category: 'PG SOFT',
    image: '/images/pgsoft/pgsoft-lobby.svg',
    description: 'Browse all PG SOFT games enabled for the operator account.',
    launchType: 'web-lobby',
  },
];

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function splitCsv(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toMinorUnits(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number * 100);
}

export function money(value = 0) {
  const minor = toMinorUnits(value);
  return minor === null ? 0 : minor / 100;
}

export function amountsEqual(left, right) {
  const leftMinor = toMinorUnits(left);
  const rightMinor = toMinorUnits(right);
  return leftMinor !== null && rightMinor !== null && leftMinor === rightMinor;
}

export function validateBetTransferAmount({ winAmount, betAmount, transferAmount }) {
  const winMinor = toMinorUnits(winAmount);
  const betMinor = toMinorUnits(betAmount);
  const transferMinor = toMinorUnits(transferAmount);
  return winMinor !== null
    && betMinor !== null
    && transferMinor !== null
    && winMinor - betMinor === transferMinor;
}

export function normalizeIp(value = '') {
  let ip = String(value || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  return ip;
}

export function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  return normalizeIp(forwarded || realIp || req.ip || req.socket?.remoteAddress || '');
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
  return splitCsv(env.PGSOFT_SUPPORTED_CURRENCIES || 'BDT,INR,PKR,NPR,LKR,USD')
    .map((item) => normalizeCurrency(item));
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

export function getPgsoftCurrencyBaseUnit(currency = '') {
  return CURRENCY_BASE_1000.has(normalizeCurrency(currency)) ? 1000 : 1;
}

export function validateRealTransferAmount({ currency, transferAmount, realTransferAmount }) {
  const baseUnit = getPgsoftCurrencyBaseUnit(currency);
  const conversionOwner = String(env.PGSOFT_CURRENCY_CONVERSION_OWNER || 'operator').toLowerCase();
  const expected = baseUnit === 1000 && conversionOwner !== 'pgsoft'
    ? Number(transferAmount) * 1000
    : Number(transferAmount);
  return amountsEqual(expected, realTransferAmount);
}

export function normalizePgsoftLanguage(language = '') {
  const requested = String(language || '').trim();
  if (PGSOFT_LANGUAGE_CODES.has(requested)) return requested;

  const mapped = SITE_LANGUAGE_TO_PGSOFT[requested];
  if (mapped) return mapped;

  const lower = requested.toLowerCase();
  const lowerMappedKey = Object.keys(SITE_LANGUAGE_TO_PGSOFT).find((key) => key.toLowerCase() === lower);
  if (lowerMappedKey) return SITE_LANGUAGE_TO_PGSOFT[lowerMappedKey];

  const configured = String(env.PGSOFT_DEFAULT_LANGUAGE || 'en').trim();
  return PGSOFT_LANGUAGE_CODES.has(configured) ? configured : 'en';
}

export function isPgsoftCountryRestricted(countryCode = '') {
  const restricted = new Set(
    splitCsv(env.PGSOFT_RESTRICTED_COUNTRY_CODES || 'MY,SG,TW,US,MO,IL,IR,KP,AU,GB')
      .map((item) => item.toUpperCase())
  );
  const rawCode = String(countryCode || '').trim().toUpperCase();
  const aliases = {
    UK: 'GB', GBR: 'GB', USA: 'US', AUS: 'AU', MYS: 'MY', SGP: 'SG',
    TWN: 'TW', MAC: 'MO', ISR: 'IL', IRN: 'IR', PRK: 'KP',
  };
  return restricted.has(aliases[rawCode] || rawCode);
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
    return { ok: false, code: '1200', message: 'PG SOFT operator credentials are not configured.' };
  }

  const operatorToken = String(body.operator_token || body.operatorToken || '');
  const secretKey = String(body.secret_key || body.secretKey || '');

  if (!safeEqual(operatorToken, expectedToken) || !safeEqual(secretKey, expectedSecret)) {
    return { ok: false, code: '1034', message: 'Invalid operator credentials.' };
  }

  return { ok: true };
}

export function checkPgsoftIp(req) {
  const allowed = splitCsv(env.PGSOFT_CALLBACK_ALLOWED_IPS || env.PGSOFT_ALLOWED_IPS || '')
    .map((item) => normalizeIp(item));
  if (!allowed.length) return true;
  return allowed.includes(getClientIp(req));
}

export function isGuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

export function computePgsoftContentSha256(rawBody = '') {
  return crypto.createHash('sha256').update(String(rawBody ?? ''), 'utf8').digest('hex');
}

export function computePgsoftSignature({ salt, host, contentSha256, date }) {
  return crypto
    .createHmac('sha256', String(salt || ''))
    .update(`${String(host || '')}${String(contentSha256 || '')}${String(date || '')}`, 'utf8')
    .digest('hex');
}

function utcDateString(date = new Date()) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('');
}

export function verifyPgsoftHashHeaders(req) {
  if (!env.PGSOFT_HASH_AUTH_ENABLED) return { ok: true };
  if (!env.PGSOFT_HASH_SALT) return { ok: false, code: '1200', message: 'PG SOFT hash salt is not configured.' };

  const xDate = String(req.headers['x-date'] || '').trim();
  const xContentSha256 = String(req.headers['x-content-sha256'] || '').trim().toLowerCase();
  const authorization = String(req.headers.authorization || '').trim();
  const rawBody = String(req.rawBody ?? '');

  if (!xDate || !xContentSha256 || !authorization) {
    return { ok: false, code: '1034', message: 'Missing hash authentication headers.' };
  }

  if (env.PGSOFT_HASH_VALIDATE_DATE && xDate !== utcDateString()) {
    return { ok: false, code: '1034', message: 'Invalid x-date header.' };
  }

  const calculatedContentHash = computePgsoftContentSha256(rawBody);
  if (!safeEqual(calculatedContentHash, xContentSha256)) {
    return { ok: false, code: '1034', message: 'Invalid x-content-sha256 header.' };
  }

  const match = authorization.match(/^PWS-HMAC-SHA256\s+Credential=([^,]+),SignedHeaders=([^,]+),Signature=([0-9a-f]{64})$/i);
  if (!match) return { ok: false, code: '1034', message: 'Invalid Authorization header.' };

  const [, credential, signedHeaders, signature] = match;
  const expectedCredential = `${xDate}/${env.PGSOFT_OPERATOR_TOKEN}/pws/v1`;
  if (!safeEqual(credential, expectedCredential) || signedHeaders.toLowerCase() !== 'host;x-content-sha256;x-date') {
    return { ok: false, code: '1034', message: 'Invalid hash credential scope.' };
  }

  const hostCandidates = [
    String(req.headers.host || '').trim(),
    String(req.headers['x-forwarded-host'] || '').split(',')[0]?.trim(),
  ].filter(Boolean);

  const signatureMatches = hostCandidates.some((host) => {
    const expected = computePgsoftSignature({
      salt: env.PGSOFT_HASH_SALT,
      host,
      contentSha256: xContentSha256,
      date: xDate,
    });
    return safeEqual(expected.toLowerCase(), signature.toLowerCase());
  });

  return signatureMatches
    ? { ok: true }
    : { ok: false, code: '1034', message: 'Invalid request signature.' };
}

export async function createPgsoftSession(user, { gameId = '', language = 'en', ip = '', userAgent = '' } = {}) {
  const ttlMinutes = Math.max(5, Number(env.PGSOFT_SESSION_TTL_MINUTES || 60));
  const launchTicketTtlSeconds = Math.max(30, Number(env.PGSOFT_LAUNCH_TICKET_TTL_SECONDS || 120));
  const currency = resolvePgsoftCurrency(user);
  const token = crypto.randomUUID();
  const launchTicket = crypto.randomBytes(32).toString('hex');
  const playerName = buildPgsoftPlayerName(user, currency);
  const nickname = String(user.fullName || user.name || user.username || user.userId || 'Player').slice(0, 50);

  if (env.PGSOFT_SINGLE_ACTIVE_SESSION) {
    await PgsoftSession.updateMany(
      { user: user._id, status: 'active' },
      { $set: { status: 'revoked' } }
    );
  }

  return PgsoftSession.create({
    token,
    launchTicket,
    launchTicketExpiresAt: new Date(Date.now() + launchTicketTtlSeconds * 1000),
    user: user._id,
    playerName,
    playerNameLower: playerName.toLowerCase(),
    nickname,
    currency,
    gameId: String(gameId || ''),
    language: normalizePgsoftLanguage(language),
    ip: normalizeIp(ip),
    userAgent,
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  });
}

export async function consumePgsoftLaunchTicket(ticket = '') {
  const now = new Date();
  return PgsoftSession.findOneAndUpdate(
    {
      launchTicket: String(ticket || ''),
      launchTicketExpiresAt: { $gt: now },
      launchUsedAt: null,
      status: 'active',
      expiresAt: { $gt: now },
    },
    { $set: { launchUsedAt: now, lastUsedAt: now } },
    { new: true }
  ).populate('user');
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

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findUserByPgsoftPlayerName(playerName = '') {
  const normalizedName = String(playerName || '').trim();
  if (!normalizedName) return null;

  const session = await PgsoftSession.findOne({
    playerNameLower: normalizedName.toLowerCase(),
    status: 'active',
  }).sort({ createdAt: -1 }).populate('user');

  if (session?.user && session.user.status === 'active') return { user: session.user, session };

  // Compatibility with sessions created before playerNameLower was added.
  const legacySession = await PgsoftSession.findOne({
    playerName: { $regex: `^${escapeRegex(normalizedName)}$`, $options: 'i' },
    status: 'active',
  }).sort({ createdAt: -1 }).populate('user');
  if (legacySession?.user && legacySession.user.status === 'active') return { user: legacySession.user, session: legacySession };

  const prefix = String(env.PGSOFT_PLAYER_PREFIX || '7xbet_').replace(/[^a-zA-Z0-9_]/g, '');
  let raw = normalizedName;
  if (prefix && raw.toLowerCase().startsWith(prefix.toLowerCase())) raw = raw.slice(prefix.length);
  raw = raw.replace(/^[a-zA-Z]{3,5}_/, '');

  let user = null;
  if (/^[0-9a-f]{24}$/i.test(raw)) {
    user = await User.findOne({ _id: raw, status: 'active' });
  }
  if (!user) {
    user = await User.findOne({
      status: 'active',
      $or: [
        { userId: raw },
        { username: raw },
        { email: raw.toLowerCase() },
      ],
    });
  }

  if (!user) return null;

  return {
    user,
    session: {
      playerName: normalizedName,
      currency: resolvePgsoftCurrency(user),
    },
  };
}

export function getPgsoftGameList() {
  const raw = String(env.PGSOFT_GAME_LIST_JSON || env.PGSOFT_GAME_LIST || '').trim();
  if (!raw) return env.PGSOFT_ENABLE_WEB_LOBBY ? DEFAULT_GAMES : [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return env.PGSOFT_ENABLE_WEB_LOBBY ? DEFAULT_GAMES : [];

    const games = parsed
      .map((item) => ({
        id: String(item.id || item.gameId || item.code || '').trim(),
        title: String(item.title || item.name || item.displayName || item.id || '').trim(),
        category: String(item.category || 'Slots'),
        image: String(item.image || '/images/pgsoft/pgsoft-lobby.svg'),
        description: String(item.description || 'PG SOFT game'),
        launchType: String(item.launchType || 'game-entry'),
      }))
      .filter((item) => item.id && item.title);

    if (env.PGSOFT_ENABLE_WEB_LOBBY && !games.some((game) => game.id === 'lobby')) {
      games.unshift(DEFAULT_GAMES[0]);
    }
    return games;
  } catch (_) {
    return env.PGSOFT_ENABLE_WEB_LOBBY ? DEFAULT_GAMES : [];
  }
}

function getLaunchBaseUrl() {
  const baseUrl = String(env.PGSOFT_API_DOMAIN || '').trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('PGSOFT_API_DOMAIN is not configured.');
  return baseUrl;
}

export function isPgsoftConfigured() {
  return Boolean(env.PGSOFT_ENABLED && env.PGSOFT_API_DOMAIN && env.PGSOFT_OPERATOR_TOKEN && env.PGSOFT_SECRET_KEY);
}

export function buildPgsoftLaunchRequest({ session, clientIp = '', userAgent = '' }) {
  if (!session) throw new Error('PG SOFT session is required.');
  if (!env.PGSOFT_OPERATOR_TOKEN) throw new Error('PGSOFT_OPERATOR_TOKEN is not configured.');

  const traceId = crypto.randomUUID();
  const url = `${getLaunchBaseUrl()}/external-game-launcher/api/v1/GetLaunchURLHTML?trace_id=${encodeURIComponent(traceId)}`;
  const gameId = String(session.gameId || '').trim();
  const isLobby = ['lobby', 'web-lobby', 'web_lobby'].includes(gameId.toLowerCase());
  const language = normalizePgsoftLanguage(session.language);
  const extraArgs = new URLSearchParams();
  extraArgs.set('ops', session.token);
  extraArgs.set('l', language);

  let path;
  let urlType;

  if (isLobby) {
    path = '/web-lobby/games/';
    urlType = 'web-lobby';
    if (Number(env.PGSOFT_WEB_LOBBY_WIDTH || 0) >= 930) {
      extraArgs.set('width', String(Number(env.PGSOFT_WEB_LOBBY_WIDTH)));
    }
  } else {
    if (!/^\d+$/.test(gameId)) throw new Error('PG SOFT game ID must be numeric or "lobby".');
    path = `/${gameId}/index.html`;
    urlType = 'game-entry';
    extraArgs.set('btt', String(Number(env.PGSOFT_DEFAULT_BET_TYPE || 1)));
    extraArgs.set('op', String(session.user?._id || session.user || ''));
    extraArgs.set('f', env.PGSOFT_GAME_EXIT_URL || env.FRONTEND_URL || 'https://7xbet.asia');
    extraArgs.set('oc', String(Number(env.PGSOFT_ORIENTATION_CHECK || 1)));
  }

  const body = new URLSearchParams();
  body.set('operator_token', env.PGSOFT_OPERATOR_TOKEN);
  body.set('path', path);
  body.set('extra_args', extraArgs.toString());
  body.set('url_type', urlType);
  body.set('client_ip', normalizeIp(clientIp || session.ip || '') || '0.0.0.0');
  if (Number(env.PGSOFT_GROUP_ID || 0) > 0) body.set('group_id', String(Number(env.PGSOFT_GROUP_ID)));

  return {
    traceId,
    url,
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent || session.userAgent || '7XBET-PGSOFT-Integration/2.0',
    },
  };
}

export async function requestPgsoftLaunchHtml({ session, clientIp = '', userAgent = '' }) {
  if (!isPgsoftConfigured()) throw new Error('PG SOFT integration is not fully configured.');

  const request = buildPgsoftLaunchRequest({ session, clientIp, userAgent });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(env.PGSOFT_REQUEST_TIMEOUT_MS || 10000)));
  const retryCount = Math.max(0, Math.min(2, Number(env.PGSOFT_LAUNCH_RETRY_COUNT || 1)));
  let lastError;

  try {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const response = await fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: request.body.toString(),
          signal: controller.signal,
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'text/html; charset=utf-8';

        if (response.ok) {
          if (!contentType.toLowerCase().includes('text/html')) {
            const text = buffer.toString('utf8').slice(0, 1000);
            throw new Error(text || `PG SOFT launch returned unexpected content type: ${contentType}`);
          }

          return {
            buffer,
            contentType,
            traceId: request.traceId,
          };
        }

        const text = buffer.toString('utf8').slice(0, 1000);
        const error = new Error(text || `PG SOFT launch failed with HTTP ${response.status}. Trace ID: ${request.traceId}`);
        error.status = response.status;
        lastError = error;

        if (![500, 504].includes(response.status) || attempt >= retryCount) throw error;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('PG SOFT launch request timed out.');
        lastError = error;
        const retryableNetworkError = !Number.isInteger(error?.status);
        if ((!retryableNetworkError && ![500, 504].includes(error.status)) || attempt >= retryCount) throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }

    throw lastError || new Error('PG SOFT launch failed.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPgsoftLaunchHtml({ user, gameId, language = 'en', clientIp = '', userAgent = '' }) {
  const session = await createPgsoftSession(user, { gameId, language, ip: clientIp, userAgent });
  const result = await requestPgsoftLaunchHtml({ session, clientIp, userAgent });
  return { ...result, session };
}
