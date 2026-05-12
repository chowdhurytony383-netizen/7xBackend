import crypto from 'crypto';
import JiliToken from '../models/JiliToken.js';
import { env } from '../config/env.js';

function firstNonEmptyUrl(value = '') {
  return String(value || '')
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)[0] || '';
}

function normalizeBaseUrl(url = '') {
  const value = firstNonEmptyUrl(url);
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function randomText(length = 6) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export function md5(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex');
}

export function getJiliDateString(date = new Date()) {
  const utcMinus4Ms = date.getTime() - 4 * 60 * 60 * 1000;
  const shifted = new Date(utcMinus4Ms);
  const year = String(shifted.getUTCFullYear()).slice(-2);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate());
  return `${year}${month}${day}`;
}

export function getJiliKeyG({ agentId = env.JILI_AGENT_ID, agentKey = env.JILI_AGENT_KEY, date = new Date() } = {}) {
  return md5(`${getJiliDateString(date)}${agentId}${agentKey}`);
}

export function generateJiliKey(paramsInOrder = [], { agentId = env.JILI_AGENT_ID, agentKey = env.JILI_AGENT_KEY } = {}) {
  const finalParams = [...paramsInOrder, ['AgentId', agentId]];
  const queryString = finalParams
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join('&');
  const keyG = getJiliKeyG({ agentId, agentKey });
  const hash = md5(`${queryString}${keyG}`);
  return `${randomText(6)}${hash}${randomText(6)}`;
}

export function getJiliApiBaseUrl() {
  return normalizeBaseUrl(env.JILI_API_BASE_URL);
}

export function normalizeCurrency(currency = '') {
  const value = String(currency || '').trim().toUpperCase();
  return value || env.JILI_CURRENCY || 'BDT';
}

export function getJiliSupportedCurrencies() {
  return String(env.JILI_SUPPORTED_CURRENCIES || '')
    .split(',')
    .map((currency) => normalizeCurrency(currency))
    .filter(Boolean);
}

export function getJiliFallbackCurrency() {
  const supported = getJiliSupportedCurrencies();
  const configuredFallback = normalizeCurrency(env.JILI_UNSUPPORTED_CURRENCY_FALLBACK || 'USD');

  if (!supported.length || supported.includes(configuredFallback)) return configuredFallback;

  const configuredDefault = normalizeCurrency(env.JILI_CURRENCY || 'BDT');
  if (supported.includes(configuredDefault)) return configuredDefault;

  return supported[0] || configuredFallback || 'USD';
}

export function resolveJiliCurrency(currency = '') {
  const requested = normalizeCurrency(currency);
  const supported = getJiliSupportedCurrencies();

  // Backward compatible behavior: if no supported list is configured, send the requested currency.
  if (!supported.length) return requested;

  return supported.includes(requested) ? requested : getJiliFallbackCurrency();
}

export function getJiliPlayerCurrency(user = {}) {
  if (env.JILI_FORCE_BIND_CURRENCY) return resolveJiliCurrency(env.JILI_CURRENCY);

  // IMPORTANT: when multi-currency is enabled, prefer the user's currency first.
  // If that currency is not enabled by JILI for this AgentId, safely fall back
  // before creating the JILI token and /auth response.
  return resolveJiliCurrency(
    user.currency
    || user.walletCurrency
    || user.preferredCurrency
    || env.JILI_CURRENCY
    || 'BDT'
  );
}

export function buildJiliUsername(user = {}, currencyOverride = '') {
  const prefix = String(env.JILI_USERNAME_PREFIX || '7xbet_')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '') || '7xbet_';

  const rawId = user.userId || user.username || user._id || '';
  const cleanId = String(rawId)
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 40);

  // JILI binds a player account to the first currency returned by /auth.
  // For multi-currency, use a currency-specific JILI username so the same site user
  // can safely open JILI under BDT/INR/USD/etc. without currency mismatch.
  if (!env.JILI_FORCE_BIND_CURRENCY) {
    const currency = normalizeCurrency(currencyOverride || getJiliPlayerCurrency(user)).toLowerCase();
    return `${prefix}${currency}_${cleanId}`.slice(0, 50);
  }

  return `${prefix}${cleanId}`.slice(0, 50);
}

