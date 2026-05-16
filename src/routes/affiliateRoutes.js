import express from 'express';
import {
  applyAffiliate,
  ensureMyInviteCode,
  exportMyAffiliatePeriodsCsv,
  exportMyAffiliateUsersCsv,
  listMyAffiliateUsers,
  myAffiliateDashboard,
  requestAffiliatePayout,
  scanMyAffiliateFraud,
  trackAffiliateClick,
  validateAffiliateCode,
} from '../controllers/affiliateController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/validate/:code', validateAffiliateCode);
router.post('/track-click/:code', trackAffiliateClick);
router.get('/track-click/:code', trackAffiliateClick);

router.use(protect);
router.post('/apply', applyAffiliate);
router.get('/dashboard', myAffiliateDashboard);
router.get('/users', listMyAffiliateUsers);
router.get('/users/export.csv', exportMyAffiliateUsersCsv);
router.get('/periods/export.csv', exportMyAffiliatePeriodsCsv);
router.post('/payout-request', requestAffiliatePayout);
router.post('/fraud-scan', scanMyAffiliateFraud);
router.get('/my-invite-code', ensureMyInviteCode);

export default router;
