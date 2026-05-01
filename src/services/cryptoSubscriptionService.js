import { env } from '../config/env.js';
import CryptoMethod from '../models/CryptoMethod.js';
import UserCryptoAddress from '../models/UserCryptoAddress.js';
import { createTatumAddressSubscription } from './tatumService.js';
import { syncDefaultCryptoMethods } from './cryptoAddressService.js';

function resolveWebhookUrl() {
  const explicit = String(env.CRYPTO_WEBHOOK_URL || '').trim();
  if (explicit) return explicit;

  const base = String(env.OAUTH_CALLBACK_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base) return '';

  const secret = String(env.CRYPTO_WEBHOOK_SECRET || '').trim();
  const query = secret ? `?secret=${encodeURIComponent(secret)}` : '';
  return `${base}/api/crypto/webhook/tatum${query}`;
}

function extractSubscriptionId(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return payload.id || payload.subscriptionId || payload.data?.id || payload.result?.id || '';
}

export async function syncTatumSubscriptions({ force = false, limit = 1000 } = {}) {
  await syncDefaultCryptoMethods();
  const webhookUrl = resolveWebhookUrl();
  if (!webhookUrl) throw new Error('CRYPTO_WEBHOOK_URL or OAUTH_CALLBACK_BASE_URL is required for Tatum subscriptions');

  const addresses = await UserCryptoAddress.find({ status: 'active', address: { $ne: '' } })
    .sort({ createdAt: 1 })
    .limit(limit);

  const results = [];

  for (const address of addresses) {
    if (!force && address.subscriptionStatus === 'active' && address.subscriptionId) {
      results.push({ methodKey: address.methodKey, address: address.address, status: 'skipped', subscriptionId: address.subscriptionId });
      continue;
    }

    const method = await CryptoMethod.findOne({ key: address.methodKey });
    const chain = method?.notificationChain;

    if (!chain) {
      address.subscriptionStatus = 'failed';
      address.subscriptionError = 'Crypto method notificationChain is not configured';
      address.lastSubscriptionAttemptAt = new Date();
      await address.save();
      results.push({ methodKey: address.methodKey, address: address.address, status: 'failed', error: address.subscriptionError });
      continue;
    }

    try {
      const payload = await createTatumAddressSubscription({ chain, address: address.address, url: webhookUrl });
      const subscriptionId = extractSubscriptionId(payload);

      address.subscriptionId = subscriptionId;
      address.subscriptionStatus = 'active';
      address.subscriptionError = '';
      address.subscribedAt = new Date();
      address.lastSubscriptionAttemptAt = new Date();
      await address.save();

      results.push({ methodKey: address.methodKey, address: address.address, status: 'active', subscriptionId, chain });
    } catch (error) {
      address.subscriptionStatus = 'failed';
      address.subscriptionError = error.message || 'Tatum subscription creation failed';
      address.lastSubscriptionAttemptAt = new Date();
      await address.save();
      results.push({ methodKey: address.methodKey, address: address.address, status: 'failed', chain, error: address.subscriptionError });
    }
  }

  return { webhookUrl, total: addresses.length, results };
}
