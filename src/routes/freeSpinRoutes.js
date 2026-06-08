import express from 'express';
import rateLimit from 'express-rate-limit';
import { getFreeSpinStatus, spinFreeWheel } from '../controllers/freeSpinController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const spinLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/status', protect, getFreeSpinStatus);
router.post('/spin', protect, spinLimiter, spinFreeWheel);

export default router;
