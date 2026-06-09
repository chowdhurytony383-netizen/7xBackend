import Transaction from '../models/Transaction.js';
import DepositMethod from '../models/DepositMethod.js';
import CryptoMethod from '../models/CryptoMethod.js';
import { AppError } from '../utils/appError.js';
import { canonicalDepositMethodKey } from '../utils/paymentMethodCanonical.js';

const EPSILON = 0.000001;
const ERROR_CODE = 'WITHDRAW_METHOD_MISMATCH';

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function safeAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function niceTitle(value, fallback = 'selected payment method') {
  const text = clean(value || fallback);
  return text || fallback;
}

function stripKnownPrefix(value) {
  const raw = clean(value);
  return raw
    .replace(/^agent[-_:]/i, '')
    .replace(/^crypto[-_:]/i, '')
    .replace(/^CRYPTO[-_:]/i, '');
}

function addCatalogueItem(map, key, item) {
  const normalized = lower(key);
  if (!normalized || map.has(normalized)) return;
  map.set(normalized, item);
}

async function buildMethodCatalogue() {
  const [depositMethods, cryptoMethods] = await Promise.all([
    DepositMethod.find({}).select('key title').lean(),
    CryptoMethod.find({}).select('key displayName coin network').lean().catch(() => []),
  ]);

  const manualByKey = new Map();
  const cryptoByKey = new Map();

  for (const method of depositMethods || []) {
    const key = lower(method.key);
    if (!key) continue;

    const canonical = canonicalDepositMethodKey(method) || key;
    const title = niceTitle(method.title || method.key, key);
    const item = {
      scope: 'manual',
      canonicalKey: `manual:${canonical}`,
      title,
      rawKey: key,
    };

    addCatalogueItem(manualByKey, key, item);
    addCatalogueItem(manualByKey, canonical, item);
  }

  for (const method of cryptoMethods || []) {
    const key = upper(method.key);
    if (!key) continue;

    const title = niceTitle(method.displayName || method.coin || method.key, key);
    const item = {
      scope: 'crypto',
      canonicalKey: `crypto:${key}`,
      title,
      rawKey: key,
    };

    addCatalogueItem(cryptoByKey, key, item);
    addCatalogueItem(cryptoByKey, `crypto_${key}`, item);
    addCatalogueItem(cryptoByKey, `crypto-${key}`, item);
  }

  return { manualByKey, cryptoByKey };
}

function resolveManualMethod(rawKey, catalogue, fallbackTitle = '') {
  const stripped = stripKnownPrefix(rawKey);
  const lowerKey = lower(stripped || rawKey);
  if (!lowerKey) return null;

  const known = catalogue.manualByKey.get(lowerKey);
  if (known) return known;

  const canonical = canonicalDepositMethodKey({ key: lowerKey, title: fallbackTitle || lowerKey }) || lowerKey;
  return {
    scope: 'manual',
    canonicalKey: `manual:${canonical}`,
    title: niceTitle(fallbackTitle || lowerKey, lowerKey),
    rawKey: lowerKey,
  };
}

function resolveCryptoMethod(rawKey, catalogue, fallbackTitle = '') {
  const stripped = stripKnownPrefix(rawKey);
  const upperKey = upper(stripped || rawKey);
  if (!upperKey) return null;

  const known = catalogue.cryptoByKey.get(lower(upperKey)) || catalogue.cryptoByKey.get(lower(`crypto_${upperKey}`)) || catalogue.cryptoByKey.get(lower(`crypto-${upperKey}`));
  if (known) return known;

  return {
    scope: 'crypto',
    canonicalKey: `crypto:${upperKey}`,
    title: niceTitle(fallbackTitle || upperKey, upperKey),
    rawKey: upperKey,
  };
}

function resolveLegacyMethod(rawKey, fallbackTitle = '') {
  const key = lower(stripKnownPrefix(rawKey) || rawKey);
  if (!key) return null;

  return {
    scope: 'legacy',
    canonicalKey: `legacy:${key}`,
    title: niceTitle(fallbackTitle || key, key),
    rawKey: key,
  };
}

function isCryptoTransaction(tx = {}) {
  const method = upper(tx.method);
  const source = lower(tx.gatewayPayload?.source || tx.gatewayPayload?.provider || '');
  return method.startsWith('CRYPTO') || source.includes('crypto') || source.includes('tatum');
}

