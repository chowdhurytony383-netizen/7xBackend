import FxRateCache from '../models/FxRateCache.js';

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function roundMoney(value) {
  const n = Number(value || 0);
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function envRateFor(currency) {
  const key = `AFFILIATE_USD_TO_${String(currency || '').toUpperCase()}_RATE`;
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function fallbackRate(currency) {
  const code = String(currency || 'BDT').toUpperCase();
  const direct = envRateFor(code);
  if (direct) return direct;
  const fallbackMap = {
    USD: 1,
    BDT: Number(process.env.AFFILIATE_USD_TO_BDT_RATE || 122),
    INR: Number(process.env.AFFILIATE_USD_TO_INR_RATE || 83),
    PKR: Number(process.env.AFFILIATE_USD_TO_PKR_RATE || 278),
    NPR: Number(process.env.AFFILIATE_USD_TO_NPR_RATE || 133),
    LKR: Number(process.env.AFFILIATE_USD_TO_LKR_RATE || 300),
    PHP: Number(process.env.AFFILIATE_USD_TO_PHP_RATE || 57),
    THB: Number(process.env.AFFILIATE_USD_TO_THB_RATE || 36),
    MYR: Number(process.env.AFFILIATE_USD_TO_MYR_RATE || 4.7),
    IDR: Number(process.env.AFFILIATE_USD_TO_IDR_RATE || 16000),
  };
  return Number(fallbackMap[code] || fallbackMap.BDT || 122);
}

async function fetchUsdRates() {
  const url = process.env.AFFILIATE_FX_API_URL || 'https://open.er-api.com/v6/latest/USD';
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const json = await response.json();
  const rates = json?.rates || json?.conversion_rates || json?.data?.rates;
  if (!response.ok || !rates || typeof rates !== 'object') {
    throw new Error('Unable to fetch USD FX rates');
  }
  return { rates, source: url };
}

export async function getUsdRates({ forceRefresh = false } = {}) {
  const key = dateKey();
  if (!forceRefresh) {
    const cached = await FxRateCache.findOne({ base: 'USD', dateKey: key }).lean();
    if (cached?.rates) return cached;
  }

  try {
    const fetched = await fetchUsdRates();
    const payload = { base: 'USD', dateKey: key, rates: fetched.rates, source: fetched.source, fetchedAt: new Date() };
    await FxRateCache.updateOne({ base: 'USD', dateKey: key }, { $set: payload }, { upsert: true });
    return payload;
  } catch (error) {
    const latest = await FxRateCache.findOne({ base: 'USD' }).sort({ dateKey: -1 }).lean();
    if (latest?.rates) return { ...latest, source: `${latest.source || 'cache'} (cached fallback)` };
    throw error;
  }
}

export async function getUsdToCurrencyRate(currency, options = {}) {
  const code = String(currency || 'BDT').toUpperCase();
  if (code === 'USD') return { rate: 1, source: 'USD', dateKey: dateKey() };

  const direct = envRateFor(code);
  if (direct) return { rate: direct, source: 'env', dateKey: dateKey() };

  try {
    const fx = await getUsdRates(options);
    const rate = Number(fx.rates?.[code]);
    if (Number.isFinite(rate) && rate > 0) return { rate, source: fx.source || 'api/cache', dateKey: fx.dateKey };
  } catch (_) {
    // fallback below
  }

  return { rate: fallbackRate(code), source: 'fallback/env', dateKey: dateKey() };
}

export async function convertUsdToCurrency(amountUsd, currency, options = {}) {
  const usd = Number(amountUsd || 0);
  const { rate, source, dateKey: key } = await getUsdToCurrencyRate(currency, options);
  return {
    amount: roundMoney(usd * rate),
    rate,
    source,
    dateKey: key,
    currency: String(currency || 'BDT').toUpperCase(),
  };
}
