import CryptoMethod from '../models/CryptoMethod.js';
import CryptoWithdrawal from '../models/CryptoWithdrawal.js';
import Transaction from '../models/Transaction.js';
import { env } from '../config/env.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { debitWallet, creditWallet } from '../utils/wallet.js';
import { getCryptoFiatRate } from './cryptoPriceService.js';
import { syncDefaultCryptoMethods } from './cryptoAddressService.js';
import { getDefaultCryptoMethod } from './cryptoConfig.js';
import { tatumRequest } from './tatumService.js';

function nowDate() {
  return new Date();
}

function normalizeKey(value) {
  return String(value || '').trim().toUpperCase();
}

function allowedWithdrawKeys() {
  return String(env.CRYPTO_WITHDRAW_ALLOWED_METHODS || '')
    .split(',')
    .map((item) => normalizeKey(item))
    .filter(Boolean);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundDown(value, decimals = 8) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.floor(number * factor) / factor;
}

function amountString(value, decimals = 8) {
  return roundDown(value, decimals).toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

function tokenDecimals(methodKey) {
  if (methodKey.includes('USDT')) return 6;
  if (methodKey === 'BNB' || methodKey === 'ETH') return 8;
  return 8;
}

function extractTxHash(payload) {
  return String(
    payload?.txId
    || payload?.txHash
    || payload?.hash
    || payload?.transactionHash
    || payload?.data?.txId
    || payload?.data?.txHash
    || payload?.result?.txId
    || payload?.result?.txHash
    || ''
  ).trim();
}

function extractKmsId(payload) {
  return String(
    payload?.id
    || payload?.kmsId
    || payload?.signatureId
    || payload?.data?.id
    || payload?.result?.id
    || ''
  ).trim();
}

function buildMethodWarning(method) {
  return method.withdrawWarning
    || method.warning
    || `Only withdraw ${method.coin} on ${method.network}. Wrong network/address may cause permanent loss.`;
}

function validateCryptoAddress(method, address) {
  const value = String(address || '').trim();
  assertOrThrow(value.length >= 20 && value.length <= 160, 'Enter a valid crypto wallet address', 400);

  const family = String(method.addressFamily || '').toLowerCase();
  if (['ethereum', 'bsc'].includes(family) && !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new AppError(`Invalid ${method.network} wallet address`, 400);
  }
  if (family === 'tron' && !/^T[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(value)) {
    throw new AppError('Invalid TRON wallet address', 400);
  }
  if (family === 'bitcoin' && !/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(value)) {
    throw new AppError('Invalid Bitcoin wallet address', 400);
  }
  if (family === 'litecoin' && !/^(ltc1|[LM3])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(value)) {
    throw new AppError('Invalid Litecoin wallet address', 400);
  }

  return value;
}

export async function getCryptoWithdrawOptions() {
  await syncDefaultCryptoMethods();
  const keys = new Set(allowedWithdrawKeys());
  const methods = await CryptoMethod.find({ enabled: true }).sort({ sortOrder: 1, displayName: 1 });
  return methods
    .filter((method) => keys.has(normalizeKey(method.key)))
    .filter((method) => method.withdrawEnabled !== false)
    .map((method) => ({
      key: method.key,
      methodKey: method.key,
      type: 'crypto-withdraw',
      category: 'crypto',
      methodTitle: method.displayName,
      displayName: method.displayName,
      coin: method.coin,
      symbol: method.symbol || method.coin,
      network: method.network,
      logo: method.logo || '',
      image: method.logo || '',
      minAmount: safeNumber(method.minWithdrawFiat, env.CRYPTO_WITHDRAW_MIN_FIAT || 100),
      maxAmount: safeNumber(method.maxWithdrawFiat, env.CRYPTO_WITHDRAW_MAX_FIAT || 25000),
      warning: buildMethodWarning(method),
      enabled: Boolean(env.CRYPTO_WITHDRAW_ENABLED),
      dryRun: Boolean(env.CRYPTO_WITHDRAW_DRY_RUN),
    }));
}

function signingPayloadForBsc(methodKey) {
  const payload = {
    gasLimit: String(env.CRYPTO_WITHDRAW_BSC_GAS_LIMIT || '30000'),
  };
  if (env.CRYPTO_WITHDRAW_BSC_GAS_PRICE) payload.gasPrice = String(env.CRYPTO_WITHDRAW_BSC_GAS_PRICE);
  if (env.CRYPTO_WITHDRAW_BSC_SIGNATURE_ID) {
    payload.signatureId = env.CRYPTO_WITHDRAW_BSC_SIGNATURE_ID;
    payload.index = Number(env.CRYPTO_WITHDRAW_BSC_INDEX || 0);
  } else if (env.CRYPTO_WITHDRAW_BSC_PRIVATE_KEY) {
    payload.fromPrivateKey = env.CRYPTO_WITHDRAW_BSC_PRIVATE_KEY;
  } else {
    throw new AppError(`${methodKey} withdraw signing is not configured. Set CRYPTO_WITHDRAW_BSC_SIGNATURE_ID or CRYPTO_WITHDRAW_BSC_PRIVATE_KEY.`, 503);
  }
  return payload;
}

function signingPayloadForEth(methodKey) {
  const payload = {};
  if (env.CRYPTO_WITHDRAW_ETH_SIGNATURE_ID) {
    payload.signatureId = env.CRYPTO_WITHDRAW_ETH_SIGNATURE_ID;
    payload.index = Number(env.CRYPTO_WITHDRAW_ETH_INDEX || 0);
  } else if (env.CRYPTO_WITHDRAW_ETH_PRIVATE_KEY) {
    payload.privateKey = env.CRYPTO_WITHDRAW_ETH_PRIVATE_KEY;
    payload.fromPrivateKey = env.CRYPTO_WITHDRAW_ETH_PRIVATE_KEY;
  } else {
    throw new AppError(`${methodKey} withdraw signing is not configured. Set CRYPTO_WITHDRAW_ETH_SIGNATURE_ID or CRYPTO_WITHDRAW_ETH_PRIVATE_KEY.`, 503);
  }
  return payload;
}

function signingPayloadForTron(methodKey) {
  const payload = { feeLimit: Number(env.CRYPTO_WITHDRAW_TRON_FEE_LIMIT || 100) };
  if (env.CRYPTO_WITHDRAW_TRON_SIGNATURE_ID) {
    payload.signatureId = env.CRYPTO_WITHDRAW_TRON_SIGNATURE_ID;
    payload.index = Number(env.CRYPTO_WITHDRAW_TRON_INDEX || 0);
  } else if (env.CRYPTO_WITHDRAW_TRON_PRIVATE_KEY) {
    payload.fromPrivateKey = env.CRYPTO_WITHDRAW_TRON_PRIVATE_KEY;
    payload.privateKey = env.CRYPTO_WITHDRAW_TRON_PRIVATE_KEY;
  } else {
    throw new AppError(`${methodKey} withdraw signing is not configured. Set CRYPTO_WITHDRAW_TRON_SIGNATURE_ID or CRYPTO_WITHDRAW_TRON_PRIVATE_KEY.`, 503);
  }
  return payload;
}

function buildTatumTransferRequest(withdrawal, method) {
  const methodKey = normalizeKey(withdrawal.methodKey);
  const amount = amountString(withdrawal.amountCrypto, tokenDecimals(methodKey));
  const tokenContract = method.tokenContract || getDefaultCryptoMethod(methodKey)?.tokenContract || '';

  if (methodKey === 'BNB') {
    return {
      path: 'bsc/transaction',
      body: {
        to: withdrawal.toAddress,
        currency: 'BSC',
        amount,
        ...signingPayloadForBsc(methodKey),
      },
    };
  }

  if (methodKey === 'USDT_BEP20') {
    if (!tokenContract) throw new AppError('USDT BEP20 contract address is missing', 503);
    return {
      // Tatum supports BEP20 on BSC through compatible token transfer APIs.
      path: 'bsc/transaction',
      body: {
        to: withdrawal.toAddress,
        currency: 'BSC_USDT',
        amount,
        tokenAddress: tokenContract,
        contractAddress: tokenContract,
        ...signingPayloadForBsc(methodKey),
      },
    };
  }

  if (methodKey === 'ETH') {
    return {
      path: 'ethereum/transaction',
      body: {
        to: withdrawal.toAddress,
        currency: 'ETH',
        amount,
        ...signingPayloadForEth(methodKey),
      },
    };
  }

  if (methodKey === 'USDT_ERC20') {
    if (!tokenContract) throw new AppError('USDT ERC20 contract address is missing', 503);
    return {
      path: 'ethereum/erc20/transaction',
      body: {
        to: withdrawal.toAddress,
        amount,
        digits: 6,
        contractAddress: tokenContract,
        ...signingPayloadForEth(methodKey),
      },
    };
  }

  if (methodKey === 'USDT_TRC20') {
    if (!tokenContract) throw new AppError('USDT TRC20 contract address is missing', 503);
    return {
      path: 'tron/trc20/transaction',
      body: {
        to: withdrawal.toAddress,
        amount,
        tokenAddress: tokenContract,
        contractAddress: tokenContract,
        ...signingPayloadForTron(methodKey),
      },
    };
  }

  throw new AppError(`${methodKey} automatic crypto withdraw is not supported in this package yet`, 400);
}

async function broadcastCryptoWithdrawal(withdrawal, method) {
  const request = buildTatumTransferRequest(withdrawal, method);

  if (env.CRYPTO_WITHDRAW_DRY_RUN) {
    withdrawal.status = 'dry_run';
    withdrawal.providerRequest = request;
    withdrawal.providerResponse = { dryRun: true, message: 'CRYPTO_WITHDRAW_DRY_RUN=true. No blockchain transaction was sent.' };
    withdrawal.completedAt = nowDate();
    await withdrawal.save();
    return withdrawal;
  }

  withdrawal.status = 'processing';
  withdrawal.providerRequest = request;
  withdrawal.broadcastRequestedAt = nowDate();
  await withdrawal.save();

  const payload = await tatumRequest(request.path, { method: 'POST', body: request.body });
  const txHash = extractTxHash(payload);
  const kmsId = extractKmsId(payload);

  withdrawal.txHash = txHash;
  withdrawal.kmsId = kmsId;
  withdrawal.providerResponse = payload;
  withdrawal.status = txHash ? 'success' : 'broadcasted';
  withdrawal.completedAt = txHash ? nowDate() : undefined;
  await withdrawal.save();

  return withdrawal;
}

export async function createCryptoWithdrawalRequest({ user, amountFiat, methodKey, toAddress, memo = '' }) {
  assertOrThrow(env.CRYPTO_WITHDRAW_ENABLED, 'Crypto withdraw is temporarily disabled', 503);

  const key = normalizeKey(methodKey);
  assertOrThrow(allowedWithdrawKeys().includes(key), 'This crypto withdraw method is not enabled', 400);

  await syncDefaultCryptoMethods();
  const method = await CryptoMethod.findOne({ key, enabled: true, withdrawEnabled: { $ne: false } });
  assertOrThrow(method, 'Crypto withdraw method is not active', 404);

  const amount = safeNumber(amountFiat, 0);
  const minAmount = safeNumber(method.minWithdrawFiat, env.CRYPTO_WITHDRAW_MIN_FIAT || 100);
  const maxAmount = safeNumber(method.maxWithdrawFiat, env.CRYPTO_WITHDRAW_MAX_FIAT || 25000);

  assertOrThrow(amount >= minAmount, `Minimum withdraw amount is ${minAmount}`, 400);
  assertOrThrow(amount <= maxAmount, `Maximum withdraw amount is ${maxAmount}`, 400);
  assertOrThrow((user.wallet || 0) >= amount, 'Insufficient wallet balance', 400);

  const cleanAddress = validateCryptoAddress(method, toAddress);
  const fiatCurrency = String(env.CRYPTO_WITHDRAW_FIAT || env.CRYPTO_DEFAULT_FIAT || 'BDT').toUpperCase();
  const symbol = method.symbol || method.coin;
  const rateInfo = await getCryptoFiatRate(symbol, fiatCurrency);
  const amountCrypto = roundDown(amount / rateInfo.rate, tokenDecimals(key));
  assertOrThrow(amountCrypto > 0, 'Calculated crypto amount is too small', 400);

  let transaction;
  let withdrawal;
  let walletDebited = false;

  try {
    await debitWallet(user._id, amount, 'crypto-withdraw-hold');
    walletDebited = true;

    transaction = await Transaction.create({
      user: user._id,
      type: 'WITHDRAW',
      amount,
      status: 'PROCESSING',
      method: `crypto-${key}`,
      methodKey: key,
      accountNumber: cleanAddress,
      accountHolderName: `${method.displayName} wallet`,
      userNote: `Crypto withdraw: ${method.displayName}\nNetwork: ${method.network}\nAddress: ${cleanAddress}${memo ? `\nMemo: ${memo}` : ''}`,
      gatewayPayload: {
        source: 'crypto-auto-withdraw',
        walletHeld: true,
        walletHeldAt: nowDate(),
        method: { key, title: method.displayName, network: method.network, coin: method.coin },
        payout: { address: cleanAddress, memo, amountCrypto, symbol, fiatCurrency, priceRate: rateInfo.rate },
      },
    });

    withdrawal = await CryptoWithdrawal.create({
      user: user._id,
      userId: user.userId || user.username || user._id.toString(),
      transaction: transaction._id,
      methodKey: key,
      coin: method.coin,
      symbol,
      network: method.network,
      toAddress: cleanAddress,
      memo,
      amountFiat: amount,
      fiatCurrency,
      amountCrypto,
      priceRate: rateInfo.rate,
      priceSource: rateInfo.source,
      priceAt: new Date(rateInfo.time || Date.now()),
      status: 'pending',
      walletDebited: true,
      walletDebitedAt: nowDate(),
    });

    const broadcasted = await broadcastCryptoWithdrawal(withdrawal, method);

    if (broadcasted.status === 'success') {
      transaction.status = 'SUCCESS';
      transaction.razorpayPayoutId = broadcasted.txHash;
      transaction.processedAt = nowDate();
    } else if (broadcasted.status === 'dry_run') {
      transaction.status = 'PROCESSING';
      transaction.adminNote = 'Crypto withdraw dry run: wallet debited, no blockchain transaction sent. Set CRYPTO_WITHDRAW_DRY_RUN=false after live testing.';
    } else {
      transaction.status = 'PROCESSING';
      transaction.adminNote = 'Crypto withdraw broadcast request created. Waiting for provider/KMS transaction hash.';
    }

    transaction.gatewayPayload = {
      ...(transaction.gatewayPayload || {}),
      cryptoWithdrawal: broadcasted._id,
      txHash: broadcasted.txHash,
      kmsId: broadcasted.kmsId,
      providerResponse: broadcasted.providerResponse,
    };
    await transaction.save();

    return { transaction, withdrawal: broadcasted };
  } catch (error) {
    if (withdrawal) {
      withdrawal.status = 'failed';
      withdrawal.errorMessage = error.message || 'Crypto withdraw failed';
      await withdrawal.save().catch(() => null);
    }

    if (transaction) {
      transaction.status = 'FAILED';
      transaction.adminNote = error.message || 'Crypto withdraw failed';
      await transaction.save().catch(() => null);
    }

    if (walletDebited) {
      await creditWallet(user._id, amount, 'crypto-withdraw-rollback').catch(() => null);
    }

    throw error;
  }
}
