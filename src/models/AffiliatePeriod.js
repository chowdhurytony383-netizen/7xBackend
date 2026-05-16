import mongoose from 'mongoose';

const affiliatePeriodSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePartner', required: true, index: true },
  periodStart: { type: Date, required: true, index: true },
  periodEnd: { type: Date, required: true, index: true },
  currency: { type: String, trim: true, uppercase: true, default: 'BDT' },

  totalBets: { type: Number, default: 0, min: 0 },
  totalWins: { type: Number, default: 0, min: 0 },
  bonusCost: { type: Number, default: 0, min: 0 },
  refundsVoidsChargebacks: { type: Number, default: 0, min: 0 },
  grossGgr: { type: Number, default: 0 },
  previousCarryover: { type: Number, default: 0 },
  netGgrAfterCarryover: { type: Number, default: 0 },
  commissionRate: { type: Number, required: true, min: 0, max: 0.40 },
  commissionAmount: { type: Number, default: 0, min: 0 },
  carryoverAfter: { type: Number, default: 0 },

  sourceBreakdown: {
    internal: { bets: { type: Number, default: 0 }, wins: { type: Number, default: 0 } },
    crash: { bets: { type: Number, default: 0 }, wins: { type: Number, default: 0 } },
    jili: { bets: { type: Number, default: 0 }, wins: { type: Number, default: 0 } },
    providerWallet: { bets: { type: Number, default: 0 }, wins: { type: Number, default: 0 } },
  },

  status: {
    type: String,
    enum: ['calculated', 'approved', 'paid', 'cancelled'],
    default: 'calculated',
    index: true,
  },
  calculatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  payout: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePayout' },
  note: { type: String, trim: true, default: '' },
}, { timestamps: true });

affiliatePeriodSchema.index({ affiliate: 1, periodStart: 1, periodEnd: 1 }, { unique: true });
affiliatePeriodSchema.index({ status: 1, periodStart: -1 });

export default mongoose.models.AffiliatePeriod || mongoose.model('AffiliatePeriod', affiliatePeriodSchema);
