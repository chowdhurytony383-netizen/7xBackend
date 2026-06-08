import mongoose from 'mongoose';

const freeSpinHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'FreeSpinAccount', required: true, index: true },
  resultKey: {
    type: String,
    enum: ['ZERO', 'BOMB', 'EXTRA_SPINS', 'CASH_3', 'CASH_5', 'CASH_10', 'CASH_15', 'CASH_20', 'CASH_30', 'CASH_60'],
    required: true,
    index: true,
  },
  label: { type: String, required: true },
  segmentId: { type: String, default: '' },
  segmentIndex: { type: Number, default: 0 },
  amount: { type: Number, default: 0, min: 0 },
  extraSpinsAwarded: { type: Number, default: 0, min: 0 },
  rewardCredited: { type: Boolean, default: false },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  walletAfter: { type: Number, default: 0, min: 0 },
  spinsRemainingAfter: { type: Number, default: 0, min: 0 },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, { timestamps: true });

freeSpinHistorySchema.index({ user: 1, createdAt: -1 });

export default mongoose.models.FreeSpinHistory || mongoose.model('FreeSpinHistory', freeSpinHistorySchema);
