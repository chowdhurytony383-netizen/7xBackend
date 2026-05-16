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

function publicAffiliate(partner) {
  if (!partner) return null;
  const raw = partner.toObject ? partner.toObject() : { ...partner };
  return raw;
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

  const displayName = optionalString(req.body.displayName || req.user.fullName || req.user.name, 120) || req.user.userId;
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
  });

  res.status(201).json({ success: true, message: 'Affiliate application submitted for admin approval', data: publicAffiliate(partner) });
});

export const myAffiliateDashboard = asyncHandler(async (req, res) => {
  const partner = await AffiliatePartner.findOne({ user: req.user._id });
  assertOrThrow(partner, 'Affiliate account not found. Please apply first.', 404);

  const [periods, payouts, clicks, referredUsers] = await Promise.all([
    AffiliatePeriod.find({ affiliate: partner._id }).sort({ periodStart: -1 }).limit(24),
    AffiliatePayout.find({ affiliate: partner._id }).sort({ createdAt: -1 }).limit(24),
    AffiliateClick.countDocuments({ affiliate: partner._id }),
    User.find({ affiliatePartner: partner._id }).select('userId fullName name email country currency createdAt').sort({ createdAt: -1 }).limit(200),
  ]);

  const baseUrl = String(process.env.FRONTEND_URL || 'https://7xbet.asia').replace(/\/$/, '');
  res.json({
    success: true,
    data: {
      affiliate: publicAffiliate(partner),
      trackingLink: `${baseUrl}/register?aff=${partner.affiliateCode}`,
      stats: { ...partner.stats.toObject?.() || partner.stats, clicks },
      periods,
      payouts,
      referredUsers,
    },
  });
});

export const listMyAffiliateUsers = asyncHandler(async (req, res) => {
  const partner = await AffiliatePartner.findOne({ user: req.user._id });
  assertOrThrow(partner, 'Affiliate account not found', 404);
  const users = await User.find({ affiliatePartner: partner._id })
    .select('userId fullName name email country currency createdAt wallet status')
    .sort({ createdAt: -1 })
    .limit(500);
  res.json({ success: true, data: users, users });
});

export const requestAffiliatePayout = asyncHandler(async (req, res) => {
  const partner = await AffiliatePartner.findOne({ user: req.user._id });
  assertOrThrow(partner, 'Affiliate account not found', 404);
  assertOrThrow(partner.status === 'approved', 'Affiliate account is not approved', 403);

  const amount = Number(req.body.amount || partner.stats.pendingCommission || 0);
  assertOrThrow(Number.isFinite(amount) && amount > 0, 'Payout amount must be greater than 0', 400);
  assertOrThrow(amount <= Number(partner.stats.pendingCommission || 0), 'Amount exceeds pending commission', 400);

  const payout = await AffiliatePayout.create({
    affiliate: partner._id,
    requestedBy: req.user._id,
    amount,
    currency: req.body.currency || req.user.currency || 'BDT',
    payoutMethod: req.body.payoutMethod || {},
    affiliateNote: optionalString(req.body.note, 500) || '',
  });

  res.status(201).json({ success: true, message: 'Affiliate payout request submitted', data: payout });
});

export const ensureMyInviteCode = asyncHandler(async (req, res) => {
  const inviteCode = await ensureUserInviteCode(req.user);
  const baseUrl = String(process.env.FRONTEND_URL || 'https://7xbet.asia').replace(/\/$/, '');
  res.json({ success: true, data: { inviteCode, inviteLink: `${baseUrl}/register?ref=${inviteCode}` } });
});
