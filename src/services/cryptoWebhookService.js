import CryptoDeposit from '../models/CryptoDeposit.js';
import CryptoMethod from '../models/CryptoMethod.js';
import Transaction from '../models/Transaction.js';
import UserCryptoAddress from '../models/UserCryptoAddress.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { creditWallet } from '../utils/wallet.js';
import { convertCryptoToFiat } from './cryptoPriceService.js';

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeAddress(value) {
  return String(value || '').trim();
}

function normalizeTxHash(value) {
  return String(value || '').trim();
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function amountFromEvent(event) {
  const direct = toNumber(event.amount ?? event.amountCrypto ?? event.tokenAmount ?? event.valueReadable ?? event.valueConverted);
  if (direct > 0) return direct;

  const rawValue = event.value ?? event.amountRaw ?? event.tokenValue;
  const decimals = Number(event.decimals ?? event.tokenDecimals);
  const rawNumber = Number(rawValue);
  if (Number.isFinite(rawNumber) && rawNumber > 0 && Number.isFinite(decimals) && decimals > 0 && decimals <= 30) {
    return rawNumber / (10 ** decimals);
  }

  return 0;
}

function confirmationsFromEvent(event) {
  return toNumber(event.confirmations ?? event.blockConfirmations ?? event.confirmation ?? event.confirmedBlocks);
}

function blockNumberFromEvent(event) {
  return String(event.blockNumber ?? event.blockHeight ?? event.block ?? event.blockHash ?? '').trim();
}

function txHashFromEvent(event) {
  return normalizeTxHash(
    event.txHash || event.hash || event.txId || event.txID || event.transactionHash || event.transactionId || event.id
  );
}

function incomingAddressFromEvent(event) {
  return normalizeAddress(
    event.to || event.toAddress || event.recipient || event.destination || event.address || event.walletAddress || event.accountingCurrencyAddress
  );
}

function eventIndexFromEvent(event, index) {
  return String(event.logIndex ?? event.eventIndex ?? event.index ?? event.vout ?? event.outputIndex ?? index ?? '');
}

function eventSymbol(event) {
  return String(event.symbol || event.asset || event.currency || event.tokenSymbol || event.token || '').trim().toUpperCase();
}

function eventContract(event) {
  return lower(event.contractAddress || event.tokenAddress || event.smartContractAddress || event.assetAddress || '');
}

export function normalizeTatumWebhookEvents(payload) {
  const root = payload || {};
  const possible = root.events || root.data?.events || root.result?.events;
  const array = Array.isArray(possible)
    ? possible
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root)
        ? root
        : [root.event || root.data || root.result || root];

  return array.map((event, index) => ({
    raw: event,
    address: incomingAddressFromEvent(event),
    txHash: txHashFromEvent(event),
    amountCrypto: amountFromEvent(event),
    confirmations: confirmationsFromEvent(event),
    blockNumber: blockNumberFromEvent(event),
    eventIndex: eventIndexFromEvent(event, index),
    symbol: eventSymbol(event),
    contractAddress: eventContract(event),
    chain: event.chain || root.chain || root.network || '',
  })).filter((event) => event.address && event.txHash);
}

async function findUserAddress(address) {
  const clean = normalizeAddress(address);
  const cleanLower = lower(clean);
  return UserCryptoAddress.findOne({
    status: 'active',
    $or: [
      { address: clean },
      { addressLower: cleanLower },
    ],
  }).populate('user');
}

function isExpectedAsset({ event, method, userAddress }) {
  const symbol = event.symbol;
  const contract = event.contractAddress;
  const methodContract = lower(method?.tokenContract || '');
  const methodCoin = String(method?.coin || userAddress.coin || '').toUpperCase();

  // If Tatum provides token contract, enforce the contract for token deposit methods.
  if (methodContract && contract) return contract === methodContract;

  // If Tatum provides a symbol, enforce it.
  if (symbol) {
    if (methodCoin === 'USDT') return symbol === 'USDT';
    return symbol === methodCoin;
  }

  // Without symbol/contract, accept native-chain webhooks for native methods only.
  return methodCoin !== 'USDT';
}

function isConfirmedEnough({ event, method }) {
  const required = Number(method?.confirmations || 1);
  if (event.confirmations >= required) return true;
  if (env.CRYPTO_CREDIT_ON_BLOCK && event.blockNumber) return true;
  return required <= 0;
}

async function markIgnored({ event, userAddress, method, reason, payload }) {
  return CryptoDeposit.findOneAndUpdate(
    {
      txHash: event.txHash,
      methodKey: userAddress.methodKey,
      addressLower: lower(userAddress.address),
      eventIndex: event.eventIndex,
    },
    {
      $setOnInsert: {
        user: userAddress.user._id,
        userId: userAddress.userId,
        methodKey: userAddress.methodKey,
        coin: userAddress.coin,
        network: userAddress.network,
        address: userAddress.address,
        addressLower: lower(userAddress.address),
        txHash: event.txHash,
        eventIndex: event.eventIndex,
        amountCrypto: event.amountCrypto,
        confirmations: event.confirmations,
        requiredConfirmations: method?.confirmations || 1,
        rawPayload: payload,
      },
      $set: { status: 'ignored', ignoredReason: reason },
    },
    { new: true, upsert: true }
  );
}

