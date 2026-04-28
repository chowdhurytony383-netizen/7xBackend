import { Router } from 'express';
import { protectAgent } from '../middleware/agentAuth.js';
import {
  confirmAgentRequest,
  listMyAgentRequests,
  rejectAgentRequest,
} from '../controllers/agentRequestController.js';

const router = Router();

router.get('/requests', protectAgent, listMyAgentRequests);
router.post('/requests/:requestId/confirm', protectAgent, confirmAgentRequest);
router.post('/requests/:requestId/reject', protectAgent, rejectAgentRequest);

export default router;
