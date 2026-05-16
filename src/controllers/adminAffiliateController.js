import AffiliatePartner from '../models/AffiliatePartner.js';
import AffiliatePeriod from '../models/AffiliatePeriod.js';
import AffiliatePayout from '../models/AffiliatePayout.js';
import AffiliateFraudFlag from '../models/AffiliateFraudFlag.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrThrow } from '../utils/appError.js';
import { optionalString } from '../utils/validation.js';
import { approveAffiliatePeriod, calculateAffiliatePeriod } from '../services/affiliateCommissionService.js';
import { listAffiliateFraudFlags, runAffiliateFraudScan } from '../services/affiliateFraudService.js';
import { markAffiliatePayoutPaid } from '../services/affiliatePayoutService.js';
import { runWeeklyAffiliateAutomation } from '../services/affiliateAutomationService.js';
import { getAffiliateUserPerformance, getRangeFromQuery, toCsv } from '../services/affiliateAnalyticsService.js';

function parseRate(value, fallback = 0.30) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  const rate = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(0.40, rate));
}

export const listAffiliates = asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const filter = status ? { status } : {};
  const affiliates = await AffiliatePartner.find(filter)
    .populate('user', 'userId fullName name email phone country currency status')
    .sort({ createdAt: -1 })
    .limit(500);
  res.json({ success: true, data: affiliates, affiliates });
});

export const getAffiliateDetails = asyncHandler(async (req, res) => {
  const affiliate = await AffiliatePartner.findById(req.params.affiliateId)
    .populate('user', 'userId fullName name email phone country currency status wallet');
  assertOrThrow(affiliate, 'Affiliate partner not found', 404);
  const range = getRangeFromQuery(req.query || {});
  const [users, userPerformance, periods, payouts, fraudFlags] = await Promise.all([
    User.find({ affiliatePartner: affiliate._id }).select('userId fullName name email country currency createdAt wallet status registrationMeta').sort({ createdAt: -1 }).limit(500),
    getAffiliateUserPerformance({ affiliateId: affiliate._id, start: range.start, end: range.end, commissionRate: affiliate.commissionRate }),
    AffiliatePeriod.find({ affiliate: affiliate._id }).sort({ periodStart: -1 }).limit(100),
    AffiliatePayout.find({ affiliate: affiliate._id }).sort({ createdAt: -1 }).limit(100),
    AffiliateFraudFlag.find({ affiliate: affiliate._id }).sort({ createdAt: -1 }).limit(100),
  ]);
  res.json({ success: true, data: { affiliate, users, userPerformance, periods, payouts, fraudFlags, range } });
});

export const updateAffiliateStatus = asyncHandler(async (req, res) => {
  const affiliate = await AffiliatePartner.findById(req.params.affiliateId);
  assertOrThrow(affiliate, 'Affiliate partner not found', 404);
  const status = String(req.body.status || '').toLowerCase();
  assertOrThrow(['pending', 'approved', 'rejected', 'suspended'].includes(status), 'Invalid affiliate status', 400);

  affiliate.status = status;
  affiliate.adminNote = optionalString(req.body.note, 1000) || affiliate.adminNote;
  if (status === 'approved') {
    affiliate.approvedAt = new Date();
    affiliate.approvedBy = req.user._id;
    affiliate.minimumPayoutUsd = Number(affiliate.minimumPayoutUsd || process.env.AFFILIATE_MIN_PAYOUT_USD || 30);
    affiliate.weeklyPayoutDay = Number(process.env.AFFILIATE_WEEKLY_PAYOUT_DAY || 2);
  }
  if (status === 'rejected') affiliate.rejectedAt = new Date();
  if (status === 'suspended') affiliate.suspendedAt = new Date();
  await affiliate.save();

  res.json({ success: true, message: `Affiliate ${status}`, data: affiliate });
});

export const updateAffiliateCommission = asyncHandler(async (req, res) => {
  const affiliate = await AffiliatePartner.findById(req.params.affiliateId);
  assertOrThrow(affiliate, 'Affiliate partner not found', 404);

  const tier = req.body.tier ? String(req.body.tier) : affiliate.tier;
  assertOrThrow(['standard', 'vip', 'country_manager', 'custom'].includes(tier), 'Invalid tier', 400);
  const rate = parseRate(req.body.commissionRate, affiliate.commissionRate);

  if (tier === 'standard') assertOrThrow(rate === 0.30, 'Standard approved partner rate must be 30%', 400);
  if (tier === 'vip') assertOrThrow(rate >= 0.30 && rate <= 0.40, 'VIP affiliate rate must be between 30% and 40%', 400);

  affiliate.tier = tier;
  affiliate.commissionRate = rate;
  affiliate.negativeCarryover = req.body.negativeCarryover === undefined ? true : Boolean(req.body.negativeCarryover);
  affiliate.minimumPayoutUsd = Number(req.body.minimumPayoutUsd || affiliate.minimumPayoutUsd || process.env.AFFILIATE_MIN_PAYOUT_USD || 30);
  affiliate.weeklyPayoutDay = Number(req.body.weeklyPayoutDay ?? affiliate.weeklyPayoutDay ?? 2);
  affiliate.autoPayoutEnabled = req.body.autoPayoutEnabled === undefined ? affiliate.autoPayoutEnabled : Boolean(req.body.autoPayoutEnabled);
  affiliate.payoutHold = req.body.payoutHold === undefined ? affiliate.payoutHold : Boolean(req.body.payoutHold);
  affiliate.payoutHoldReason = optionalString(req.body.payoutHoldReason, 500) || affiliate.payoutHoldReason;
  affiliate.adminNote = optionalString(req.body.note, 1000) || affiliate.adminNote;
  await affiliate.save();

  res.json({ success: true, message: 'Affiliate commission/payout settings updated', data: affiliate });
});

