import AffiliatePartner from '../models/AffiliatePartner.js';
import AffiliateClick from '../models/AffiliateClick.js';
import AffiliatePeriod from '../models/AffiliatePeriod.js';
import AffiliatePayout from '../models/AffiliatePayout.js';
import User from '../models/User.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { optionalString, requireString } from '../utils/validation.js';
import {
  createUniqueAffiliateCode,
  ensureUserInviteCode,
  findApprovedAffiliateByCode,
  normalizeAcquisitionCode,
  recordAffiliateClick,
} from '../services/affiliateAttributionService.js';
import { getAffiliateTimeBreakdown, getAffiliateUserPerformance, getRangeFromQuery, toCsv } from '../services/affiliateAnalyticsService.js';
import { createAffiliatePayout, getMinimumPayoutForAffiliate, isPayoutDay } from '../services/affiliatePayoutService.js';
import { runAffiliateFraudScan } from '../services/affiliateFraudService.js';

function publicAffiliate(partner) {
  if (!partner) return null;
  return partner.toObject ? partner.toObject() : { ...partner };
}

export const validateAffiliateCode = asyncHandler(async (req, res) => {
  const code = normalizeAcquisitionCode(req.params.code || req.query.code);
  const affiliate = await findApprovedAffiliateByCode(code);
  res.json({ success: true, valid: Boolean(affiliate), data: affiliate ? { affiliateCode: affiliate.affiliateCode, displayName: affiliate.displayName } : null });
});

export const trackAffiliateClick = asyncHandler(async (req, res) => {
  const code = normalizeAcquisitionCode(req.params.code || req.body.code || req.query.code);
  const affiliate = await findApprovedAffiliateByCode(code);
  if (!affiliate) return res.status(404).json({ success: false, message: 'Affiliate code not found or not approved' });
  await recordAffiliateClick(req, affiliate);
  res.json({ success: true, message: 'Affiliate click tracked', data: { affiliateCode: affiliate.affiliateCode } });
});

export const applyAffiliate = asyncHandler(async (req, res) => {
  const existing = await AffiliatePartner.findOne({ user: req.user._id });
  if (existing) {
    return res.json({ success: true, message: 'Affiliate application already exists', data: publicAffiliate(existing) });
  }

  const displayName = requireString(req.body.displayName || req.user.fullName || req.user.name || req.user.username, 'Display name', 2, 120);
  const codeSeed = optionalString(req.body.preferredCode || req.user.userId || req.user.username, 20) || '';
  const affiliateCode = await createUniqueAffiliateCode(codeSeed);

  const partner = await AffiliatePartner.create({
    user: req.user._id,
    affiliateCode,
    displayName,
    companyName: optionalString(req.body.companyName, 160) || '',
    website: optionalString(req.body.website, 250) || '',
    trafficSources: Array.isArray(req.body.trafficSources) ? req.body.trafficSources.map((item) => String(item).slice(0, 100)) : [],
    countries: Array.isArray(req.body.countries) ? req.body.countries.map((item) => String(item).slice(0, 100)) : [],
    applyNote: optionalString(req.body.applyNote || req.body.note, 1000) || '',
    status: 'pending',
    tier: 'standard',
    commissionRate: 0.30,
    negativeCarryover: true,
    minimumPayoutUsd: Number(process.env.AFFILIATE_MIN_PAYOUT_USD || 30),
    weeklyPayoutDay: Number(process.env.AFFILIATE_WEEKLY_PAYOUT_DAY || 2),
    autoPayoutEnabled: true,
    payoutCurrency: req.user.currency || 'BDT',
  });

  res.status(201).json({ success: true, message: 'Affiliate application submitted for admin approval', data: publicAffiliate(partner) });
});

async function loadDashboardData(req) {
  const partner = await AffiliatePartner.findOne({ user: req.user._id });
  assertOrThrow(partner, 'Affiliate account not found. Please apply first.', 404);

  const range = getRangeFromQuery(req.query || {});
  const [periods, payouts, clicks, referredUsers, userPerformance, dailyBreakdown, weeklyBreakdown, minimumPayout] = await Promise.all([
    AffiliatePeriod.find({ affiliate: partner._id }).sort({ periodStart: -1 }).limit(24),
    AffiliatePayout.find({ affiliate: partner._id }).sort({ createdAt: -1 }).limit(24),
    AffiliateClick.countDocuments({ affiliate: partner._id }),
    User.find({ affiliatePartner: partner._id }).select('userId fullName name email country currency createdAt status').sort({ createdAt: -1 }).limit(200),
    getAffiliateUserPerformance({ affiliateId: partner._id, start: range.start, end: range.end, commissionRate: partner.commissionRate }),
    getAffiliateTimeBreakdown({ affiliateId: partner._id, start: range.start, end: range.end, commissionRate: partner.commissionRate, groupBy: 'day' }),
    getAffiliateTimeBreakdown({ affiliateId: partner._id, start: range.start, end: range.end, commissionRate: partner.commissionRate, groupBy: 'week' }),
    getMinimumPayoutForAffiliate(partner, req.user),
  ]);

  const baseUrl = String(process.env.FRONTEND_URL || 'https://7xbet.asia').replace(/\/$/, '');
  return {
    affiliate: publicAffiliate(partner),
    trackingLink: `${baseUrl}/register?aff=${partner.affiliateCode}`,
    stats: { ...partner.stats.toObject?.() || partner.stats, clicks },
    periods,
    payouts,
    referredUsers,
    userPerformance,
    dailyBreakdown,
    weeklyBreakdown,
    minimumPayout,
    payoutRules: {
      minimumPayoutUsd: Number(partner.minimumPayoutUsd || process.env.AFFILIATE_MIN_PAYOUT_USD || 30),
      weeklyPayoutDay: 'Tuesday',
      canRequestToday: isPayoutDay(new Date()),
      autoPayoutEnabled: partner.autoPayoutEnabled,
      automaticTransferDestination: '7XBET main wallet',
    },
    range: { start: range.start, end: range.end },
  };
}

