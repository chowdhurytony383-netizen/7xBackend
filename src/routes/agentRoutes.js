import express from 'express';
import { agentLogin, agentLogout, agentMe, myAgentTransactions } from '../controllers/agentController.js';
import { protectAgent } from '../middleware/agentAuth.js';

const router = express.Router();

router.post('/login', agentLogin);
router.post('/logout', agentLogout);
router.get('/me', protectAgent, agentMe);
router.get('/transactions', protectAgent, myAgentTransactions);

export default router;
