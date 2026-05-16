import mongoose from 'mongoose';

const affiliatePayoutSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePartner', required: true, index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  periods: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePeriod' }],
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, trim: true, uppercase: true, default: 'BDT' },
  minimumPayoutUsd: { type: Number, default: 30 },
  minimumPayoutLocal: { type: Number, default: 0 },
  usdToCurrencyRate: { type: Number, default: 0 },
  payoutWeekKey: { type: String, trim: true, default: '', index: true },
  payoutType: { type: String, enum: ['manual_request', 'automatic_weekly'], default: 'manual_request', index: true },
  destination: { type: String, enum: ['internal_wallet', 'external_method'], default: 'internal_wallet' },
  autoTransfer: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'rejected', 'cancelled'],
    default: 'pending',
    index: true,
  },
  payoutMethod: { type: mongoose.Schema.Types.Mixed, default: {} },
  affiliateNote: { type: String, trim: true, default: '' },
  adminNote: { type: String, trim: true, default: '' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidAt: Date,
  paidTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  failureReason: { type: String, trim: true, default: '' },
}, { timestamps: true });

affiliatePayoutSchema.index({ affiliate: 1, status: 1, createdAt: -1 });

export default mongoose.models.AffiliatePayout || mongoose.model('AffiliatePayout', affiliatePayoutSchema);