export const myAffiliateDashboard = asyncHandler(async (req, res) => {
  const data = await loadDashboardData(req);
  res.json({ success: true, data });
});

export const listMyAffiliateUsers = asyncHandler(async (req, res) => {
  const partner = await AffiliatePartner.findOne({ user: req.user._id });
  assertOrThrow(partner, 'Affiliate account not found', 404);
  const range = getRangeFromQuery(req.query || {});
  const users = await getAffiliateUserPerformance({ affiliateId: partner._id, start: range.start, end: range.end, commissionRate: partner.commissionRate });
  res.json({ success: true, data: users, users, range });
});

export const exportMyAffiliateUsersCsv = asyncHandler(async (req, res) => {
  const partner = await AffiliatePartner.findOne({ user: req.user._id });
  assertOrThrow(partner, 'Affiliate account not found', 404);
  const range = getRangeFromQuery(req.query || {});
  const users = await getAffiliateUserPerformance({ affiliateId: partner._id, start: range.start, end: range.end, commissionRate: partner.commissionRate });
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
  res.setHeader('content-disposition', 'attachment; filename="affiliate-users.csv"');
  res.send(csv);
});

export const exportMyAffiliatePeriodsCsv = asyncHandler(async (req, res) => {
  const partner = await AffiliatePartner.findOne({ user: req.user._id });
  assertOrThrow(partner, 'Affiliate account not found', 404);
  const periods = await AffiliatePeriod.find({ affiliate: partner._id }).sort({ periodStart: -1 }).limit(1000).lean();
  const csv = toCsv(periods, [
    { header: 'Period Start', value: 'periodStart' },
    { header: 'Period End', value: 'periodEnd' },
    { header: 'Bets', value: 'totalBets' },
    { header: 'Wins', value: 'totalWins' },
    { header: 'Bonus Cost', value: 'bonusCost' },
    { header: 'Refunds/Voids/Chargebacks', value: 'refundsVoidsChargebacks' },
    { header: 'Gross GGR', value: 'grossGgr' },
    { header: 'Previous Carryover', value: 'previousCarryover' },
    { header: 'Net GGR After Carryover', value: 'netGgrAfterCarryover' },
    { header: 'Commission Rate', value: 'commissionRate' },
    { header: 'Commission Amount', value: 'commissionAmount' },
    { header: 'Carryover After', value: 'carryoverAfter' },
    { header: 'Risk Status', value: 'riskStatus' },
    { header: 'Fraud Flags', value: 'fraudFlagCount' },
    { header: 'Status', value: 'status' },
  ]);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="affiliate-periods.csv"');
  res.send(csv);
});

export const requestAffiliatePayout = asyncHandler(async (req, res) => {
  const partner = await AffiliatePartner.findOne({ user: req.user._id }).populate('user');
  assertOrThrow(partner, 'Affiliate account not found', 404);

  const payout = await createAffiliatePayout({
    affiliate: partner,
    user: req.user,
    amount: Number(req.body.amount || partner.stats?.pendingCommission || 0),
    payoutType: 'manual_request',
    payoutMethod: req.body.payoutMethod || { method: 'internal_wallet' },
    note: optionalString(req.body.note, 500) || '',
    enforceTuesday: true,
  });

  res.status(201).json({ success: true, message: 'Affiliate payout request submitted. Payouts are processed weekly on Tuesday after review/automation.', data: payout });
});

export const scanMyAffiliateFraud = asyncHandler(async (req, res) => {
  const partner = await AffiliatePartner.findOne({ user: req.user._id });
  assertOrThrow(partner, 'Affiliate account not found', 404);
  const range = getRangeFromQuery(req.query || {});
  const result = await runAffiliateFraudScan({ affiliateId: partner._id, periodStart: range.start, periodEnd: range.end });
  res.json({ success: true, data: result });
});

export const ensureMyInviteCode = asyncHandler(async (req, res) => {
  const inviteCode = await ensureUserInviteCode(req.user);
  const baseUrl = String(process.env.FRONTEND_URL || 'https://7xbet.asia').replace(/\/$/, '');
  res.json({ success: true, data: { inviteCode, inviteLink: `${baseUrl}/register?ref=${inviteCode}` } });
});