function resolveDepositTransactionMethod(tx, catalogue) {
  const payloadMethod = tx.gatewayPayload?.paymentMethod || tx.gatewayPayload?.method || {};
  const rawMethodKey = clean(tx.methodKey || payloadMethod.key || '');
  const rawMethod = clean(tx.method || '');

  if (isCryptoTransaction(tx)) {
    return resolveCryptoMethod(rawMethodKey || rawMethod, catalogue, payloadMethod.title || payloadMethod.displayName || tx.method);
  }

  const manual = resolveManualMethod(rawMethodKey || rawMethod, catalogue, payloadMethod.baseTitle || payloadMethod.title || tx.method);
  if (manual) return manual;

  return resolveLegacyMethod(rawMethodKey || rawMethod, tx.method);
}

async function getTopDepositMethodSummary(userId) {
  const catalogue = await buildMethodCatalogue();
  const deposits = await Transaction.find({
    user: userId,
    type: 'DEPOSIT',
    status: 'SUCCESS',
    amount: { $gt: 0 },
  }).select('amount method methodKey gatewayPayload').lean();

  const totals = new Map();

  for (const tx of deposits || []) {
    const resolved = resolveDepositTransactionMethod(tx, catalogue);
    const amount = safeAmount(tx.amount);
    if (!resolved || !amount) continue;

    const current = totals.get(resolved.canonicalKey) || {
      canonicalKey: resolved.canonicalKey,
      title: resolved.title,
      totalAmount: 0,
      scope: resolved.scope,
      keys: new Set(),
    };

    current.totalAmount += amount;
    if (resolved.rawKey) current.keys.add(resolved.rawKey);
    totals.set(resolved.canonicalKey, current);
  }

  if (!totals.size) {
    return {
      hasRestriction: false,
      allowedMethods: [],
      highestDepositAmount: 0,
    };
  }

  const ranked = [...totals.values()].sort((a, b) => b.totalAmount - a.totalAmount);
  const highestDepositAmount = ranked[0].totalAmount;
  const allowedMethods = ranked
    .filter((item) => Math.abs(item.totalAmount - highestDepositAmount) <= EPSILON)
    .map((item) => ({
      ...item,
      keys: [...item.keys],
    }));

  return {
    hasRestriction: true,
    allowedMethods,
    highestDepositAmount,
  };
}

function buildMismatchMessage(allowedMethods) {
  const allowedNames = allowedMethods.map((item) => item.title).filter(Boolean);
  const uniqueAllowedNames = [...new Set(allowedNames)];
  const methodText = uniqueAllowedNames.length ? uniqueAllowedNames.join(' / ') : 'your highest deposit payment method';

  return `Withdrawal is allowed only through the payment method you deposited the most with: ${methodText}. Please select ${methodText} to continue.`;
}

async function resolveSelectedWithdrawMethod({ scope = 'manual', methodKey = '', method = '', title = '' }) {
  const catalogue = await buildMethodCatalogue();
  const rawKey = methodKey || method;

  if (scope === 'crypto') return resolveCryptoMethod(rawKey, catalogue, title);
  if (scope === 'legacy') return resolveLegacyMethod(rawKey, title);
  return resolveManualMethod(rawKey, catalogue, title);
}

export async function assertWithdrawMethodMatchesTopDeposit({ userId, scope = 'manual', methodKey = '', method = '', title = '' }) {
  const [summary, selected] = await Promise.all([
    getTopDepositMethodSummary(userId),
    resolveSelectedWithdrawMethod({ scope, methodKey, method, title }),
  ]);

  if (!summary.hasRestriction || !selected) return summary;

  const allowedKeys = new Set(summary.allowedMethods.map((item) => item.canonicalKey));
  if (allowedKeys.has(selected.canonicalKey)) return summary;

  throw new AppError(
    buildMismatchMessage(summary.allowedMethods),
    403,
    {
      code: ERROR_CODE,
      selectedMethod: selected.title,
      selectedMethodKey: selected.rawKey,
      allowedMethods: summary.allowedMethods.map((item) => ({
        title: item.title,
        methodKey: item.rawKey || item.keys?.[0] || '',
        totalAmount: item.totalAmount,
      })),
      highestDepositAmount: summary.highestDepositAmount,
    }
  );
}

export async function getHighestDepositPaymentMethodForUser(userId) {
  return getTopDepositMethodSummary(userId);
}
