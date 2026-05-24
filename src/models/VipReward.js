import mongoose from 'mongoose';

const vipRewardSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  periodKey: { type: String, required: true, trim: true, index: true }, // YYYY-MM
  periodStart: { type: Date, required: true, index: true },
  periodEnd: { type: Date, required: true, index: true },
  levelKey: { type: String, trim: true, default: '', index: true },
  levelName: { type: String, trim: true, default: '' },
  monthlyTurnover: { type: Number, default: 0, min: 0 },
  monthlyWinAmount: { type: Number, default: 0, min: 0 },
  monthlyNetLoss: { type: Number, default: 0, min: 0 },
  cashbackRate: { type: Number, default: 0, min: 0 },
  cashbackAmount: { type: Number, default: 0, min: 0 },
  unlockBonusAmount: { type: Number, default: 0, min: 0 },
  rewardAmount: { type: Number, default: 0, min: 0 },
  requiredTurnover: { type: Number, default: 0, min: 0 },
  currency: { type: String, trim: true, uppercase: true, default: 'BDT' },
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CLAIMED', 'CANCELLED'],
    default: 'PENDING_APPROVAL',
    index: true,
  },
  calculatedAt: Date,
  approvedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedAt: Date,
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedReason: { type: String, default: '' },
  claimedAt: Date,
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  turnoverRequirement: { type: mongoose.Schema.Types.ObjectId, ref: 'TurnoverRequirement' },
  adminNote: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

vipRewardSchema.index({ user: 1, periodKey: 1 }, { unique: true });
vipRewardSchema.index({ status: 1, periodKey: -1 });

export default mongoose.models.VipReward || mongoose.model('VipReward', vipRewardSchema);
