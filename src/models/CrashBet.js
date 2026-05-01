import mongoose from 'mongoose';

const crashBetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  round: { type: mongoose.Schema.Types.ObjectId, ref: 'CrashRound', required: true, index: true },
  roundId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, min: 1 },
  autoCashout: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['ACTIVE', 'CASHED_OUT', 'LOST', 'CANCELLED'], default: 'ACTIVE', index: true },
  payoutMultiplier: { type: Number, default: 0 },
  payoutAmount: { type: Number, default: 0 },
  cashedOutAt: { type: Date },
  crashMultiplier: { type: Number, default: 0 },
}, { timestamps: true });

crashBetSchema.index({ user: 1, round: 1 }, { unique: true });

export default mongoose.models.CrashBet || mongoose.model('CrashBet', crashBetSchema);
