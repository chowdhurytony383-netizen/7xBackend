import express from 'express';
import { adminListCryptoMethods, adminUpdateCryptoMethod } from '../controllers/cryptoController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/crypto-methods', protect, requireAdmin, adminListCryptoMethods);
router.patch('/crypto-methods/:key', protect, requireAdmin, adminUpdateCryptoMethod);

export default router;
