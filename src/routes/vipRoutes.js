import express from 'express';
import { claimMyVipReward, myVipSummary } from '../controllers/vipController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/me', protect, myVipSummary);
router.post('/rewards/:rewardId/claim', protect, claimMyVipReward);

export default router;
