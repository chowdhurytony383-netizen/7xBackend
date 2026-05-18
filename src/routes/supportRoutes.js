import express from 'express';
import {
  createSupportTicket,
  getMySupportTicket,
  listMySupportTickets,
  sendMySupportMessage,
  updateMySupportTicketStatus,
} from '../controllers/supportController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/', listMySupportTickets);
router.post('/', createSupportTicket);
router.get('/:ticketId', getMySupportTicket);
router.post('/:ticketId/messages', sendMySupportMessage);
router.patch('/:ticketId/status', updateMySupportTicketStatus);

export default router;
