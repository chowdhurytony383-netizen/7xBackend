import express from 'express';
import {
  applyAffiliate,
  ensureMyInviteCode,
  listMyAffiliateUsers,
  myAffiliateDashboard,
  requestAffiliatePayout,
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
router.post('/payout-request', requestAffiliatePayout);
router.get('/my-invite-code', ensureMyInviteCode);

export default router;