export const calculatePeriod = asyncHandler(async (req, res) => {
  const period = await calculateAffiliatePeriod({
    affiliateId: req.params.affiliateId,
    periodStart: req.body.periodStart || req.query.periodStart,
    periodEnd: req.body.periodEnd || req.query.periodEnd,
    adminUserId: req.user._id,
    overwrite: Boolean(req.body.overwrite),
  });
  res.json({ success: true, message: 'Affiliate period calculated', data: period });
});

export const approvePeriod = asyncHandler(async (req, res) => {
  const period = await approveAffiliatePeriod(req.params.periodId, req.user._id);
  res.json({ success: true, message: 'Affiliate period approved', data: period });
});

export const listPayouts = asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const filter = status ? { status } : {};
  const payouts = await AffiliatePayout.find(filter)
    .populate({ path: 'affiliate', populate: { path: 'user', select: 'userId fullName name email currency' } })
    .sort({ createdAt: -1 })
    .limit(500);
  res.json({ success: true, data: payouts, payouts });
});

export const updatePayoutStatus = asyncHandler(async (req, res) => {
  const payout = await AffiliatePayout.findById(req.params.payoutId).populate({ path: 'affiliate', populate: { path: 'user' } });
  assertOrThrow(payout, 'Payout request not found', 404);
  const status = String(req.body.status || '').toLowerCase();
  assertOrThrow(['pending', 'approved', 'paid', 'rejected', 'cancelled'].includes(status), 'Invalid payout status', 400);

  const previous = payout.status;

  if (status === 'paid') {
    const paid = await markAffiliatePayoutPaid(payout, req.user._id);
    return res.json({ success: true, message: 'Payout paid and credited to affiliate main wallet', data: paid });
  }

  payout.status = status;
  payout.adminNote = optionalString(req.body.note, 1000) || payout.adminNote;
  if (status === 'approved') {
    payout.approvedBy = req.user._id;
    payout.approvedAt = new Date();
  }
  if (['rejected', 'cancelled'].includes(status)) {
    payout.failureReason = optionalString(req.body.reason || req.body.note, 500) || '';
  }
  await payout.save();

  if (previous === 'paid' && status !== 'paid' && payout.affiliate) {
    // Manual rollback of an already-paid affiliate payout must be handled with admin adjustment.
  }

  res.json({ success: true, message: `Payout ${status}`, data: payout });
});

export const scanAffiliateFraud = asyncHandler(async (req, res) => {
  const range = getRangeFromQuery(req.body || req.query || {});
  const result = await runAffiliateFraudScan({ affiliateId: req.params.affiliateId, periodStart: range.start, periodEnd: range.end });
  res.json({ success: true, message: 'Fraud scan completed', data: result });
});

export const listFraudFlags = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.affiliateId) filter.affiliate = req.query.affiliateId;
  const flags = await listAffiliateFraudFlags(filter);
  res.json({ success: true, data: flags, flags });
});

export const updateFraudFlagStatus = asyncHandler(async (req, res) => {
  const flag = await AffiliateFraudFlag.findById(req.params.flagId);
  assertOrThrow(flag, 'Fraud flag not found', 404);
  const status = String(req.body.status || '').toLowerCase();
  assertOrThrow(['open', 'reviewed', 'cleared', 'confirmed'].includes(status), 'Invalid fraud flag status', 400);
  flag.status = status;
  flag.adminNote = optionalString(req.body.note, 1000) || flag.adminNote;
  flag.reviewedAt = new Date();
  flag.reviewedBy = req.user._id;
  await flag.save();

  const openHigh = await AffiliateFraudFlag.countDocuments({ affiliate: flag.affiliate, status: 'open', severity: { $in: ['high', 'critical'] }, autoHoldPayout: true });
  if (openHigh === 0) {
    await AffiliatePartner.updateOne({ _id: flag.affiliate }, { $set: { payoutHold: false, payoutHoldReason: '', 'fraud.highRiskFlags': 0 } });
  }

  res.json({ success: true, message: 'Fraud flag updated', data: flag });
});

export const runAffiliateAutomationNow = asyncHandler(async (req, res) => {
  const result = await runWeeklyAffiliateAutomation({ force: Boolean(req.body.force ?? true), adminUserId: req.user._id });
  res.json({ success: true, message: 'Affiliate weekly automation executed', data: result });
});

export const exportAffiliateUsersCsv = asyncHandler(async (req, res) => {
  const affiliate = await AffiliatePartner.findById(req.params.affiliateId);
  assertOrThrow(affiliate, 'Affiliate partner not found', 404);
  const range = getRangeFromQuery(req.query || {});
  const users = await getAffiliateUserPerformance({ affiliateId: affiliate._id, start: range.start, end: range.end, commissionRate: affiliate.commissionRate });
  const csv = toCsv(users, [
    { header: 'User ID', value: (row) => row.user.userId },
    { header: 'Name', value: (row) => row.user.fullName || row.user.name },
    { header: 'Email', value: (row) => row.user.email },
    { header: 'Currency', value: (row) => row.user.currency || 'BDT' },
    { header: 'Registered At', value: (row) => row.user.createdAt },
    { header: 'Deposits', value: 'deposits' },
    { header: 'Withdrawals', value: 'withdrawals' },
    { header: 'Bets', value: 'bets' },
    { header: 'Wins', value: 'wins' },
    { header: 'Loss', value: 'loss' },
    { header: 'GGR', value: 'ggr' },
    { header: 'Estimated Commission', value: 'estimatedCommission' },
  ]);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="admin-affiliate-users.csv"');
  res.send(csv);
});
