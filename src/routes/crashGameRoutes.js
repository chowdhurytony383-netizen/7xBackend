import express from 'express';
import { cashoutCrashBet, getCrashHistory, getCrashState, placeCrashBet } from '../controllers/crashGameController.js';
import { optionalAuth, protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/state', optionalAuth, getCrashState);
router.get('/history', getCrashHistory);
router.post('/bet', protect, placeCrashBet);
router.post('/cashout', protect, cashoutCrashBet);

export default router;
