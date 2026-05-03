import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { handleVGameAction, handleVGameHistoryDetail } from '../controllers/vgamesController.js';

const router = Router();

router.get('/history/:betId', asyncHandler(handleVGameHistoryDetail));
router.all('/:token/:action', asyncHandler(handleVGameAction));

export default router;
