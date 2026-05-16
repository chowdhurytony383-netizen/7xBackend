import User from '../models/User.js';
import ReferralReward from '../models/ReferralReward.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrThrow } from '../utils/appError.js';
import { ensureUserInviteCode, findReferrerByInviteCode, normalizeAcquisitionCode } from '../services/affiliateAttributionService.js';

export const myReferralDashboard = asyncHandler(async (req, res) => {
  const inviteCode = await ensureUserInviteCode(req.user);
  const [invitedUsers, rewards] = await Promise.all([
    User.find({ referredByUser: req.user._id })
      .select('userId fullName name country currency createdAt status')
      .sort({ createdAt: -1 })
      .limit(200),
    ReferralReward.find({ referrerUser: req.user._id })
      .populate('referredUser', 'userId fullName name country currency')
      .sort({ createdAt: -1 })
      .limit(200),
  ]);

  const totals = rewards.reduce((acc, reward) => {
    acc.totalReward += Number(reward.rewardAmount || 0);
    if (reward.status === 'credited') acc.credited += Number(reward.rewardAmount || 0);
    if (reward.status === 'pending') acc.pending += Number(reward.rewardAmount || 0);
    if (reward.status === 'qualified') acc.qualified += Number(reward.rewardAmount || 0);
    return acc;
  }, { totalReward: 0, credited: 0, pending: 0, qualified: 0 });

  const baseUrl = String(process.env.FRONTEND_URL || 'https://7xbet.asia').replace(/\/$/, '');
  res.json({
    success: true,
    data: {
      inviteCode,
      inviteLink: `${baseUrl}/register?ref=${inviteCode}`,
      totals,
      invitedUsers,
      rewards,
      rules: {
        referrerReward: '5% of invited user first deposit, max 500 BDT',
        unlock: 'Reward unlocks after invited user completes 50% deposit turnover',
      },
    },
  });
});

export const validateReferralCode = asyncHandler(async (req, res) => {
  const code = normalizeAcquisitionCode(req.params.code || req.query.code);
  const referrer = await findReferrerByInviteCode(code);
  res.json({ success: true, valid: Boolean(referrer), data: referrer ? { inviteCode: referrer.inviteCode, userId: referrer.userId } : null });
});

export const applyReferralCode = asyncHandler(async (req, res) => {
  const code = normalizeAcquisitionCode(req.body.code || req.body.referralCode || req.body.inviteCode);
  assertOrThrow(code, 'Referral code is required', 400);
  assertOrThrow(req.user.acquisitionSource === 'organic' || !req.user.acquisitionSource, 'Referral source is already set', 409);

  const referrer = await findReferrerByInviteCode(code);
  assertOrThrow(referrer, 'Referral code not found', 404);
  assertOrThrow(!referrer._id.equals(req.user._id), 'You cannot use your own invite code', 400);

  req.user.acquisitionSource = 'invite';
  req.user.referredByUser = referrer._id;
  req.user.referredByCode = referrer.inviteCode;
  req.user.referredBy = referrer.inviteCode;
  await req.user.save();

  res.json({ success: true, message: 'Referral code applied successfully', data: { referredByCode: referrer.inviteCode } });
});
