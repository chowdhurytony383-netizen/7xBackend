import mongoose from 'mongoose';

const turnoverRequirementSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['deposit', 'bonus'], default: 'deposit', index: true },
  source: { type: String, default: '', index: true },
  sourceRef: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  amount: { type: Number, required: true, min: 0 },
  requiredWager: { type: Number, required: true, min: 0 },
  wagered: { type: Number, default: 0, min: 0 },
  remaining: { type: Number, required: true, min: 0, index: true },
  status: { type: String, enum: ['open', 'completed', 'cancelled'], default: 'open', index: true },
  completedAt: Date,
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

turnoverRequirementSchema.index({ user: 1, status: 1, createdAt: 1 });
turnoverRequirementSchema.index({ user: 1, sourceRef: 1 }, { sparse: true });

export default mongoose.models.TurnoverRequirement || mongoose.model('TurnoverRequirement', turnoverRequirementSchema);
