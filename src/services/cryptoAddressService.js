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

function normalizeIndex(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number <= 1000000) return number;
  return null;
}

async function getExistingAddress(user, method) {
  return UserCryptoAddress.findOne({ user: user._id, methodKey: method.key });
}

async function allocateDerivationIndex({ user, method, existing }) {
  const savedIndex = normalizeIndex(existing?.derivationIndex);
  if (savedIndex !== null) return savedIndex;

  // Tatum accepted the user's ETH XPUB at index 1, while large/hash indexes were failing.
  // Use a simple sequential index per XPUB/network group: 1,2,3,4...
  // This keeps indexes small and stable for production users.
  const xpubGroup = method.xpubEnvKey || method.key;
  const usedCount = await UserCryptoAddress.countDocuments({
    xpubEnvKey: xpubGroup,
    derivationIndex: { $type: 'number' },
  });

  return usedCount + 1;
}

export async function syncDefaultCryptoMethods() {
  const enabledKeys = new Set(getEnabledCryptoKeys());
  const docs = [];

  for (const method of DEFAULT_CRYPTO_METHODS) {
    const enabled = enabledKeys.size ? enabledKeys.has(method.key) : true;
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

async function upsertAddressStatus({ user, method, status, address = '', errorMessage = '', derivationIndex = null }) {
  const finalIndex = derivationIndex ?? (await allocateDerivationIndex({ user, method, existing: await getExistingAddress(user, method) }));

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
        derivationIndex: finalIndex,
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
  const existing = await getExistingAddress(user, method);
  if (existing?.status === 'active' && existing.address) return existing;

  if (!env.CRYPTO_AUTO_CREATE_ADDRESSES) {
    return upsertAddressStatus({
      user,
      method,
      status: 'pending',
      errorMessage: 'Automatic crypto address creation is disabled.',
    });
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

  const derivationIndex = await allocateDerivationIndex({ user, method, existing });

  try {
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
      derivationIndex,
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
