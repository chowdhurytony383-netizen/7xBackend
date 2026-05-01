import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';

const addressPathByFamily = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  tron: 'tron',
  litecoin: 'litecoin',
  bsc: 'bsc',
};

function getAddressFromTatumResponse(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return payload.address || payload.data?.address || payload.result?.address || '';
}

export async function generateTatumDepositAddress({ method, xpub, index }) {
  if (!env.TATUM_API_KEY) {
    throw new AppError('TATUM_API_KEY is not configured', 503);
  }

  if (!xpub) {
    throw new AppError(`${method.xpubEnvKey || 'XPUB'} is not configured`, 503);
  }

  const familyPath = addressPathByFamily[method.addressFamily];
  if (!familyPath) {
    throw new AppError(`Unsupported crypto address family: ${method.addressFamily}`, 400);
  }

  const safeIndex = Math.max(0, Number(index) || 0);
  const endpoint = `${String(env.TATUM_API_BASE_URL || 'https://api.tatum.io').replace(/\/$/, '')}/v3/${familyPath}/address/${encodeURIComponent(xpub)}/${safeIndex}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'x-api-key': env.TATUM_API_KEY,
      accept: 'application/json',
    },
  });

  let payload = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = text;
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || text || 'Tatum address generation failed';
    throw new AppError(message, response.status || 502);
  }

  const address = getAddressFromTatumResponse(payload);
  if (!address) {
    throw new AppError('Tatum did not return a deposit address', 502);
  }

  return { address, raw: payload };
}
