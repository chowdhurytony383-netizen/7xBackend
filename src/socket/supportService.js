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

function buildMessagePreview(message = '', attachments = []) {
  const cleanMessage = String(message || '').trim();
  if (cleanMessage) return cleanMessage.slice(0, 300);

  if (attachments?.length) {
    const count = attachments.length;
    const first = attachments[0]?.originalName || attachments[0]?.name || 'attachment';
    return count === 1 ? `Attachment: ${first}` : `${count} attachments sent`;
  }

  return 'New support message';
}

export async function addSupportMessage({ ticket, sender, senderRole, message = '', attachments = [] }) {
  const cleanMessage = String(message || '').trim();
  const cleanAttachments = Array.isArray(attachments) ? attachments.filter((item) => item?.url) : [];

  const messageDoc = await SupportMessage.create({
    ticket: ticket._id,
    user: sender?._id || sender || ticket.user,
    senderRole,
    message: cleanMessage,
    attachments: cleanAttachments,
    readByUserAt: senderRole === 'user' ? new Date() : undefined,
    readByAdminAt: senderRole === 'admin' ? new Date() : undefined,
  });

  const preview = buildMessagePreview(cleanMessage, cleanAttachments);
  ticket.lastMessage = preview;
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
  const payload = { ticket: freshTicket, message: populatedMessage };

  // Broadcast to both sides so all open tabs/devices update without refresh.
  emitToUser(ticket.user, 'support:message', payload);
  emitToAdmins('support:message', payload);

  if (senderRole === 'user') {
    await createAdminNotification({
      title: `New support message: ${ticket.ticketNo}`,
      message: preview,
      type: 'support',
      actionUrl: `/admin/support?ticket=${ticket._id}`,
      metadata: { ticketId: String(ticket._id), ticketNo: ticket.ticketNo },
      createdBy: sender?._id || sender,
    });
  }

  if (senderRole === 'admin') {
    await createUserNotification({
      user: ticket.user,
      title: `Support reply: ${ticket.ticketNo}`,
      message: preview,
      type: 'support',
      actionUrl: `/support?ticket=${ticket._id}`,
      metadata: { ticketId: String(ticket._id), ticketNo: ticket.ticketNo },
      createdBy: sender?._id || sender,
    });
  }

  return { ticket: freshTicket, message: populatedMessage };
}
