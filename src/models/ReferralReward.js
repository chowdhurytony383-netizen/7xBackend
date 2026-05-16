import mongoose from 'mongoose';

const referralRewardSchema = new mongoose.Schema({
  referrerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  referredByCode: { type: String, trim: true, uppercase: true, default: '', index: true },
  depositTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true, unique: true },
  depositAmount: { type: Number, required: true, min: 0 },
  rewardAmount: { type: Number, required: true, min: 0 },
  rewardCurrency: { type: String, trim: true, uppercase: true, default: 'BDT' },
  requiredTurnover: { type: Number, default: 0, min: 0 },
  completedTurnover: { type: Number, default: 0, min: 0 },
  status: {
    type: String,
    enum: ['pending', 'qualified', 'credited', 'cancelled'],
    default: 'pending',
    index: true,
  },
  creditedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  creditedAt: Date,
  cancelledAt: Date,
  note: { type: String, trim: true, default: '' },
}, { timestamps: true });

referralRewardSchema.index({ referrerUser: 1, createdAt: -1 });
referralRewardSchema.index({ referredUser: 1, status: 1 });

export default mongoose.models.ReferralReward || mongoose.model('ReferralReward', referralRewardSchema);
