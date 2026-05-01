import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';
import { getTatumRateBySymbol } from './tatumService.js';

const cache = new Map();

function extractRate(payload) {
  const candidates = [
    payload?.value,
    payload?.rate,
    payload?.price,
    payload?.data?.value,
    payload?.data?.rate,
    payload?.data?.price,
    payload?.result?.value,
    payload?.result?.rate,
    payload?.result?.price,
  ];

  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number) && number > 0) return number;
  }

  // Some APIs return an object with unknown key names. Scan shallow numeric values as a fallback.
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
  }

  return 0;
}

function normalizeFiat(value) {
  const code = String(value || env.CRYPTO_DEFAULT_FIAT || 'BDT').trim().toUpperCase();
  return /^[A-Z]{3,5}$/.test(code) ? code : 'BDT';
}

export async function getCryptoFiatRate(symbol, fiatCurrency) {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  const cleanFiat = normalizeFiat(fiatCurrency);
  const key = `${cleanSymbol}:${cleanFiat}`;
  const cached = cache.get(key);
  const now = Date.now();

  if (cached && now - cached.time < env.CRYPTO_PRICE_CACHE_MS) return cached;

  const payload = await getTatumRateBySymbol(cleanSymbol, cleanFiat);
  const rate = extractRate(payload);
  if (!rate) throw new AppError(`Unable to get ${cleanSymbol}/${cleanFiat} exchange rate`, 502);

  const result = {
    symbol: cleanSymbol,
    fiatCurrency: cleanFiat,
    rate,
    payload,
    source: 'tatum:v4:data/rate/symbol',
    time: now,
  };

  cache.set(key, result);
  return result;
}

export async function convertCryptoToFiat({ symbol, amountCrypto, fiatCurrency }) {
  const amount = Number(amountCrypto || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Crypto amount must be greater than 0', 400);

  const rateInfo = await getCryptoFiatRate(symbol, fiatCurrency);
  const amountFiat = Number((amount * rateInfo.rate).toFixed(2));

  return {
    ...rateInfo,
    amountCrypto: amount,
    amountFiat,
  };
}
