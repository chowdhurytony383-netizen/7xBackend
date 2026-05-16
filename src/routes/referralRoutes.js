import express from 'express';
import {
  applyReferralCode,
  myReferralDashboard,
  validateReferralCode,
} from '../controllers/referralController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/validate/:code', validateReferralCode);
router.use(protect);
router.get('/me', myReferralDashboard);
router.post('/apply-code', applyReferralCode);
router.get('/my-invites', myReferralDashboard);
router.get('/rewards', myReferralDashboard);

export default router;
