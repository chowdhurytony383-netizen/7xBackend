import mongoose from 'mongoose';

const jiliTransactionSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['bet', 'cancelBet', 'sessionBet', 'cancelSessionBet'],
      required: true,
      index: true,
    },
    reqId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    token: {
      type: String,
      default: '',
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    username: {
      type: String,
      default: '',
      index: true,
    },
    currency: {
      type: String,
      default: 'BDT',
      uppercase: true,
    },
    game: {
      type: Number,
      default: 0,
      index: true,
    },
    round: {
      type: String,
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      default: '',
      index: true,
    },
    sessionType: {
      type: Number,
      default: 0,
      index: true,
    },
    betAmount: {
      type: Number,
      default: 0,
    },
    winloseAmount: {
      type: Number,
      default: 0,
    },
    turnoverAmount: {
      type: Number,
      default: 0,
    },
    preserve: {
      type: Number,
      default: 0,
    },
    walletDelta: {
      type: Number,
      default: 0,
    },
    balanceBefore: {
      type: Number,
      default: 0,
    },
    balanceAfter: {
      type: Number,
      default: 0,
    },
    originalRound: {
      type: String,
      default: '',
      index: true,
    },
    txId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['accepted', 'cancelled', 'failed'],
      default: 'accepted',
      index: true,
    },
    rawRequest: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    response: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    errorCode: {
      type: Number,
      default: 0,
      index: true,
    },
    message: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

jiliTransactionSchema.index({ action: 1, round: 1 }, { unique: true });
jiliTransactionSchema.index({ action: 1, reqId: 1 }, { unique: true });
jiliTransactionSchema.index({ user: 1, createdAt: -1 });
jiliTransactionSchema.index({ username: 1, createdAt: -1 });
jiliTransactionSchema.index({ action: 1, status: 1, createdAt: -1 });

export default mongoose.models.JiliTransaction || mongoose.model('JiliTransaction', jiliTransactionSchema);
