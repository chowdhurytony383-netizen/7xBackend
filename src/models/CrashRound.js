import mongoose from 'mongoose';

const crashRoundSchema = new mongoose.Schema({
  roundId: { type: String, required: true, unique: true, index: true },
  nonce: { type: Number, default: 0 },
  serverSeed: { type: String, required: true, select: false },
  serverSeedHash: { type: String, required: true },
  status: { type: String, enum: ['WAITING', 'RUNNING', 'CRASHED'], default: 'WAITING', index: true },
  startsAt: { type: Date, required: true, index: true },
  crashAt: { type: Date, required: true },
  crashedAt: { type: Date },
  crashMultiplier: { type: Number, required: true, min: 1 },
  totalBets: { type: Number, default: 0 },
  totalBetAmount: { type: Number, default: 0 },
  totalPayoutAmount: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.models.CrashRound || mongoose.model('CrashRound', crashRoundSchema);