export async function processCryptoWebhookPayload(payload) {
  const events = normalizeTatumWebhookEvents(payload);
  if (!events.length) return { processed: 0, credited: 0, ignored: 0, message: 'No usable events found' };

  let processed = 0;
  let credited = 0;
  let ignored = 0;
  const results = [];

  for (const event of events) {
    processed += 1;
    const userAddress = await findUserAddress(event.address);
    if (!userAddress?.user) {
      ignored += 1;
      results.push({ txHash: event.txHash, address: event.address, status: 'ignored', reason: 'Address not found' });
      continue;
    }

    const method = await CryptoMethod.findOne({ key: userAddress.methodKey });
    if (!method) {
      ignored += 1;
      results.push({ txHash: event.txHash, status: 'ignored', reason: 'Crypto method not found' });
      continue;
    }

    if (!isExpectedAsset({ event, method, userAddress })) {
      ignored += 1;
      await markIgnored({ event, userAddress, method, reason: 'Unexpected asset or token contract for this address', payload });
      results.push({ txHash: event.txHash, status: 'ignored', reason: 'Unexpected asset' });
      continue;
    }

    if (!event.amountCrypto || event.amountCrypto <= 0) {
      ignored += 1;
      await markIgnored({ event, userAddress, method, reason: 'Webhook amount missing or zero', payload });
      results.push({ txHash: event.txHash, status: 'ignored', reason: 'Missing amount' });
      continue;
    }

    const confirmed = isConfirmedEnough({ event, method });
    const user = await User.findById(userAddress.user._id);
    if (!user) throw new AppError('Crypto deposit user not found', 404);

    let conversion = null;
    const fiatCurrency = String(user.currency || env.CRYPTO_DEFAULT_FIAT || 'BDT').toUpperCase();

    let deposit = await CryptoDeposit.findOneAndUpdate(
      {
        txHash: event.txHash,
        methodKey: userAddress.methodKey,
        addressLower: lower(userAddress.address),
        eventIndex: event.eventIndex,
      },
      {
        $setOnInsert: {
          user: user._id,
          userId: userAddress.userId,
          methodKey: userAddress.methodKey,
          coin: userAddress.coin,
          network: userAddress.network,
          address: userAddress.address,
          addressLower: lower(userAddress.address),
          txHash: event.txHash,
          eventIndex: event.eventIndex,
        },
        $set: {
          amountCrypto: event.amountCrypto,
          fiatCurrency,
          confirmations: event.confirmations,
          requiredConfirmations: method.confirmations || 1,
          blockNumber: event.blockNumber,
          rawPayload: payload,
          ...(confirmed ? { status: 'confirming' } : { status: 'detected' }),
        },
      },
      { new: true, upsert: true }
    );

    if (!confirmed) {
      results.push({ txHash: event.txHash, status: deposit.status, message: 'Waiting for confirmations' });
      continue;
    }

    // Lock the deposit for one-time crediting. If another webhook already credited it, do nothing.
    deposit = await CryptoDeposit.findOneAndUpdate(
      { _id: deposit._id, status: { $ne: 'credited' } },
      { $set: { status: 'crediting', creditError: '' } },
      { new: true }
    );

    if (!deposit || deposit.status === 'credited') {
      results.push({ txHash: event.txHash, status: 'already_credited' });
      continue;
    }

    try {
      conversion = await convertCryptoToFiat({
        symbol: userAddress.coin,
        amountCrypto: event.amountCrypto,
        fiatCurrency,
      });

      const updatedUser = await creditWallet(user._id, conversion.amountFiat, `crypto:${userAddress.methodKey}:${event.txHash}`);

      const tx = await Transaction.create({
        user: user._id,
        type: 'DEPOSIT',
        amount: conversion.amountFiat,
        status: 'SUCCESS',
        method: `CRYPTO_${userAddress.methodKey}`,
        methodKey: userAddress.methodKey,
        gatewayPayload: {
          provider: 'tatum',
          txHash: event.txHash,
          coin: userAddress.coin,
          network: userAddress.network,
          address: userAddress.address,
          amountCrypto: event.amountCrypto,
          fiatCurrency,
          priceRate: conversion.rate,
          raw: payload,
        },
        processedAt: new Date(),
        userNote: `Crypto deposit ${event.amountCrypto} ${userAddress.coin} credited as ${conversion.amountFiat} ${fiatCurrency}`,
      });

      deposit.status = 'credited';
      deposit.amountFiat = conversion.amountFiat;
      deposit.priceRate = conversion.rate;
      deposit.priceSource = conversion.source;
      deposit.priceAt = new Date(conversion.time);
      deposit.creditedAt = new Date();
      deposit.creditedTransaction = tx._id;
      deposit.creditError = '';
      await deposit.save();

      credited += 1;
      results.push({
        txHash: event.txHash,
        status: 'credited',
        userId: user.userId,
        wallet: updatedUser.wallet,
        amountCrypto: event.amountCrypto,
        amountFiat: conversion.amountFiat,
        fiatCurrency,
      });
    } catch (error) {
      deposit.status = 'confirming';
      deposit.creditError = error.message || 'Crypto credit failed';
      await deposit.save();
      results.push({ txHash: event.txHash, status: 'confirming', error: deposit.creditError });
    }
  }

  return { processed, credited, ignored, results };
}

export async function creditPendingCryptoDeposits() {
  const deposits = await CryptoDeposit.find({ status: 'confirming' }).limit(100).sort({ createdAt: 1 });
  const results = [];

  for (const deposit of deposits) {
    const payload = deposit.rawPayload || {};
    const output = await processCryptoWebhookPayload(payload);
    results.push({ deposit: deposit._id, output });
  }

  return results;
}
