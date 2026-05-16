import mongoose from 'mongoose';

const affiliateFraudFlagSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePartner', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  periodStart: { type: Date, index: true },
  periodEnd: { type: Date, index: true },
  type: { type: String, trim: true, required: true, index: true },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
  status: { type: String, enum: ['open', 'reviewed', 'cleared', 'confirmed'], default: 'open', index: true },
  message: { type: String, trim: true, default: '' },
  metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
  autoHoldPayout: { type: Boolean, default: false, index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  adminNote: { type: String, trim: true, default: '' },
}, { timestamps: true });

affiliateFraudFlagSchema.index({ affiliate: 1, type: 1, periodStart: 1, periodEnd: 1 }, { unique: true, sparse: true });
affiliateFraudFlagSchema.index({ affiliate: 1, status: 1, severity: 1 });

export default mongoose.models.AffiliateFraudFlag || mongoose.model('AffiliateFraudFlag', affiliateFraudFlagSchema);