export async function createJiliTokenForUser(user, { gameId = '', ip = '', userAgent = '' } = {}) {
  const ttlMinutes = Number.isFinite(env.JILI_TOKEN_TTL_MINUTES) && env.JILI_TOKEN_TTL_MINUTES > 0
    ? env.JILI_TOKEN_TTL_MINUTES
    : 60;
  const token = crypto.randomBytes(32).toString('hex');
  const currency = getJiliPlayerCurrency(user);
  const username = buildJiliUsername(user, currency);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await JiliToken.create({
    token,
    user: user._id,
    username,
    currency,
    gameId: String(gameId || ''),
    ip,
    userAgent,
    expiresAt,
  });

  return { token, username, currency, expiresAt };
}

export async function findValidJiliToken(token) {
  if (!token) return null;

  const record = await JiliToken.findOne({
    token: String(token),
    status: 'active',
    expiresAt: { $gt: new Date() },
  }).populate('user');

  if (!record || !record.user || record.user.status !== 'active') {
    return null;
  }

  record.lastUsedAt = new Date();
  await record.save();
  return record;
}

export function jiliError(errorCode, message, extra = {}) {
  return {
    errorCode,
    message,
    ...extra,
  };
}

export function jiliSuccess({ username, currency, balance, txId, token, extra = {} }) {
  const response = {
    errorCode: 0,
    message: 'success',
    username,
    currency: normalizeCurrency(currency),
    balance: Number(Number(balance || 0).toFixed(2)),
    ...extra,
  };

  if (txId !== undefined && txId !== null) response.txId = txId;
  if (token) response.token = token;
  return response;
}

export async function callJiliApi(path, paramsInOrder = [], ignoredParams = {}) {
  const baseUrl = getJiliApiBaseUrl();
  if (!baseUrl) {
    throw new Error('JILI_API_BASE_URL is not configured.');
  }
  if (!env.JILI_AGENT_ID || !env.JILI_AGENT_KEY) {
    throw new Error('JILI_AGENT_ID or JILI_AGENT_KEY is not configured.');
  }

  const params = new URLSearchParams();
  for (const [key, value] of paramsInOrder) params.append(key, String(value ?? ''));
  params.append('AgentId', env.JILI_AGENT_ID);
  params.append('Key', generateJiliKey(paramsInOrder));

  for (const [key, value] of Object.entries(ignoredParams || {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.Message || data?.message || `JILI API failed with HTTP ${response.status}`);
  }

  return data;
}

export async function getJiliLaunchUrl({ user, gameId, lang = env.JILI_DEFAULT_LANG || 'en-US', platform = 'WEB', ip = '', userAgent = '' }) {
  const { token } = await createJiliTokenForUser(user, { gameId, ip, userAgent });
  const homeUrl = env.JILI_HOME_URL || env.FRONTEND_URL || 'https://7xbet.asia';

  const data = await callJiliApi(
    '/singleWallet/LoginWithoutRedirect',
    [
      ['Token', token],
      ['GameId', Number(gameId)],
      ['Lang', lang || 'en-US'],
    ],
    {
      HomeUrl: homeUrl,
      Platform: platform || 'WEB',
      disableFullScreen: env.JILI_DISABLE_FULLSCREEN ? 1 : undefined,
    }
  );

  const errorCode = Number(data?.ErrorCode ?? data?.errorCode ?? 0);
  if (errorCode !== 0) {
    throw new Error(data?.Message || data?.message || `JILI launch failed: ${errorCode}`);
  }

  let launchUrl = data?.Data ?? data?.data ?? '';

  if (typeof launchUrl === 'string') {
    try {
      launchUrl = JSON.parse(`"${launchUrl.replace(/"/g, '\\"')}"`);
    } catch (_) {}
  }

  return {
    launchUrl,
    providerResponse: data,
    token,
  };
}

export async function getJiliGameList() {
  const data = await callJiliApi('/GetGameList', []);
  const errorCode = Number(data?.ErrorCode ?? data?.errorCode ?? 0);
  if (errorCode !== 0) {
    throw new Error(data?.Message || data?.message || `JILI game list failed: ${errorCode}`);
  }
  const list = data?.Data || data?.data || [];
  return Array.isArray(list) ? list : [];
}
