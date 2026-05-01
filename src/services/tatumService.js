import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';

const addressPathByFamily = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  tron: 'tron',
  litecoin: 'litecoin',
  bsc: 'bsc',
};

function apiBase() {
  return String(env.TATUM_API_BASE_URL || 'https://api.tatum.io').replace(/\/$/, '');
}

async function parseJsonOrText(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return text;
  }
}

function getAddressFromTatumResponse(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return payload.address || payload.data?.address || payload.result?.address || '';
}

export async function tatumRequest(path, { method = 'GET', body, apiVersion = 'v3' } = {}) {
  if (!env.TATUM_API_KEY) throw new AppError('TATUM_API_KEY is not configured', 503);

  const response = await fetch(`${apiBase()}/${apiVersion}/${String(path).replace(/^\//, '')}`, {
    method,
    headers: {
      'x-api-key': env.TATUM_API_KEY,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJsonOrText(response);
  if (!response.ok) {
    const message = payload?.message || payload?.error || payload?.errorCode || JSON.stringify(payload) || 'Tatum API request failed';
    const error = new AppError(message, response.status || 502);
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function generateTatumDepositAddress({ method, xpub, index }) {
  if (!xpub) throw new AppError(`${method.xpubEnvKey || 'XPUB'} is not configured`, 503);

  const familyPath = addressPathByFamily[method.addressFamily];
  if (!familyPath) throw new AppError(`Unsupported crypto address family: ${method.addressFamily}`, 400);

  const safeIndex = Math.max(0, Number(index) || 0);
  const payload = await tatumRequest(`${familyPath}/address/${encodeURIComponent(xpub)}/${safeIndex}`);
  const address = getAddressFromTatumResponse(payload);
  if (!address) throw new AppError('Tatum did not return a deposit address', 502);
  return { address, raw: payload };
}

export async function getTatumRateBySymbol(symbol, fiatCurrency) {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  const cleanFiat = String(fiatCurrency || 'BDT').trim().toUpperCase();
  if (!cleanSymbol) throw new AppError('Crypto symbol is required for price conversion', 400);

  const params = new URLSearchParams({ symbol: cleanSymbol, basePair: cleanFiat });
  const payload = await tatumRequest(`data/rate/symbol?${params.toString()}`, { apiVersion: 'v4' });
  return payload;
}

export async function createTatumAddressSubscription({ chain, address, url }) {
  if (!chain) throw new AppError('Tatum subscription chain is required', 400);
  if (!address) throw new AppError('Tatum subscription address is required', 400);
  if (!url) throw new AppError('Tatum webhook URL is required', 400);

  return tatumRequest('subscription', {
    apiVersion: 'v4',
    method: 'POST',
    body: {
      type: 'ADDRESS_EVENT',
      attr: { chain, address, url },
    },
  });
}
