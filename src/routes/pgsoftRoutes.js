import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  adjustPgsoftBalance,
  betPayoutPgsoft,
  getPgsoftWallet,
  launchPgsoftGame,
  listPgsoftGames,
  verifyPgsoftSession,
} from '../controllers/pgsoftController.js';

const router = express.Router();

router.get('/games', listPgsoftGames);

// Frontend launch API. It returns PG SOFT HTML directly.
router.post('/launch', protect, launchPgsoftGame);
router.post('/launch/:gameId', protect, launchPgsoftGame);

// PG SOFT Seamless Wallet callbacks.
router.post('/verify-session', verifyPgsoftSession);
router.post('/wallet', getPgsoftWallet);
router.post('/bet-payout', betPayoutPgsoft);
router.post('/adjustment', adjustPgsoftBalance);

export default router;
