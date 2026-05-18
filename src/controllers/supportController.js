import path from 'path';
import SupportMessage from '../models/SupportMessage.js';
import SupportTicket from '../models/SupportTicket.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { saveUploadedFile } from '../utils/cloudinary.js';
import { addSupportMessage } from '../services/supportService.js';

const allowedCategories = new Set(['general', 'deposit', 'withdraw', 'bonus', 'game', 'affiliate', 'account', 'technical', 'other']);
const allowedPriorities = new Set(['low', 'normal', 'high', 'urgent']);
const allowedStatuses = new Set(['open', 'pending', 'resolved', 'closed']);

function sanitizeText(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function flattenUploadedFiles(files) {
  if (!files) return [];
  if (Array.isArray(files)) return files;
  return Object.values(files).flat().filter(Boolean);
}

function safeFileName(value = 'support-file') {
  return String(value || 'support-file')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'support-file';
}

async function buildSupportAttachments(req) {
  const files = flattenUploadedFiles(req.files).slice(0, 5);
  if (!files.length) return [];

  const attachments = [];
  for (const file of files) {
    const url = await saveUploadedFile(file, {
      req,
      localSubDir: 'support',
      cloudinaryFolder: '7xbet/support',
      publicIdPrefix: `support-${safeFileName(file.originalname)}`,
      resourceType: 'auto',
    });

    const originalName = file.originalname || 'attachment';
    attachments.push({
      name: path.basename(originalName),
      originalName,
      url,
      type: file.mimetype || '',
      mimeType: file.mimetype || '',
      size: Number(file.size || 0),
      isImage: String(file.mimetype || '').startsWith('image/'),
    });
  }

  return attachments;
}

function requireMessageOrAttachment(message, attachments) {
  if (!message && !attachments.length) {
    throw new AppError('Message or attachment is required', 400);
  }
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
  const attachments = await buildSupportAttachments(req);

  if (!subject) throw new AppError('Subject is required', 400);
  requireMessageOrAttachment(message, attachments);

  const preview = message || (attachments.length === 1 ? `Attachment: ${attachments[0].originalName || attachments[0].name}` : `${attachments.length} attachments sent`);

  const ticket = await SupportTicket.create({
    user: req.user._id,
    subject,
    category,
    priority,
    status: 'open',
    lastMessage: preview.slice(0, 300),
    lastMessageAt: new Date(),
    lastMessageBy: 'user',
    unreadForAdmin: 1,
  });

  const result = await addSupportMessage({ ticket, sender: req.user, senderRole: 'user', message, attachments });
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
  const attachments = await buildSupportAttachments(req);
  requireMessageOrAttachment(message, attachments);

  const ticket = await SupportTicket.findOne({ _id: req.params.ticketId, user: req.user._id });
  if (!ticket) throw new AppError('Support ticket not found', 404);
  if (ticket.status === 'closed') ticket.status = 'open';

  const result = await addSupportMessage({ ticket, sender: req.user, senderRole: 'user', message, attachments });
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
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { ticketNo: new RegExp(safeSearch, 'i') },
      { subject: new RegExp(safeSearch, 'i') },
      { lastMessage: new RegExp(safeSearch, 'i') },
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
  const attachments = await buildSupportAttachments(req);
  requireMessageOrAttachment(message, attachments);

  const ticket = await SupportTicket.findById(req.params.ticketId);
  if (!ticket) throw new AppError('Support ticket not found', 404);

  if (req.body?.status && allowedStatuses.has(req.body.status)) ticket.status = req.body.status;
  else if (ticket.status === 'open') ticket.status = 'pending';

  const result = await addSupportMessage({ ticket, sender: req.user, senderRole: 'admin', message, attachments });
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
