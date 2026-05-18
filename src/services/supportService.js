import SupportMessage from '../models/SupportMessage.js';
import SupportTicket from '../models/SupportTicket.js';
import { emitToAdmins, emitToUser } from '../socket/index.js';
import { createAdminNotification, createUserNotification } from './notificationService.js';

export function serializeTicket(ticket) {
  if (!ticket) return null;
  return typeof ticket.toObject === 'function' ? ticket.toObject() : ticket;
}

export async function getTicketWithUser(ticketId) {
  return SupportTicket.findById(ticketId)
    .populate('user', 'userId fullName name email phone currency country')
    .populate('assignedTo', 'userId fullName name email')
    .lean();
}

export async function addSupportMessage({ ticket, sender, senderRole, message, attachments = [] }) {
  const messageDoc = await SupportMessage.create({
    ticket: ticket._id,
    user: sender?._id || sender || ticket.user,
    senderRole,
    message,
    attachments,
    readByUserAt: senderRole === 'user' ? new Date() : undefined,
    readByAdminAt: senderRole === 'admin' ? new Date() : undefined,
  });

  ticket.lastMessage = message.slice(0, 300);
  ticket.lastMessageAt = new Date();
  ticket.lastMessageBy = senderRole;

  if (senderRole === 'user') {
    ticket.unreadForAdmin = Number(ticket.unreadForAdmin || 0) + 1;
    if (ticket.status === 'closed' || ticket.status === 'resolved') ticket.status = 'open';
  }

  if (senderRole === 'admin') {
    ticket.unreadForUser = Number(ticket.unreadForUser || 0) + 1;
    if (ticket.status === 'closed') ticket.status = 'pending';
  }

  await ticket.save();

  const populatedMessage = await SupportMessage.findById(messageDoc._id)
    .populate('user', 'userId fullName name email role')
    .lean();

  const freshTicket = await getTicketWithUser(ticket._id);

  if (senderRole === 'user') {
    emitToAdmins('support:message', { ticket: freshTicket, message: populatedMessage });
    await createAdminNotification({
      title: `New support message: ${ticket.ticketNo}`,
      message: ticket.lastMessage,
      type: 'support',
      actionUrl: `/admin/support?ticket=${ticket._id}`,
      metadata: { ticketId: String(ticket._id), ticketNo: ticket.ticketNo },
      createdBy: sender?._id || sender,
    });
  }

  if (senderRole === 'admin') {
    emitToUser(ticket.user, 'support:message', { ticket: freshTicket, message: populatedMessage });
    await createUserNotification({
      user: ticket.user,
      title: `Support reply: ${ticket.ticketNo}`,
      message: ticket.lastMessage,
      type: 'support',
      actionUrl: `/support?ticket=${ticket._id}`,
      metadata: { ticketId: String(ticket._id), ticketNo: ticket.ticketNo },
      createdBy: sender?._id || sender,
    });
  }

  return { ticket: freshTicket, message: populatedMessage };
}
