import express from 'express';
import {
  approvePeriod,
  calculatePeriod,
  getAffiliateDetails,
  listAffiliates,
  listPayouts,
  updateAffiliateCommission,
  updateAffiliateStatus,
  updatePayoutStatus,
} from '../controllers/adminAffiliateController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect, requireAdmin);

router.get('/affiliates', listAffiliates);
router.get('/affiliates/:affiliateId', getAffiliateDetails);
router.patch('/affiliates/:affiliateId/status', updateAffiliateStatus);
router.patch('/affiliates/:affiliateId/commission', updateAffiliateCommission);
router.post('/affiliates/:affiliateId/calculate-period', calculatePeriod);
router.patch('/affiliate-periods/:periodId/approve', approvePeriod);
router.get('/affiliate-payouts', listPayouts);
router.patch('/affiliate-payouts/:payoutId/status', updatePayoutStatus);

export default router;
