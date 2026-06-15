import mongoose from 'mongoose';

const pgsoftTransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    traceId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['BET_PAYOUT', 'ADJUSTMENT'],
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    playerName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    operatorPlayerSession: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
      index: true,
    },
    gameId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    parentBetId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    betId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    betAmount: {
      type: Number,
      default: 0,
    },
    winAmount: {
      type: Number,
      default: 0,
    },
    transferAmount: {
      type: Number,
      default: 0,
    },
    realTransferAmount: {
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
    updatedTime: {
      type: Number,
      default: 0,
      index: true,
    },
    createTime: {
      type: Number,
      default: 0,
    },
    betEndTime: {
      type: Number,
      default: 0,
    },
    transactionType: {
      type: String,
      default: '',
      trim: true,
    },
    walletType: {
      type: String,
      default: '',
      trim: true,
    },
    isValidateBet: {
      type: Boolean,
      default: false,
    },
    isAdjustment: {
      type: Boolean,
      default: false,
    },
    requestPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    responsePayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['processing', 'success', 'failed'],
      default: 'processing',
      index: true,
    },
    attempts: {
      type: Number,
      default: 1,
    },
    errorCode: {
      type: String,
      default: '',
      trim: true,
    },
    errorMessage: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

pgsoftTransactionSchema.index({ user: 1, createdAt: -1 });
pgsoftTransactionSchema.index({ playerName: 1, createdAt: -1 });
pgsoftTransactionSchema.index({ parentBetId: 1, betId: 1 });

export default mongoose.models.PgsoftTransaction || mongoose.model('PgsoftTransaction', pgsoftTransactionSchema);
