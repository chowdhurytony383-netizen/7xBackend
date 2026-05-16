import mongoose from 'mongoose';

const affiliateAutomationRunSchema = new mongoose.Schema({
  runKey: { type: String, required: true, unique: true, index: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running', index: true },
  affiliatesProcessed: { type: Number, default: 0 },
  periodsCalculated: { type: Number, default: 0 },
  payoutsPaid: { type: Number, default: 0 },
  payoutAmount: { type: Number, default: 0 },
  heldAffiliates: { type: Number, default: 0 },
  errorMessage: { type: String, trim: true, default: '' },
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
}, { timestamps: true });

export default mongoose.models.AffiliateAutomationRun || mongoose.model('AffiliateAutomationRun', affiliateAutomationRunSchema);
