import express from 'express';
import {
  categories,
  eventDetails,
  liveMatches,
  matchOfTheDay,
  myBets,
  placeBet,
  settleNow,
  syncNow,
  syncStatus,
} from '../controllers/sportsController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/categories', categories);
router.get('/live-matches', liveMatches);
router.get('/match-of-the-day', matchOfTheDay);
router.get('/events/:eventId', eventDetails);
router.get('/sync-status', syncStatus);

router.post('/bets/place', protect, placeBet);
router.get('/bets/my', protect, myBets);

router.post('/auto/sync', protect, requireAdmin, syncNow);
router.post('/auto/settle', protect, requireAdmin, settleNow);

export default router;
