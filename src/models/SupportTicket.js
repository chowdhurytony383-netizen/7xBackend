import mongoose from 'mongoose';

const supportTicketSchema = new mongoose.Schema({
  ticketNo: { type: String, trim: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subject: { type: String, trim: true, required: true },
  category: {
    type: String,
    enum: ['general', 'deposit', 'withdraw', 'bonus', 'game', 'affiliate', 'account', 'technical', 'other'],
    default: 'general',
    index: true,
  },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true },
  status: { type: String, enum: ['open', 'pending', 'resolved', 'closed'], default: 'open', index: true },
  lastMessage: { type: String, trim: true, default: '' },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  lastMessageBy: { type: String, enum: ['user', 'admin', 'system'], default: 'user' },
  unreadForUser: { type: Number, default: 0, min: 0 },
  unreadForAdmin: { type: Number, default: 0, min: 0 },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: Date,
  closedAt: Date,
}, { timestamps: true });

supportTicketSchema.index({ user: 1, status: 1, lastMessageAt: -1 });
supportTicketSchema.index({ status: 1, lastMessageAt: -1 });

supportTicketSchema.pre('validate', function setTicketNo(next) {
  if (!this.ticketNo) {
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    this.ticketNo = `SUP-${stamp}-${rand}`;
  }
  next();
});

export default mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);
