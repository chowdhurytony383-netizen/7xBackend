import express from 'express';
import { myCryptoAddresses, myCryptoDeposits, refreshMyCryptoAddresses, tatumWebhook } from '../controllers/cryptoController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/addresses', protect, myCryptoAddresses);
router.post('/addresses/refresh', protect, refreshMyCryptoAddresses);
router.get('/deposits', protect, myCryptoDeposits);
router.post('/webhook/tatum', tatumWebhook);

export default router;
