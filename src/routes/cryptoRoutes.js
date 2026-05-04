import express from 'express';
import {
  createCryptoWithdrawal,
  cryptoWithdrawOptions,
  kmsApproveTransaction,
  myCryptoAddresses,
  myCryptoDeposits,
  myCryptoWithdrawals,
  refreshMyCryptoAddresses,
  tatumWebhook,
} from '../controllers/cryptoController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/addresses', protect, myCryptoAddresses);
router.post('/addresses/refresh', protect, refreshMyCryptoAddresses);
router.get('/deposits', protect, myCryptoDeposits);
router.get('/withdraw-options', protect, cryptoWithdrawOptions);
router.post('/withdrawals', protect, createCryptoWithdrawal);
router.get('/withdrawals', protect, myCryptoWithdrawals);

// Tatum KMS external approval URL.
// KMS calls GET /api/crypto/kms/approve/:kmsId and signs only when backend returns 200 OK.
router.get('/kms/approve/:kmsId', kmsApproveTransaction);
router.get('/kms/approve', kmsApproveTransaction);

router.post('/webhook/tatum', tatumWebhook);

export default router;
