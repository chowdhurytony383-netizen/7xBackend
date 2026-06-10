import crypto from 'crypto';
import NotificationToken from '../models/NotificationToken.js';
import FreeSpinAccount from '../models/FreeSpinAccount.js';
import { env } from '../config/env.js';

const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send';
const FREE_SPIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

function pemFromEnv(value = '') {
  return String(value || '').replace(/\\n/g, '\n');
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function makeJwt({ clientEmail, privateKey, scope }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(pemFromEnv(privateKey));
  return `${unsigned}.${base64Url(signature)}`;
}

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;

async function getFirebaseAccessToken() {
  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 60_000) {
    return cachedAccessToken;
  }

  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    return '';
  }

  const assertion = makeJwt({
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Firebase access token failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  cachedAccessToken = payload.access_token || '';
  cachedAccessTokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

export async function sendLuckyWheelReadyNotificationToToken(tokenDoc) {
  if (!env.FIREBASE_PROJECT_ID) return { skipped: true, reason: 'Firebase is not configured.' };

  const accessToken = await getFirebaseAccessToken();
  if (!accessToken) return { skipped: true, reason: 'Firebase access token unavailable.' };

  const url = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;

  const message = {
    message: {
      token: tokenDoc.token,
      notification: {
        title: 'Lucky Wheel Ready',
        body: 'Your free spin is ready. Claim now!',
      },
      data: {
        type: 'LUCKY_WHEEL_READY',
        url: '/free-spin',
      },
      webpush: {
        fcm_options: {
          link: `${String(env.FRONTEND_URL || 'https://7xbet.asia').replace(/\/$/, '')}/free-spin`,
        },
        notification: {
          title: 'Lucky Wheel Ready',
          body: 'Your free spin is ready. Claim now!',
          icon: '/icons/notification-icon.png',
          badge: '/icons/notification-badge.png',
          tag: 'lucky-wheel-ready',
          renotify: false,
          requireInteraction: false,
        },
      },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (response.status === 404 || response.status === 400) {
    const text = await response.text().catch(() => '');
    if (/UNREGISTERED|registration-token-not-registered|not found/i.test(text)) {
      tokenDoc.isActive = false;
      await tokenDoc.save();
      return { success: false, inactive: true, error: text };
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { success: false, error: text || `HTTP ${response.status}` };
  }

  tokenDoc.lastLuckyWheelReadySentAt = new Date();
  tokenDoc.lastSeenAt = new Date();
  await tokenDoc.save();

  return { success: true };
}

export async function sendLuckyWheelReadyNotificationToUser(userId) {
  const tokens = await NotificationToken.find({ user: userId, isActive: true });
  const results = [];

  for (const token of tokens) {
    results.push(await sendLuckyWheelReadyNotificationToToken(token));
  }

  return results;
}

export async function sendDueLuckyWheelReadyNotifications({ limit = 200 } = {}) {
  const now = new Date();

  const readyAccounts = await FreeSpinAccount.find({
    spinsAvailable: { $gt: 0 },
    $or: [
      { lastAutoGrantAt: { $exists: false } },
      { lastAutoGrantAt: { $lte: now } },
      { nextFreeSpinAt: { $lte: now } },
    ],
  })
    .select('user spinsAvailable nextFreeSpinAt lastAutoGrantAt')
    .limit(limit)
    .lean();

  const userIds = readyAccounts.map((account) => account.user).filter(Boolean);
  if (!userIds.length) return { scannedAccounts: 0, sent: 0 };

  const minSentAt = new Date(Date.now() - FREE_SPIN_INTERVAL_MS + 60_000);
  const tokens = await NotificationToken.find({
    user: { $in: userIds },
    isActive: true,
    $or: [
      { lastLuckyWheelReadySentAt: null },
      { lastLuckyWheelReadySentAt: { $exists: false } },
      { lastLuckyWheelReadySentAt: { $lte: minSentAt } },
    ],
  }).limit(limit * 5);

  let sent = 0;
  let failed = 0;

  for (const token of tokens) {
    const result = await sendLuckyWheelReadyNotificationToToken(token);
    if (result?.success) sent += 1;
    else if (!result?.skipped) failed += 1;
  }

  return { scannedAccounts: readyAccounts.length, tokens: tokens.length, sent, failed };
}

export function startLuckyWheelNotificationWorker() {
  if (!env.LUCKY_WHEEL_NOTIFICATION_WORKER_ENABLED) return;
  if (!env.FIREBASE_PROJECT_ID) {
    console.warn('Lucky Wheel notification worker skipped: FIREBASE_PROJECT_ID is missing.');
    return;
  }

  const intervalMs = Math.max(60_000, Number(env.LUCKY_WHEEL_NOTIFICATION_CHECK_INTERVAL_MS || 5 * 60 * 1000));

  setInterval(() => {
    sendDueLuckyWheelReadyNotifications().catch((error) => {
      console.error('Lucky Wheel notification worker failed:', error.message);
    });
  }, intervalMs).unref?.();

  setTimeout(() => {
    sendDueLuckyWheelReadyNotifications().catch((error) => {
      console.error('Lucky Wheel notification initial run failed:', error.message);
    });
  }, 20_000).unref?.();

  console.log(`Lucky Wheel notification worker enabled. Interval: ${intervalMs}ms`);
}
