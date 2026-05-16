import AffiliatePartner from '../models/AffiliatePartner.js';
import AffiliatePayout from '../models/AffiliatePayout.js';
import Transaction from '../models/Transaction.js';
import { assertOrThrow } from '../utils/appError.js';
import { creditWallet } from '../utils/wallet.js';
import { convertUsdToCurrency } from './fxRateService.js';

function roundMoney(value) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

export function getAffiliateConfig() {
  return {
    minimumPayoutUsd: Number(process.env.AFFILIATE_MIN_PAYOUT_USD || 30),
    payoutDay: Number(process.env.AFFILIATE_WEEKLY_PAYOUT_DAY || 2), // 2 = Tuesday
    timezone: process.env.AFFILIATE_PAYOUT_TIMEZONE || process.env.AGENT_COMMISSION_PAYOUT_TIMEZONE || 'Asia/Dhaka',
    autoPayout: String(process.env.AFFILIATE_AUTO_PAYOUT_ENABLED ?? 'true').toLowerCase() !== 'false',
  };
}

export function getWeekdayInTimezone(date = new Date(), timezone = 'Asia/Dhaka') {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value);
}

export function getDateKeyInTimezone(date = new Date(), timezone = 'Asia/Dhaka') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function isPayoutDay(date = new Date()) {
  const config = getAffiliateConfig();
  return getWeekdayInTimezone(date, config.timezone) === config.payoutDay;
}

export async function getMinimumPayoutForAffiliate(affiliate, user = null) {
  const config = getAffiliateConfig();
  const currency = String(affiliate?.payoutCurrency || user?.currency || 'BDT').toUpperCase();
  const usd = Number(affiliate?.minimumPayoutUsd || config.minimumPayoutUsd || 30);
  const converted = await convertUsdToCurrency(usd, currency);
  return {
    minimumPayoutUsd: usd,
    minimumPayoutLocal: converted.amount,
    currency,
    usdToCurrencyRate: converted.rate,
    fxSource: converted.source,
    fxDateKey: converted.dateKey,
  };
}

export async function createAffiliatePayout({ affiliate, user, amount, payoutType = 'manual_request', payoutMethod = {}, note = '', enforceTuesday = true }) {
  const partner = affiliate?._id ? affiliate : await AffiliatePartner.findById(affiliate).populate('user');
  assertOrThrow(partner, 'Affiliate account not found', 404);
  assertOrThrow(partner.status === 'approved', 'Affiliate account is not approved', 403);

  const owner = user || partner.user;
  const config = getAffiliateConfig();
  if (enforceTuesday) {
    assertOrThrow(isPayoutDay(new Date()), 'Affiliate payouts can be requested only on Tuesday', 400);
  }

  assertOrThrow(!partner.payoutHold, partner.payoutHoldReason || 'Affiliate payout is held for fraud review', 403);

  const min = await getMinimumPayoutForAffiliate(partner, owner);
  const requested = roundMoney(amount || partner.stats?.pendingCommission || 0);
  assertOrThrow(requested > 0, 'Payout amount must be greater than 0', 400);
  assertOrThrow(requested <= roundMoney(partner.stats?.pendingCommission || 0), 'Amount exceeds available commission', 400);
  assertOrThrow(requested >= min.minimumPayoutLocal, `Minimum payout is ${min.minimumPayoutLocal} ${min.currency} (${min.minimumPayoutUsd} USD equivalent)`, 400);

  await AffiliatePartner.updateOne(
    { _id: partner._id },
    { $set: { 'stats.lastMinimumPayoutLocal': min.minimumPayoutLocal, 'stats.lastMinimumPayoutCurrency': min.currency } }
  );

  return AffiliatePayout.create({
    affiliate: partner._id,
    requestedBy: owner?._id || partner.user,
    amount: requested,
    currency: min.currency,
    minimumPayoutUsd: min.minimumPayoutUsd,
    minimumPayoutLocal: min.minimumPayoutLocal,
    usdToCurrencyRate: min.usdToCurrencyRate,
    payoutWeekKey: getDateKeyInTimezone(new Date(), config.timezone),
    payoutType,
    destination: payoutMethod?.method && payoutMethod.method !== 'internal_wallet' ? 'external_method' : 'internal_wallet',
    payoutMethod: payoutMethod || { method: 'internal_wallet' },
    affiliateNote: note,
  });
}

