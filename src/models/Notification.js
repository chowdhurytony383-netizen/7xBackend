import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  audience: { type: String, enum: ['user', 'admin', 'all'], default: 'user', index: true },
  type: {
    type: String,
    enum: ['system', 'support', 'deposit', 'withdraw', 'bonus', 'affiliate', 'security', 'admin'],
    default: 'system',
    index: true,
  },
  title: { type: String, trim: true, required: true },
  message: { type: String, trim: true, default: '' },
  actionUrl: { type: String, trim: true, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  readAt: { type: Date, default: null, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ audience: 1, readAt: 1, createdAt: -1 });

export default mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
