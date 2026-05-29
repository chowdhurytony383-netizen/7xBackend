import express from 'express';
import {
  categories,
  eventDetails,
  liveMatches,
  matchOfTheDay,
  myBets,
  opticOddsCoverage,
  opticOddsCoverageSection,
  placeBet,
  placeMultipleBets,
  settleNow,
  syncNow,
  syncStatus,
  sportsOverview,
} from '../controllers/sportsController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/overview', sportsOverview);
router.get('/categories', categories);
router.get('/live', liveMatches);
router.get('/matches', liveMatches);
router.get('/live-matches', liveMatches);
router.get('/match-of-the-day', matchOfTheDay);
router.get('/events/:eventId', eventDetails);
router.get('/sync-status', syncStatus);
router.get('/opticodds/coverage', opticOddsCoverage);
router.get('/opticodds/coverage/:kind', opticOddsCoverageSection);

router.post('/bets/place', protect, placeBet);
router.post('/bets/place-multiple', protect, placeMultipleBets);
router.get('/bets/my', protect, myBets);

router.get('/auto/sync', protect, requireAdmin, syncNow);
router.post('/auto/sync', protect, requireAdmin, syncNow);
router.get('/auto/settle', protect, requireAdmin, settleNow);
router.post('/auto/settle', protect, requireAdmin, settleNow);

export default router;
