import mongoose from 'mongoose';

const affiliatePayoutSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePartner', required: true, index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  periods: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePeriod' }],
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, trim: true, uppercase: true, default: 'BDT' },
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
}, { timestamps: true });

affiliatePayoutSchema.index({ affiliate: 1, status: 1, createdAt: -1 });

export default mongoose.models.AffiliatePayout || mongoose.model('AffiliatePayout', affiliatePayoutSchema);