export async function markAffiliatePayoutPaid(payout, adminUserId = null) {
  const doc = payout?._id ? payout : await AffiliatePayout.findById(payout).populate({ path: 'affiliate', populate: { path: 'user' } });
  assertOrThrow(doc, 'Affiliate payout not found', 404);
  if (doc.status === 'paid') return doc;

  const affiliate = doc.affiliate?._id ? doc.affiliate : await AffiliatePartner.findById(doc.affiliate).populate('user');
  assertOrThrow(affiliate, 'Affiliate account not found', 404);

  const transaction = await Transaction.create({
    user: affiliate.user?._id || affiliate.user,
    type: 'BONUS',
    amount: doc.amount,
    status: 'SUCCESS',
    method: 'affiliate_commission_payout',
    currency: doc.currency,
    balanceType: 'MAIN',
    gatewayPayload: { affiliatePayout: doc._id, affiliate: affiliate._id, payoutType: doc.payoutType },
    processedAt: new Date(),
    processedBy: adminUserId || undefined,
    userNote: 'Affiliate commission payout credited to main wallet',
  });

  await creditWallet(affiliate.user?._id || affiliate.user, doc.amount, 'affiliate-commission-payout', {
    turnoverMeta: { affiliatePayout: doc._id },
  });

  doc.status = 'paid';
  doc.autoTransfer = doc.payoutType === 'automatic_weekly';
  doc.paidAt = new Date();
  doc.paidBy = adminUserId || undefined;
  doc.paidTransaction = transaction._id;
  await doc.save();

  await AffiliatePartner.updateOne(
    { _id: affiliate._id },
    {
      $inc: {
        'stats.pendingCommission': -Number(doc.amount || 0),
        'stats.commissionPaid': Number(doc.amount || 0),
      },
      $set: { lastAutoPayoutWeekKey: doc.payoutWeekKey || '' },
    }
  );

  return doc;
}

export async function autoPayAffiliateIfEligible(affiliate) {
  const partner = affiliate?._id ? await AffiliatePartner.findById(affiliate._id).populate('user') : await AffiliatePartner.findById(affiliate).populate('user');
  if (!partner || partner.status !== 'approved') return { paid: false, reason: 'not-approved' };
  if (!partner.autoPayoutEnabled) return { paid: false, reason: 'auto-disabled' };
  if (partner.payoutHold) return { paid: false, reason: 'fraud-hold' };

  const amount = roundMoney(partner.stats?.pendingCommission || 0);
  if (amount <= 0) return { paid: false, reason: 'no-commission' };

  const min = await getMinimumPayoutForAffiliate(partner, partner.user);
  if (amount < min.minimumPayoutLocal) {
    await AffiliatePartner.updateOne({ _id: partner._id }, { $set: { 'stats.lastMinimumPayoutLocal': min.minimumPayoutLocal, 'stats.lastMinimumPayoutCurrency': min.currency } });
    return { paid: false, reason: 'below-minimum', amount, minimum: min.minimumPayoutLocal, currency: min.currency };
  }

  const payout = await createAffiliatePayout({
    affiliate: partner,
    user: partner.user,
    amount,
    payoutType: 'automatic_weekly',
    payoutMethod: { method: 'internal_wallet', note: 'Automatic Tuesday affiliate payout to user main wallet' },
    note: 'Automatic weekly Tuesday payout',
    enforceTuesday: false,
  });

  const paid = await markAffiliatePayoutPaid(payout);
  return { paid: true, payout: paid };
}
