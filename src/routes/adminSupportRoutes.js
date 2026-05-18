import express from 'express';
import {
  adminGetSupportTicket,
  adminListSupportTickets,
  adminSendSupportMessage,
  adminUpdateSupportTicketStatus,
} from '../controllers/supportController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect, requireAdmin);

router.get('/support', adminListSupportTickets);
router.get('/support/:ticketId', adminGetSupportTicket);
router.post('/support/:ticketId/messages', adminSendSupportMessage);
router.patch('/support/:ticketId/status', adminUpdateSupportTicketStatus);

export default router;
