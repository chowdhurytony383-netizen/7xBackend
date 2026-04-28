import { Router } from 'express';
import { protectAgent } from '../middleware/agentAuth.js';
import { agentPaymentUpload } from '../middleware/agentPaymentUpload.js';
import {
  getAgentPaymentMethodsById,
  getMyPaymentMethods,
  updateMyPaymentMethod,
} from '../controllers/agentPaymentController.js';

const router = Router();

router.get('/payment-methods', protectAgent, getMyPaymentMethods);
router.put('/payment-methods/:methodKey', protectAgent, agentPaymentUpload.single('image'), updateMyPaymentMethod);

// Backward-compatible read-only preview route.
router.get('/:agentId/payment-methods', getAgentPaymentMethodsById);

export default router;
