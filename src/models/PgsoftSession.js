import mongoose from 'mongoose';

const pgsoftSessionSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    playerName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    nickname: {
      type: String,
      default: '',
      trim: true,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
    },
    gameId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    language: {
      type: String,
      default: 'en',
      trim: true,
    },
    ip: {
      type: String,
      default: '',
    },
    userAgent: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'revoked'],
      default: 'active',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastVerifiedAt: Date,
    lastUsedAt: Date,
  },
  { timestamps: true }
);

pgsoftSessionSchema.index({ playerName: 1, status: 1 });
pgsoftSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.PgsoftSession || mongoose.model('PgsoftSession', pgsoftSessionSchema);
