import AffiliatePartner from '../models/AffiliatePartner.js';
import AffiliatePeriod from '../models/AffiliatePeriod.js';
import AffiliatePayout from '../models/AffiliatePayout.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrThrow } from '../utils/appError.js';
import { optionalString } from '../utils/validation.js';
import { approveAffiliatePeriod, calculateAffiliatePeriod } from '../services/affiliateCommissionService.js';

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
  const [users, periods, payouts] = await Promise.all([
    User.find({ affiliatePartner: affiliate._id }).select('userId fullName name email country currency createdAt wallet status').sort({ createdAt: -1 }).limit(500),
    AffiliatePeriod.find({ affiliate: affiliate._id }).sort({ periodStart: -1 }).limit(100),
    AffiliatePayout.find({ affiliate: affiliate._id }).sort({ createdAt: -1 }).limit(100),
  ]);
  res.json({ success: true, data: { affiliate, users, periods, payouts } });
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
  affiliate.adminNote = optionalString(req.body.note, 1000) || affiliate.adminNote;
  await affiliate.save();

  res.json({ success: true, message: 'Affiliate commission updated', data: affiliate });
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
    .populate({ path: 'affiliate', populate: { path: 'user', select: 'userId fullName name email' } })
    .sort({ createdAt: -1 })
    .limit(500);
  res.json({ success: true, data: payouts, payouts });
});

export const updatePayoutStatus = asyncHandler(async (req, res) => {
  const payout = await AffiliatePayout.findById(req.params.payoutId).populate('affiliate');
  assertOrThrow(payout, 'Payout request not found', 404);
  const status = String(req.body.status || '').toLowerCase();
  assertOrThrow(['pending', 'approved', 'paid', 'rejected', 'cancelled'].includes(status), 'Invalid payout status', 400);

  const previous = payout.status;
  payout.status = status;
  payout.adminNote = optionalString(req.body.note, 1000) || payout.adminNote;
  if (status === 'approved') {
    payout.approvedBy = req.user._id;
    payout.approvedAt = new Date();
  }
  if (status === 'paid') {
    payout.paidBy = req.user._id;
    payout.paidAt = new Date();
  }
  await payout.save();

  if (status === 'paid' && previous !== 'paid' && payout.affiliate) {
    await AffiliatePartner.updateOne(
      { _id: payout.affiliate._id },
      {
        $inc: {
          'stats.pendingCommission': -Number(payout.amount || 0),
          'stats.commissionPaid': Number(payout.amount || 0),
        },
      }
    );
  }

  res.json({ success: true, message: `Payout ${status}`, data: payout });
});
