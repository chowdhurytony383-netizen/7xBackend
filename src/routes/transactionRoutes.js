import express from 'express';
import {
  createAgentDepositRequest,
  createAgentWithdrawRequest,
  createWithdrawTransaction,
  getAgentDepositOptions,
  getAgentWithdrawOptions,
  getMyTransactions,
} from '../controllers/transactionController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/get-all-transaction-by-user-id', protect, getMyTransactions);
router.get('/agent-deposit-options', protect, getAgentDepositOptions);
router.get('/agent-withdraw-options', protect, getAgentWithdrawOptions);
router.post('/agent-deposit-request', protect, createAgentDepositRequest);
router.post('/agent-withdraw-request', protect, createAgentWithdrawRequest);

// Existing Razorpay/legacy withdrawal route kept for backward compatibility.
router.post('/create-transaction', protect, createWithdrawTransaction);

export default router;
