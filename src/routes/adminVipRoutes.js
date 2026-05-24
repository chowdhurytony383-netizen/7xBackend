import express from 'express';
import {
  adminApproveVipReward,
  adminCalculateVipRewards,
  adminRejectVipReward,
  adminUpsertVipLevel,
  adminVipLevels,
  adminVipRewards,
} from '../controllers/vipController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect, requireAdmin);

router.get('/vip/levels', adminVipLevels);
router.post('/vip/levels', adminUpsertVipLevel);
router.get('/vip/rewards', adminVipRewards);
router.post('/vip/calculate', adminCalculateVipRewards);
router.post('/vip/rewards/:rewardId/approve', adminApproveVipReward);
router.post('/vip/rewards/:rewardId/reject', adminRejectVipReward);

export default router;
