import express from 'express';
import { createDepositOrder, requestRazorpayPayout, verifyDepositPayment } from '../controllers/transactionController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.post('/create-deposit-order', protect, createDepositOrder);
router.post('/verify-deposit-payment', protect, verifyDepositPayment);
router.post('/withdraw-payout-razorpay', protect, requestRazorpayPayout);
export default router;
