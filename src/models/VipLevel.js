import mongoose from 'mongoose';

const vipLevelSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  minMonthlyTurnover: { type: Number, required: true, min: 0, default: 0 },
  cashbackRate: { type: Number, required: true, min: 0, default: 0 }, // Decimal: 0.004 = 0.40%
  unlockBonus: { type: Number, default: 0, min: 0 },
  turnoverMultiplier: { type: Number, default: 1, min: 0 },
  benefits: { type: [String], default: [] },
  color: { type: String, trim: true, default: '' },
  sortOrder: { type: Number, default: 0, index: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

vipLevelSchema.index({ isActive: 1, minMonthlyTurnover: 1 });

export default mongoose.models.VipLevel || mongoose.model('VipLevel', vipLevelSchema);
