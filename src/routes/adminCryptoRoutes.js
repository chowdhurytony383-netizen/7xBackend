import express from 'express';
import { adminListCryptoMethods, adminSyncCryptoSubscriptions, adminUpdateCryptoMethod } from '../controllers/cryptoController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/crypto-methods', protect, requireAdmin, adminListCryptoMethods);
router.patch('/crypto-methods/:key', protect, requireAdmin, adminUpdateCryptoMethod);
router.post('/crypto/subscriptions/sync', protect, requireAdmin, adminSyncCryptoSubscriptions);

export default router;
