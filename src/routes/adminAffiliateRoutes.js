import express from 'express';
import {
  approvePeriod,
  calculatePeriod,
  exportAffiliateUsersCsv,
  getAffiliateDetails,
  listAffiliates,
  listFraudFlags,
  listPayouts,
  runAffiliateAutomationNow,
  scanAffiliateFraud,
  updateAffiliateCommission,
  updateAffiliateStatus,
  updateFraudFlagStatus,
  updatePayoutStatus,
} from '../controllers/adminAffiliateController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect, requireAdmin);

router.get('/affiliates', listAffiliates);
router.get('/affiliates/:affiliateId', getAffiliateDetails);
router.get('/affiliates/:affiliateId/users/export.csv', exportAffiliateUsersCsv);
router.patch('/affiliates/:affiliateId/status', updateAffiliateStatus);
router.patch('/affiliates/:affiliateId/commission', updateAffiliateCommission);
router.post('/affiliates/:affiliateId/calculate-period', calculatePeriod);
router.post('/affiliates/:affiliateId/fraud-scan', scanAffiliateFraud);
router.patch('/affiliate-periods/:periodId/approve', approvePeriod);
router.get('/affiliate-payouts', listPayouts);
router.patch('/affiliate-payouts/:payoutId/status', updatePayoutStatus);
router.get('/affiliate-fraud-flags', listFraudFlags);
router.patch('/affiliate-fraud-flags/:flagId/status', updateFraudFlagStatus);
router.post('/affiliate-automation/run', runAffiliateAutomationNow);

export default router;
