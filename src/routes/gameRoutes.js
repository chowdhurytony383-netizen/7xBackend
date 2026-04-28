import express from 'express';
import { endMines, getAllGames, pendingMines, revealMineTile, rollDice, startMines } from '../controllers/gameController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.get('/get-all-games', getAllGames);
router.post('/dice/roll-dice', protect, rollDice);
router.post('/mines/start-mine', protect, startMines);
router.patch('/mines/reveal-tile', protect, revealMineTile);
router.post('/mines/end-mine', protect, endMines);
router.get('/mines/pending-mine', protect, pendingMines);
export default router;
