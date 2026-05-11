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

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 465),
  SMTP_SECURE: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME || process.env.APP_NAME || '7XBET',
  MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER || '',
  EMAIL_OTP_EXPIRES_MINUTES: Number(process.env.EMAIL_OTP_EXPIRES_MINUTES || 10),
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS: Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS || 60),
  EMAIL_OTP_MAX_ATTEMPTS: Number(process.env.EMAIL_OTP_MAX_ATTEMPTS || 5),

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

  // First deposit bonus rules.
  // The bonus is 100% of the first successful deposit, capped at BDT 15,000 or the user's local-currency equivalent.
  FIRST_DEPOSIT_BONUS_ENABLED: String(process.env.FIRST_DEPOSIT_BONUS_ENABLED || 'true').toLowerCase() === 'true',
  FIRST_DEPOSIT_BONUS_BASE_CAP_BDT: Number(process.env.FIRST_DEPOSIT_BONUS_BASE_CAP_BDT || 15000),
  FIRST_DEPOSIT_BONUS_USE_LIVE_RATES: String(process.env.FIRST_DEPOSIT_BONUS_USE_LIVE_RATES || 'true').toLowerCase() === 'true',
  FIRST_DEPOSIT_BONUS_EXCHANGE_API_URL: process.env.FIRST_DEPOSIT_BONUS_EXCHANGE_API_URL || 'https://open.er-api.com/v6/latest/BDT',
  FIRST_DEPOSIT_BONUS_RATE_CACHE_MS: Number(process.env.FIRST_DEPOSIT_BONUS_RATE_CACHE_MS || 6 * 60 * 60 * 1000),
  // Optional JSON override. Example: {"USD":0.0082,"INR":0.68,"XAF":5.0}
  FIRST_DEPOSIT_BONUS_BDT_RATES_JSON: process.env.FIRST_DEPOSIT_BONUS_BDT_RATES_JSON || '',
  // Optional direct cap override by currency. Example: {"USD":123,"BDT":15000}
  FIRST_DEPOSIT_BONUS_CAPS_JSON: process.env.FIRST_DEPOSIT_BONUS_CAPS_JSON || '',

  // Agent commission rules.
  // Percentage in the agent's own currency. Example: BDT 100 -> BDT 6, USD 1 -> USD 0.06.
  AGENT_DEPOSIT_COMMISSION_RATE: Number(process.env.AGENT_DEPOSIT_COMMISSION_RATE || 0.06),
  // Percentage in the agent's own currency. Example: BDT 100 -> BDT 2, USD 1 -> USD 0.02.
  AGENT_WITHDRAW_COMMISSION_RATE: Number(process.env.AGENT_WITHDRAW_COMMISSION_RATE || 0.02),
  // On/after this day of every month commissionBalance moves to agent balance.
  AGENT_COMMISSION_PAYOUT_DAY: Number(process.env.AGENT_COMMISSION_PAYOUT_DAY || 3),
  AGENT_COMMISSION_AUTO_PAYOUT: String(process.env.AGENT_COMMISSION_AUTO_PAYOUT || 'true').toLowerCase() === 'true',
  AGENT_COMMISSION_PAYOUT_TIMEZONE: process.env.AGENT_COMMISSION_PAYOUT_TIMEZONE || 'Asia/Dhaka',
  AGENT_COMMISSION_PAYOUT_CHECK_MS: Number(process.env.AGENT_COMMISSION_PAYOUT_CHECK_MS || 60 * 60 * 1000),

  // Withdrawal security rules.
  // true = users must verify email, submit full name, address, and identity document before any withdraw.
  WITHDRAW_KYC_REQUIRED: String(process.env.WITHDRAW_KYC_REQUIRED || 'true').toLowerCase() === 'true',
  // true = every deposit/bonus must be wagered before the user can withdraw that balance.
  WITHDRAW_TURNOVER_REQUIRED: String(process.env.WITHDRAW_TURNOVER_REQUIRED || 'true').toLowerCase() === 'true',
  // 1 = deposit 100 requires 100 total bets before withdraw; 2 = deposit 100 requires 200 bets.
  WITHDRAW_TURNOVER_MULTIPLIER: Number(process.env.WITHDRAW_TURNOVER_MULTIPLIER || 1),

  // Free/low-cost automatic sports betting system.
  // Requires a free odds API key such as The Odds API.
  SPORTS_AUTO_SYSTEM_ENABLED: String(process.env.SPORTS_AUTO_SYSTEM_ENABLED || 'true').toLowerCase() === 'true',
  SPORTS_AUTO_SYNC_ON_REQUEST: String(process.env.SPORTS_AUTO_SYNC_ON_REQUEST || 'true').toLowerCase() === 'true',
  SPORTS_ODDS_PROVIDER: process.env.SPORTS_ODDS_PROVIDER || 'theoddsapi',
  SPORTS_ODDS_API_KEY: process.env.SPORTS_ODDS_API_KEY || '',
  SPORTS_AUTO_SPORT_KEYS: process.env.SPORTS_AUTO_SPORT_KEYS || 'all',
  SPORTS_AUTO_SYNC_ACTIVE_SPORTS: String(process.env.SPORTS_AUTO_SYNC_ACTIVE_SPORTS || 'true').toLowerCase() === 'true',
  SPORTS_ACTIVE_SPORTS_TTL_SECONDS: Number(process.env.SPORTS_ACTIVE_SPORTS_TTL_SECONDS || 1800),
  SPORTS_AUTO_MAX_SPORTS_PER_SYNC: Number(process.env.SPORTS_AUTO_MAX_SPORTS_PER_SYNC || 80),
  SPORTS_DEFAULT_REGIONS: process.env.SPORTS_DEFAULT_REGIONS || 'us,uk,eu,au',
  SPORTS_DEFAULT_MARKETS: process.env.SPORTS_DEFAULT_MARKETS || 'h2h',
  SPORTS_ODDS_FORMAT: process.env.SPORTS_ODDS_FORMAT || 'decimal',
  SPORTS_PREFERRED_BOOKMAKERS: process.env.SPORTS_PREFERRED_BOOKMAKERS || 'bet365,pinnacle,williamhill,betfair,unibet',
  SPORTS_ODDS_SYNC_TTL_SECONDS: Number(process.env.SPORTS_ODDS_SYNC_TTL_SECONDS || 30),
  SPORTS_SCORE_SYNC_TTL_SECONDS: Number(process.env.SPORTS_SCORE_SYNC_TTL_SECONDS || 30),
  SPORTS_HIDE_STARTED_OLDER_HOURS: Number(process.env.SPORTS_HIDE_STARTED_OLDER_HOURS || 24),
  SPORTS_ODDS_STALE_SECONDS: Number(process.env.SPORTS_ODDS_STALE_SECONDS || 900),
  SPORTS_MIN_STAKE: Number(process.env.SPORTS_MIN_STAKE || 1),
  SPORTS_MAX_STAKE: Number(process.env.SPORTS_MAX_STAKE || 500),
  SPORTS_AUTO_SETTLEMENT_ENABLED: String(process.env.SPORTS_AUTO_SETTLEMENT_ENABLED || 'true').toLowerCase() === 'true',
  SPORTS_AUTO_SETTLEMENT_MIN_DELAY_MINUTES: Number(process.env.SPORTS_AUTO_SETTLEMENT_MIN_DELAY_MINUTES || 15),
  SPORTS_AUTO_REVIEW_ABOVE_AMOUNT: Number(process.env.SPORTS_AUTO_REVIEW_ABOVE_AMOUNT || 0),

  // Kept only for old direct_test compatibility. Do not use in production.
  TATUM_BSC_MNEMONIC: process.env.TATUM_BSC_MNEMONIC || '',
};

export const isProduction = env.NODE_ENV === 'production';
