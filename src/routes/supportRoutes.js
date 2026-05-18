import express from 'express';
import {
  createSupportTicket,
  getMySupportTicket,
  listMySupportTickets,
  sendMySupportMessage,
  updateMySupportTicketStatus,
} from '../controllers/supportController.js';
import { protect } from '../middleware/auth.js';
import { supportAttachmentUpload } from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

router.get('/', listMySupportTickets);
router.post('/', supportAttachmentUpload, createSupportTicket);
router.get('/:ticketId', getMySupportTicket);
router.post('/:ticketId/messages', supportAttachmentUpload, sendMySupportMessage);
router.patch('/:ticketId/status', updateMySupportTicketStatus);

export default router;
