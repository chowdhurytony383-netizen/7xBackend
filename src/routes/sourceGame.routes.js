import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createSourceGameSession } from '../controllers/sourceGame.controller.js';

const router = Router();

router.get('/:gameCode/session', protect, asyncHandler(createSourceGameSession));

export default router;