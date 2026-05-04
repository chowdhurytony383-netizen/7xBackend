import dotenv from 'dotenv';

dotenv.config();

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3000),
  MONGO_URI: required('MONGO_URI', 'mongodb://127.0.0.1:27017/7xbet'),
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5174',
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET', 'dev_access_secret_change_me'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_me'),
  ACCESS_TOKEN_EXPIRES: process.env.ACCESS_TOKEN_EXPIRES || '15m',
  REFRESH_TOKEN_EXPIRES: process.env.REFRESH_TOKEN_EXPIRES || '7d',
  COOKIE_SECURE: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
  ADMIN_NAME: process.env.ADMIN_NAME || '7XBET Admin',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@7xbet.local',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Admin@123456',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  RAZORPAYX_ACCOUNT_NUMBER: process.env.RAZORPAYX_ACCOUNT_NUMBER || '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID || '',
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET || '',
  OAUTH_CALLBACK_BASE_URL: process.env.OAUTH_CALLBACK_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  CORS_ORIGIN: process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5174',
  API_RATE_LIMIT_WINDOW_MS: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  API_RATE_LIMIT_MAX: Number(process.env.API_RATE_LIMIT_MAX || 10000),

  CRYPTO_PROVIDER: process.env.CRYPTO_PROVIDER || 'tatum',
  TATUM_API_KEY: process.env.TATUM_API_KEY || '',
  TATUM_API_BASE_URL: process.env.TATUM_API_BASE_URL || 'https://api.tatum.io',
  CRYPTO_AUTO_CREATE_ADDRESSES: String(process.env.CRYPTO_AUTO_CREATE_ADDRESSES || 'true').toLowerCase() === 'true',
  CRYPTO_ENABLED_METHODS: process.env.CRYPTO_ENABLED_METHODS || 'BTC,ETH,USDT_ERC20,USDT_TRC20,LTC,BNB',
  TATUM_BTC_XPUB: process.env.TATUM_BTC_XPUB || '',
  TATUM_ETH_XPUB: process.env.TATUM_ETH_XPUB || '',
  TATUM_TRON_XPUB: process.env.TATUM_TRON_XPUB || '',
  TATUM_LTC_XPUB: process.env.TATUM_LTC_XPUB || '',
  TATUM_BSC_XPUB: process.env.TATUM_BSC_XPUB || '',
  TATUM_BSC_SIGNATURE_ID: process.env.TATUM_BSC_SIGNATURE_ID || '',
  CRYPTO_WEBHOOK_SECRET: process.env.CRYPTO_WEBHOOK_SECRET || '',
  CRYPTO_WEBHOOK_URL: process.env.CRYPTO_WEBHOOK_URL || '',
  CRYPTO_CREDIT_ON_BLOCK: String(process.env.CRYPTO_CREDIT_ON_BLOCK || 'true').toLowerCase() === 'true',
  CRYPTO_PRICE_CACHE_MS: Number(process.env.CRYPTO_PRICE_CACHE_MS || 60000),
  CRYPTO_DEFAULT_FIAT: process.env.CRYPTO_DEFAULT_FIAT || 'BDT',

  COMPANY_BTC_ADDRESS: process.env.COMPANY_BTC_ADDRESS || '',
  COMPANY_ETH_ADDRESS: process.env.COMPANY_ETH_ADDRESS || '',
  COMPANY_TRON_ADDRESS: process.env.COMPANY_TRON_ADDRESS || '',
  COMPANY_LTC_ADDRESS: process.env.COMPANY_LTC_ADDRESS || '',
  COMPANY_BSC_ADDRESS: process.env.COMPANY_BSC_ADDRESS || '',

  CRYPTO_SWEEP_ENABLED: String(process.env.CRYPTO_SWEEP_ENABLED || 'false').toLowerCase() === 'true',
  CRYPTO_SWEEP_MODE: process.env.CRYPTO_SWEEP_MODE || 'manual',
  CRYPTO_SWEEP_DRY_RUN: String(process.env.CRYPTO_SWEEP_DRY_RUN || 'true').toLowerCase() === 'true',
  CRYPTO_SWEEP_BNB_GAS_RESERVE: Number(process.env.CRYPTO_SWEEP_BNB_GAS_RESERVE || '0.00025'),
  CRYPTO_SWEEP_BNB_GAS_LIMIT: Number(process.env.CRYPTO_SWEEP_BNB_GAS_LIMIT || '30000'),
  CRYPTO_SWEEP_BNB_GAS_PRICE: process.env.CRYPTO_SWEEP_BNB_GAS_PRICE || '',
  CRYPTO_SWEEP_MIN_BNB: Number(process.env.CRYPTO_SWEEP_MIN_BNB || '0.0002'),
  CRYPTO_AUTO_SWEEP_ON_CREDIT: String(process.env.CRYPTO_AUTO_SWEEP_ON_CREDIT || 'false').toLowerCase() === 'true',
  CRYPTO_AUTO_SWEEP_COINS: process.env.CRYPTO_AUTO_SWEEP_COINS || 'BNB',

  // Kept only for old direct_test compatibility. Do not use in production.
  TATUM_BSC_MNEMONIC: process.env.TATUM_BSC_MNEMONIC || '',
};

export const isProduction = env.NODE_ENV === 'production';
