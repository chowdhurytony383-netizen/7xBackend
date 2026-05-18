import mongoose from 'mongoose';

const supportMessageSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  senderRole: { type: String, enum: ['user', 'admin', 'system'], required: true, index: true },
  message: { type: String, trim: true, required: true },
  attachments: [{
    name: { type: String, trim: true, default: '' },
    url: { type: String, trim: true, default: '' },
    type: { type: String, trim: true, default: '' },
  }],
  readByUserAt: Date,
  readByAdminAt: Date,
}, { timestamps: true });

supportMessageSchema.index({ ticket: 1, createdAt: 1 });

export default mongoose.models.SupportMessage || mongoose.model('SupportMessage', supportMessageSchema);
