import VipReward from '../models/VipReward.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { optionalString } from '../utils/validation.js';
import {
  approveVipReward,
  calculateMonthlyVipRewards,
  claimVipReward,
  getUserVipSummary,
  getVipLevels,
  getVipPeriod,
  rejectVipReward,
  upsertVipLevel,
} from '../services/vipRewardService.js';

export const myVipSummary = asyncHandler(async (req, res) => {
  const summary = await getUserVipSummary(req.user._id);
  res.json({ success: true, data: summary });
});

export const claimMyVipReward = asyncHandler(async (req, res) => {
  const result = await claimVipReward({ rewardId: req.params.rewardId, userId: req.user._id });
  res.json({ success: true, message: 'VIP reward claimed. Bonus turnover requirement created.', data: result });
});

export const adminVipLevels = asyncHandler(async (_req, res) => {
  const levels = await getVipLevels({ includeInactive: true });
  res.json({ success: true, data: levels, levels });
});

export const adminUpsertVipLevel = asyncHandler(async (req, res) => {
  const level = await upsertVipLevel(req.body || {});
  res.json({ success: true, message: 'VIP level saved', data: level, level });
});

export const adminVipRewards = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.periodKey) filter.periodKey = String(req.query.periodKey);
  if (req.query.userId) filter.user = req.query.userId;

  const rewards = await VipReward.find(filter)
    .populate('user', 'name fullName email phone username userId wallet currency isVerified verificationStatus')
    .sort({ periodStart: -1, createdAt: -1 })
    .limit(300);

  res.json({ success: true, data: rewards, rewards });
});

export const adminCalculateVipRewards = asyncHandler(async (req, res) => {
  const period = req.body?.periodKey
    ? (() => {
      const [year, month] = String(req.body.periodKey).split('-').map(Number);
      const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      return { periodKey: String(req.body.periodKey), periodStart: start, periodEnd: end };
    })()
    : getVipPeriod(new Date(), Number(req.body?.offsetMonths ?? -1));

  const result = await calculateMonthlyVipRewards({
    period,
    userId: req.body?.userId || null,
    recalculate: Boolean(req.body?.recalculate),
  });

  res.json({ success: true, message: 'VIP rewards calculated', data: result });
});

export const adminApproveVipReward = asyncHandler(async (req, res) => {
  const reward = await approveVipReward({ rewardId: req.params.rewardId, adminId: req.user._id, note: optionalString(req.body.note, 500) || '' });
  res.json({ success: true, message: 'VIP reward approved', data: reward, reward });
});

export const adminRejectVipReward = asyncHandler(async (req, res) => {
  const reward = await rejectVipReward({ rewardId: req.params.rewardId, adminId: req.user._id, reason: optionalString(req.body.reason, 500) || '' });
  res.json({ success: true, message: 'VIP reward rejected', data: reward, reward });
});
