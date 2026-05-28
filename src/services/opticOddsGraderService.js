import { env } from '../config/env.js';

const DEFAULT_BASE_URL = 'https://api.opticodds.com/api/v3';
const DEFAULT_GRADER_PATHS = ['/grader/odds', '/grader-odds'];

function csv(value, fallback = []) {
  const source = String(value || '').trim();
  if (!source) return fallback;
  return source.split(',').map((item) => item.trim()).filter(Boolean);
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function opticOddsApiKey() {
  return process.env.OPTICODDS_API_KEY
    || process.env.OPTIC_ODDS_API_KEY
    || process.env.SPORTS_OPTICODDS_API_KEY
    || '';
}

function baseUrl() {
  return String(process.env.OPTICODDS_API_BASE_URL || process.env.OPTIC_ODDS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function timeoutMs() {
  const value = Number(process.env.OPTICODDS_GRADER_TIMEOUT_MS || process.env.OPTICODDS_TIMEOUT_MS || env.SPORTS_PROVIDER_TIMEOUT_MS || 15000);
  return Number.isFinite(value) && value >= 1000 ? value : 15000;
}

function authQueryParamName() {
  return String(process.env.OPTICODDS_AUTH_QUERY_PARAM || 'key').trim() || 'key';
}

function safeString(value = '') {
  return String(value ?? '').trim();
}

function marketForGrader(bet = {}) {
  return safeString(
    bet.marketDisplayName
    || bet.providerMarketName
    || bet.marketName
    || bet.marketKey
    || 'Moneyline'
  );
}

function selectionForGrader(bet = {}) {
  return safeString(
    bet.selectionDisplayName
    || bet.providerSelectionName
    || bet.selectionName
  );
}

function buildUrl(path, params = {}) {
  const url = new URL(`${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  const key = opticOddsApiKey();
  if (key) url.searchParams.set(authQueryParamName(), key);
  Object.entries(params).forEach(([name, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(name, String(value));
  });
  return url;
}

async function fetchGrader(path, params) {
  const key = opticOddsApiKey();
  if (!key) throw new Error('OPTICODDS_API_KEY is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(buildUrl(path, params), {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': key,
        'x-api-key': key,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { rawText: text };
    }

    if (!response.ok) {
      const message = payload?.message || payload?.error || payload?.errors || response.statusText || 'OpticOdds grader request failed';
      const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
      error.status = response.status;
      error.data = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function unwrapData(payload = {}) {
  if (payload?.data && !Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload?.data)) return payload.data[0] || {};
  return payload || {};
}

function normalizeGraderResult(value = '') {
  const text = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!text) return 'UNKNOWN';
  if (['won', 'win', 'winner'].includes(text)) return 'WON';
  if (['lost', 'loss', 'loser'].includes(text)) return 'LOST';
  if (['refunded', 'refund', 'push', 'void', 'cancelled', 'canceled'].includes(text)) return 'REFUNDED';
  if (['half won', 'half win'].includes(text)) return 'HALF_WON';
  if (['half lost', 'half loss'].includes(text)) return 'HALF_LOST';
  if (text.includes('pending') || text.includes('not completed') || text.includes('live') || text.includes('not started')) return 'PENDING';
  if (text.includes('won')) return 'WON';
  if (text.includes('lost')) return 'LOST';
  if (text.includes('refund') || text.includes('push') || text.includes('void')) return 'REFUNDED';
  return text.toUpperCase().replace(/\s+/g, '_');
}

function isPendingError(error) {
  const text = `${error?.message || ''} ${JSON.stringify(error?.data || {})}`.toLowerCase();
  return [
    'game is still live',
    'game has not started',
    'game has not completed',
    'pending',
    'not completed',
    'not started',
    'score data not found',
  ].some((needle) => text.includes(needle));
}

export function opticOddsGraderConfigured() {
  return Boolean(opticOddsApiKey());
}

export function shouldUseOpticOddsGrader(provider = '') {
  if (!String(provider || '').toLowerCase().includes('opticodds')) return false;
  return boolEnv('OPTICODDS_GRADER_ENABLED', true);
}

export async function gradeOpticOddsBet(bet = {}) {
  const fixtureId = safeString(bet.providerEventId);
  const market = marketForGrader(bet);
  const name = selectionForGrader(bet);

  if (!fixtureId || !market || !name) {
    return {
      status: 'UNSUPPORTED',
      reason: 'Missing fixture_id, market, or selection name for OpticOdds grader',
      raw: null,
    };
  }

  const params = {
    fixture_id: fixtureId,
    market,
    name,
    show_live_results: boolEnv('OPTICODDS_GRADER_SHOW_LIVE_RESULTS', false) ? 'true' : undefined,
    void_substitutes: boolEnv('OPTICODDS_GRADER_VOID_SUBSTITUTES', true) ? 'true' : undefined,
  };

  const paths = csv(process.env.OPTICODDS_GRADER_PATH || '', DEFAULT_GRADER_PATHS);
  let lastError = null;

  for (const path of paths) {
    try {
      const payload = await fetchGrader(path, params);
      const data = unwrapData(payload);
      const providerResult = data.result || data.outcome || data.status || data.grade || data.settlement || data.bet_status || '';
      return {
        status: normalizeGraderResult(providerResult),
        providerResult,
        reason: data.reason || data.message || '',
        raw: payload,
      };
    } catch (error) {
      lastError = error;
      if (isPendingError(error)) {
        return {
          status: 'PENDING',
          reason: error.message || 'OpticOdds grader says result is pending',
          raw: error.data || null,
        };
      }
      if (![400, 404, 405, 422].includes(Number(error.status || 0))) throw error;
    }
  }

  throw lastError || new Error('No OpticOdds grader endpoint path worked');
}
