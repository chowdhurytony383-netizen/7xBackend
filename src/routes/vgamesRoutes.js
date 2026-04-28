import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { handleVGameAction } from '../controllers/vgamesController.js';

const router = Router();

router.all('/:token/:action', asyncHandler(handleVGameAction));

export default router;
