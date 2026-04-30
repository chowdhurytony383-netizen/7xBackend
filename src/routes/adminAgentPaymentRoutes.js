import { Router } from 'express';
import { protect, requireAdmin } from '../middleware/auth.js';
import { agentPaymentUpload } from '../middleware/agentPaymentUpload.js';
import {
  getAgentPaymentMethodAccess,
  getAgentPaymentMethods,
  updateAgentPaymentMethod,
  updateAgentPaymentMethodAccess,
} from '../controllers/adminAgentPaymentController.js';

const router = Router();

router.get(
  '/agents/:agentId/payment-method-access',
  protect,
  requireAdmin,
  getAgentPaymentMethodAccess
);

router.put(
  '/agents/:agentId/payment-method-access',
  protect,
  requireAdmin,
  updateAgentPaymentMethodAccess
);

// Backward-compatible old admin routes.
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
