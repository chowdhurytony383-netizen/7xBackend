import express from 'express';
import {
  deposits,
  games,
  overview,
  transactions,
  updateDepositStatus,
  updateGame,
  updateUser,
  updateUserStatus,
  updateUserVerification,
  updateWithdrawalStatus,
  userDetails,
  users,
  withdrawals,
} from '../controllers/adminController.js';
import { agentTransactions, createAgent, listAgents, topUpAgent, updateAgentStatus } from '../controllers/agentController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect, requireAdmin);
router.get('/overview', overview);
router.get('/users', users);
router.get('/users/:userId', userDetails);
router.patch('/users/:userId', updateUser);
router.patch('/users/:userId/status', updateUserStatus);
router.patch('/users/:userId/verification', updateUserVerification);
router.get('/deposits', deposits);
router.patch('/deposits/:transactionId/status', updateDepositStatus);
router.get('/withdrawals', withdrawals);
router.patch('/withdrawals/:transactionId/status', updateWithdrawalStatus);
router.get('/transactions', transactions);
router.get('/games', games);
router.patch('/games/:gameId', updateGame);

router.get('/agents', listAgents);
router.post('/agents', createAgent);
router.patch('/agents/:agentId/status', updateAgentStatus);
router.post('/agents/top-up', topUpAgent);
router.get('/agents/:agentId/transactions', agentTransactions);
router.get('/agent-transactions', agentTransactions);

export default router;
