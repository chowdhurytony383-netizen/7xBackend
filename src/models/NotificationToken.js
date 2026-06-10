import mongoose from 'mongoose';

const notificationTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ['web'],
      default: 'web',
      index: true,
    },
    permission: {
      type: String,
      default: 'granted',
    },
    userAgent: {
      type: String,
      default: '',
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastLuckyWheelReadySentAt: {
      type: Date,
      default: null,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

notificationTokenSchema.index({ user: 1, isActive: 1 });

export default mongoose.models.NotificationToken || mongoose.model('NotificationToken', notificationTokenSchema);
