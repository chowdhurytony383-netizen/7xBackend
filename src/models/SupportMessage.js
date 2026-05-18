import mongoose from 'mongoose';

const supportAttachmentSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '' },
  originalName: { type: String, trim: true, default: '' },
  url: { type: String, trim: true, default: '' },
  type: { type: String, trim: true, default: '' },
  mimeType: { type: String, trim: true, default: '' },
  size: { type: Number, default: 0 },
  isImage: { type: Boolean, default: false },
}, { _id: false });

const supportMessageSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  senderRole: { type: String, enum: ['user', 'admin', 'system'], required: true, index: true },
  message: { type: String, trim: true, default: '' },
  attachments: { type: [supportAttachmentSchema], default: [] },
  readByUserAt: Date,
  readByAdminAt: Date,
}, { timestamps: true });

supportMessageSchema.index({ ticket: 1, createdAt: 1 });

export default mongoose.models.SupportMessage || mongoose.model('SupportMessage', supportMessageSchema);
