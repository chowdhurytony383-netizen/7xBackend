import express from 'express';
import { getMyBets, getMyBetsByGame, getMyBetStats, getMyBetStatsByGame } from '../controllers/betController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.get('/fetch-bets-by-user', protect, getMyBets);
router.get('/fetch-user-bet-by-game', protect, getMyBetsByGame);
router.get('/get-user-totalwin-and-winningstreak', protect, getMyBetStats);
router.get('/get-user-totalwin-and-winningstreak-by-game', protect, getMyBetStatsByGame);
export default router;
