import { Router } from 'express';
import { protect, requireAdmin } from '../middleware/auth.js';
import { listAllAgentRequestsForAdmin } from '../controllers/agentRequestController.js';

const router = Router();

router.get('/agent-payment-requests', protect, requireAdmin, listAllAgentRequestsForAdmin);

export default router;
