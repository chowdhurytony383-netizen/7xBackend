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
  CRYPTO_PROVIDER: process.env.CRYPTO_PROVIDER || 'tatum',
  TATUM_API_KEY: process.env.TATUM_API_KEY || '',
  TATUM_API_BASE_URL: process.env.TATUM_API_BASE_URL || 'https://api.tatum.io',
  CRYPTO_AUTO_CREATE_ADDRESSES: String(process.env.CRYPTO_AUTO_CREATE_ADDRESSES || 'true').toLowerCase() === 'true',
  CRYPTO_ENABLED_METHODS: process.env.CRYPTO_ENABLED_METHODS || 'BTC,ETH,USDT_ERC20,USDT_TRC20,LTC',
  TATUM_BTC_XPUB: process.env.TATUM_BTC_XPUB || '',
  TATUM_ETH_XPUB: process.env.TATUM_ETH_XPUB || '',
  TATUM_TRON_XPUB: process.env.TATUM_TRON_XPUB || '',
  TATUM_LTC_XPUB: process.env.TATUM_LTC_XPUB || '',
  TATUM_BSC_XPUB: process.env.TATUM_BSC_XPUB || '',
  CRYPTO_WEBHOOK_SECRET: process.env.CRYPTO_WEBHOOK_SECRET || '',
};

export const isProduction = env.NODE_ENV === 'production';
