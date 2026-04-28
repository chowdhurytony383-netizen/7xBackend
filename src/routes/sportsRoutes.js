import express from 'express';
import { categories, liveMatches, matchOfTheDay } from '../controllers/sportsController.js';

const router = express.Router();
router.get('/categories', categories);
router.get('/live-matches', liveMatches);
router.get('/match-of-the-day', matchOfTheDay);
export default router;
