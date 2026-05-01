import { env } from '../config/env.js';

export const DEFAULT_CRYPTO_METHODS = [
  {
    key: 'BTC',
    coin: 'BTC',
    network: 'Bitcoin',
    displayName: 'Bitcoin',
    symbol: 'BTC',
    xpubEnvKey: 'TATUM_BTC_XPUB',
    addressFamily: 'bitcoin',
    confirmations: 1,
    sortOrder: 10,
    warning: 'Only send BTC on the Bitcoin network to this address. Sending another asset may cause permanent loss.',
  },
  {
    key: 'ETH',
    coin: 'ETH',
    network: 'Ethereum ERC20',
    displayName: 'Ethereum',
    symbol: 'ETH',
    xpubEnvKey: 'TATUM_ETH_XPUB',
    addressFamily: 'ethereum',
    confirmations: 12,
    sortOrder: 20,
    warning: 'Only send ETH on the Ethereum network to this address.',
  },
  {
    key: 'USDT_ERC20',
    coin: 'USDT',
    network: 'Ethereum ERC20',
    displayName: 'USDT ERC20',
    symbol: 'USDT',
    xpubEnvKey: 'TATUM_ETH_XPUB',
    addressFamily: 'ethereum',
    confirmations: 12,
    sortOrder: 30,
    warning: 'Only send USDT on Ethereum ERC20 to this address. Do not send TRC20/BEP20 here.',
  },
  {
    key: 'USDT_TRC20',
    coin: 'USDT',
    network: 'TRON TRC20',
    displayName: 'USDT TRC20',
    symbol: 'USDT',
    xpubEnvKey: 'TATUM_TRON_XPUB',
    addressFamily: 'tron',
    confirmations: 20,
    sortOrder: 40,
    warning: 'Only send USDT on TRON TRC20 to this address. Do not send ERC20/BEP20 here.',
  },
  {
    key: 'LTC',
    coin: 'LTC',
    network: 'Litecoin',
    displayName: 'Litecoin',
    symbol: 'LTC',
    xpubEnvKey: 'TATUM_LTC_XPUB',
    addressFamily: 'litecoin',
    confirmations: 6,
    sortOrder: 50,
    warning: 'Only send LTC on the Litecoin network to this address.',
  },
  {
    key: 'BNB',
    coin: 'BNB',
    network: 'BNB Smart Chain BEP20',
    displayName: 'BNB Smart Chain',
    symbol: 'BNB',
    xpubEnvKey: 'TATUM_BSC_XPUB',
    addressFamily: 'bsc',
    confirmations: 15,
    sortOrder: 60,
    warning: 'Only send BNB on BNB Smart Chain to this address.',
  },
  {
    key: 'USDT_BEP20',
    coin: 'USDT',
    network: 'BNB Smart Chain BEP20',
    displayName: 'USDT BEP20',
    symbol: 'USDT',
    xpubEnvKey: 'TATUM_BSC_XPUB',
    addressFamily: 'bsc',
    confirmations: 15,
    sortOrder: 70,
    warning: 'Only send USDT on BNB Smart Chain BEP20 to this address.',
  },
];

function cleanValue(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

export function getEnabledCryptoKeys() {
  return String(env.CRYPTO_ENABLED_METHODS || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function getDefaultCryptoMethod(key) {
  const normalized = String(key || '').trim().toUpperCase();
  return DEFAULT_CRYPTO_METHODS.find((method) => method.key === normalized) || null;
}

export function getXpubForMethod(method) {
  const envKey = method?.xpubEnvKey;
  return envKey ? cleanValue(process.env[envKey] || env[envKey] || '') : '';
}

export function getCryptoProviderName() {
  return String(env.CRYPTO_PROVIDER || 'tatum').toLowerCase();
}
