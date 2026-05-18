import SupportMessage from '../models/SupportMessage.js';
import SupportTicket from '../models/SupportTicket.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { addSupportMessage, getTicketWithUser } from '../services/supportService.js';

const allowedCategories = new Set(['general', 'deposit', 'withdraw', 'bonus', 'game', 'affiliate', 'account', 'technical', 'other']);
const allowedPriorities = new Set(['low', 'normal', 'high', 'urgent']);
const allowedStatuses = new Set(['open', 'pending', 'resolved', 'closed']);

function sanitizeText(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

export const listMySupportTickets = asyncHandler(async (req, res) => {
  const query = { user: req.user._id };
  if (req.query.status && allowedStatuses.has(req.query.status)) query.status = req.query.status;
  const tickets = await SupportTicket.find(query).sort({ lastMessageAt: -1, createdAt: -1 }).lean();
  res.json({ success: true, data: tickets });
});

export const createSupportTicket = asyncHandler(async (req, res) => {
  const subject = sanitizeText(req.body?.subject, 160);
  const message = sanitizeText(req.body?.message, 4000);
  const category = allowedCategories.has(req.body?.category) ? req.body.category : 'general';
  const priority = allowedPriorities.has(req.body?.priority) ? req.body.priority : 'normal';

  if (!subject) throw new AppError('Subject is required', 400);
  if (!message) throw new AppError('Message is required', 400);

  const ticket = await SupportTicket.create({
    user: req.user._id,
    subject,
    category,
    priority,
    status: 'open',
    lastMessage: message.slice(0, 300),
    lastMessageAt: new Date(),
    lastMessageBy: 'user',
    unreadForAdmin: 1,
  });

  const result = await addSupportMessage({ ticket, sender: req.user, senderRole: 'user', message });
  res.status(201).json({ success: true, data: result.ticket });
});

export const getMySupportTicket = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findOne({ _id: req.params.ticketId, user: req.user._id })
    .populate('user', 'userId fullName name email phone currency country')
    .populate('assignedTo', 'userId fullName name email');
  if (!ticket) throw new AppError('Support ticket not found', 404);

  ticket.unreadForUser = 0;
  await ticket.save();
  await SupportMessage.updateMany({ ticket: ticket._id, senderRole: 'admin', readByUserAt: null }, { $set: { readByUserAt: new Date() } });

  const messages = await SupportMessage.find({ ticket: ticket._id }).sort({ createdAt: 1 }).populate('user', 'userId fullName name email role').lean();
  res.json({ success: true, data: { ticket: ticket.toObject(), messages } });
});

export const sendMySupportMessage = asyncHandler(async (req, res) => {
  const message = sanitizeText(req.body?.message, 4000);
  if (!message) throw new AppError('Message is required', 400);

  const ticket = await SupportTicket.findOne({ _id: req.params.ticketId, user: req.user._id });
  if (!ticket) throw new AppError('Support ticket not found', 404);
  if (ticket.status === 'closed') ticket.status = 'open';

  const result = await addSupportMessage({ ticket, sender: req.user, senderRole: 'user', message });
  res.status(201).json({ success: true, data: result });
});

export const updateMySupportTicketStatus = asyncHandler(async (req, res) => {
  const nextStatus = req.body?.status;
  if (!['resolved', 'closed', 'open'].includes(nextStatus)) throw new AppError('Invalid support status', 400);
  const update = { status: nextStatus };
  if (nextStatus === 'resolved') update.resolvedAt = new Date();
  if (nextStatus === 'closed') update.closedAt = new Date();

  const ticket = await SupportTicket.findOneAndUpdate({ _id: req.params.ticketId, user: req.user._id }, { $set: update }, { new: true }).lean();
  if (!ticket) throw new AppError('Support ticket not found', 404);
  res.json({ success: true, data: ticket });
});

export const adminListSupportTickets = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status && allowedStatuses.has(req.query.status)) query.status = req.query.status;
  if (req.query.category && allowedCategories.has(req.query.category)) query.category = req.query.category;

  const search = sanitizeText(req.query.q, 100);
  if (search) {
    query.$or = [
      { ticketNo: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { subject: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { lastMessage: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];
  }

  const tickets = await SupportTicket.find(query)
    .sort({ unreadForAdmin: -1, lastMessageAt: -1, createdAt: -1 })
    .limit(Math.min(200, Number(req.query.limit || 100)))
    .populate('user', 'userId fullName name email phone currency country wallet status')
    .populate('assignedTo', 'userId fullName name email')
    .lean();

  res.json({ success: true, data: tickets });
});

export const adminGetSupportTicket = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.ticketId)
    .populate('user', 'userId fullName name email phone currency country wallet status')
    .populate('assignedTo', 'userId fullName name email');
  if (!ticket) throw new AppError('Support ticket not found', 404);

  ticket.unreadForAdmin = 0;
  await ticket.save();
  await SupportMessage.updateMany({ ticket: ticket._id, senderRole: 'user', readByAdminAt: null }, { $set: { readByAdminAt: new Date() } });

  const messages = await SupportMessage.find({ ticket: ticket._id }).sort({ createdAt: 1 }).populate('user', 'userId fullName name email role').lean();
  res.json({ success: true, data: { ticket: ticket.toObject(), messages } });
});

export const adminSendSupportMessage = asyncHandler(async (req, res) => {
  const message = sanitizeText(req.body?.message, 4000);
  if (!message) throw new AppError('Message is required', 400);

  const ticket = await SupportTicket.findById(req.params.ticketId);
  if (!ticket) throw new AppError('Support ticket not found', 404);

  if (req.body?.status && allowedStatuses.has(req.body.status)) ticket.status = req.body.status;
  else if (ticket.status === 'open') ticket.status = 'pending';

  const result = await addSupportMessage({ ticket, sender: req.user, senderRole: 'admin', message });
  res.status(201).json({ success: true, data: result });
});

export const adminUpdateSupportTicketStatus = asyncHandler(async (req, res) => {
  const nextStatus = req.body?.status;
  if (!allowedStatuses.has(nextStatus)) throw new AppError('Invalid support status', 400);
  const update = { status: nextStatus };
  if (nextStatus === 'resolved') update.resolvedAt = new Date();
  if (nextStatus === 'closed') update.closedAt = new Date();
  if (req.body?.assignToMe) update.assignedTo = req.user._id;

  const ticket = await SupportTicket.findByIdAndUpdate(req.params.ticketId, { $set: update }, { new: true })
    .populate('user', 'userId fullName name email phone currency country wallet status')
    .populate('assignedTo', 'userId fullName name email')
    .lean();
  if (!ticket) throw new AppError('Support ticket not found', 404);
  res.json({ success: true, data: ticket });
});
