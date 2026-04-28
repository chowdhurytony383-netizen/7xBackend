import { Router } from 'express';
import { protect, requireAdmin } from '../middleware/auth.js';
import { agentPaymentUpload } from '../middleware/agentPaymentUpload.js';
import {
  getAgentPaymentMethods,
  updateAgentPaymentMethod,
} from '../controllers/adminAgentPaymentController.js';

const router = Router();

router.get(
  '/agents/:agentId/payment-methods',
  protect,
  requireAdmin,
  getAgentPaymentMethods
);

router.put(
  '/agents/:agentId/payment-methods/:methodKey',
  protect,
  requireAdmin,
  agentPaymentUpload.single('image'),
  updateAgentPaymentMethod
);

export default router;
