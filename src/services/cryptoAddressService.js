import CryptoMethod from '../models/CryptoMethod.js';
import UserCryptoAddress from '../models/UserCryptoAddress.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import {
  DEFAULT_CRYPTO_METHODS,
  getDefaultCryptoMethod,
  getEnabledCryptoKeys,
  getXpubForMethod,
} from './cryptoConfig.js';
import { generateTatumDepositAddress } from './tatumService.js';

function derivationIndexForUser(user, methodKey) {
  const userKey = String(user?.userId || user?.clientNumber || user?._id || user?.id || '0');
  const digits = userKey.replace(/\D/g, '');
  const idBase = digits ? Number(digits.slice(-5)) : 0;
  const methodOffset = Array.from(String(methodKey || '')).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Math.max(0, (idBase + methodOffset) % 100000);
}

export async function syncDefaultCryptoMethods() {
  const enabledKeys = new Set(getEnabledCryptoKeys());
  const docs = [];

  for (const method of DEFAULT_CRYPTO_METHODS) {
    const enabled = enabledKeys.size ? enabledKeys.has(method.key) : true;
    // Important: update existing method docs too, not only insert.
    // Older rows may miss addressFamily/xpubEnvKey, causing every address to fail.
    const doc = await CryptoMethod.findOneAndUpdate(
      { key: method.key },
      {
        $set: {
          ...method,
          enabled,
        },
      },
      { new: true, upsert: true }
    );
    docs.push(doc);
  }

  return docs;
}

export async function getActiveCryptoMethods() {
  await syncDefaultCryptoMethods();
  return CryptoMethod.find({ enabled: true }).sort({ sortOrder: 1, displayName: 1 });
}

async function upsertAddressStatus({ user, method, status, address = '', errorMessage = '' }) {
  const derivationIndex = derivationIndexForUser(user, method.key);

  return UserCryptoAddress.findOneAndUpdate(
    { user: user._id, methodKey: method.key },
    {
      $set: {
        user: user._id,
        userId: user.userId || '',
        method: method._id,
        methodKey: method.key,
        coin: method.coin,
        network: method.network,
        address,
        provider: env.CRYPTO_PROVIDER || 'tatum',
        derivationIndex,
        xpubEnvKey: method.xpubEnvKey || '',
        status,
        errorMessage,
        lastGeneratedAt: new Date(),
      },
    },
    { new: true, upsert: true }
  );
}

export async function ensureUserCryptoAddress(user, method) {
  const existing = await UserCryptoAddress.findOne({ user: user._id, methodKey: method.key });
  if (existing?.status === 'active' && existing.address) return existing;

  if (!env.CRYPTO_AUTO_CREATE_ADDRESSES) {
    return upsertAddressStatus({ user, method, status: 'pending', errorMessage: 'Automatic crypto address creation is disabled.' });
  }

  const xpub = getXpubForMethod(method);
  if (!xpub) {
    return upsertAddressStatus({
      user,
      method,
      status: 'pending',
      errorMessage: `${method.xpubEnvKey || 'XPUB'} is not configured in backend environment.`,
    });
  }

  try {
    const derivationIndex = derivationIndexForUser(user, method.key);
    const result = await generateTatumDepositAddress({ method, xpub, index: derivationIndex });
    return UserCryptoAddress.findOneAndUpdate(
      { user: user._id, methodKey: method.key },
      {
        $set: {
          user: user._id,
          userId: user.userId || '',
          method: method._id,
          methodKey: method.key,
          coin: method.coin,
          network: method.network,
          address: result.address,
          provider: env.CRYPTO_PROVIDER || 'tatum',
          derivationIndex,
          xpubEnvKey: method.xpubEnvKey || '',
          status: 'active',
          errorMessage: '',
          lastGeneratedAt: new Date(),
        },
      },
      { new: true, upsert: true }
    );
  } catch (error) {
    return upsertAddressStatus({
      user,
      method,
      status: 'failed',
      errorMessage: error.message || 'Unable to generate crypto address.',
    });
  }
}

export async function ensureUserCryptoAddresses(userInput) {
  const user = userInput?._id ? userInput : await User.findById(userInput);
  if (!user) return [];

  const methods = await getActiveCryptoMethods();
  const addresses = [];

  for (const method of methods) {
    const address = await ensureUserCryptoAddress(user, method);
    addresses.push({ method, address });
  }

  return addresses;
}

export function triggerCryptoAddressCreationForUser(user) {
  if (!user?._id) return;
  setTimeout(() => {
    ensureUserCryptoAddresses(user).catch((error) => {
      console.error('Crypto address background creation failed:', error.message);
    });
  }, 0);
}

export function toCryptoAddressDto(item) {
  const method = item.method || getDefaultCryptoMethod(item.methodKey) || {};
  const address = item.address || {};

  return {
    id: address._id || `${method.key}-${item.userId || ''}`,
    key: method.key || address.methodKey,
    methodKey: method.key || address.methodKey,
    coin: method.coin || address.coin,
    symbol: method.symbol || method.coin || address.coin,
    network: method.network || address.network,
    displayName: method.displayName || address.methodKey,
    minDepositCrypto: method.minDepositCrypto || 0,
    minDepositFiat: method.minDepositFiat || 0,
    confirmations: method.confirmations || 1,
    warning: method.warning || '',
    address: address.address || '',
    memo: address.memo || '',
    status: address.status || 'pending',
    errorMessage: address.errorMessage || '',
    derivationIndex: address.derivationIndex,
  };
}
