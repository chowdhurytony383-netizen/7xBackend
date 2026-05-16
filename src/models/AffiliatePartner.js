import mongoose from 'mongoose';

const payoutMethodSchema = new mongoose.Schema({
  method: { type: String, trim: true, default: '' },
  accountName: { type: String, trim: true, default: '' },
  accountNumber: { type: String, trim: true, default: '' },
  network: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  isDefault: { type: Boolean, default: false },
}, { _id: false });

const affiliatePartnerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  affiliateCode: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
  displayName: { type: String, trim: true, default: '' },
  companyName: { type: String, trim: true, default: '' },
  website: { type: String, trim: true, default: '' },
  trafficSources: { type: [String], default: [] },
  countries: { type: [String], default: [] },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
    index: true,
  },

  tier: {
    type: String,
    enum: ['standard', 'vip', 'country_manager', 'custom'],
    default: 'standard',
    index: true,
  },

  commissionType: { type: String, enum: ['ggr'], default: 'ggr' },
  commissionRate: { type: Number, default: 0.30, min: 0, max: 0.40 },
  negativeCarryover: { type: Boolean, default: true },
  carryoverBalance: { type: Number, default: 0 },

  payoutCurrency: { type: String, trim: true, uppercase: true, default: '' },
  minimumPayoutUsd: { type: Number, default: 30, min: 0 },
  weeklyPayoutDay: { type: Number, default: 2, min: 0, max: 6 }, // 0=Sunday, 2=Tuesday
  autoPayoutEnabled: { type: Boolean, default: true },
  payoutHold: { type: Boolean, default: false, index: true },
  payoutHoldReason: { type: String, trim: true, default: '' },
  lastAutoPayoutWeekKey: { type: String, trim: true, default: '', index: true },

  stats: {
    clicks: { type: Number, default: 0 },
    registrations: { type: Number, default: 0 },
    firstDeposits: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    totalWithdrawals: { type: Number, default: 0 },
    totalBets: { type: Number, default: 0 },
    totalWins: { type: Number, default: 0 },
    totalBonusCost: { type: Number, default: 0 },
    totalRefundsVoidsChargebacks: { type: Number, default: 0 },
    totalGgr: { type: Number, default: 0 },
    commissionEarned: { type: Number, default: 0 },
    commissionApproved: { type: Number, default: 0 },
    commissionPaid: { type: Number, default: 0 },
    pendingCommission: { type: Number, default: 0 },
    heldCommission: { type: Number, default: 0 },
    lastMinimumPayoutLocal: { type: Number, default: 0 },
    lastMinimumPayoutCurrency: { type: String, trim: true, uppercase: true, default: '' },
  },

  fraud: {
    openFlags: { type: Number, default: 0 },
    highRiskFlags: { type: Number, default: 0 },
    lastScanAt: Date,
    lastRiskLevel: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
  },

  payoutMethods: { type: [payoutMethodSchema], default: [] },
  adminNote: { type: String, trim: true, default: '' },
  applyNote: { type: String, trim: true, default: '' },
  approvedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedAt: Date,
  suspendedAt: Date,
}, { timestamps: true });

affiliatePartnerSchema.index({ status: 1, createdAt: -1 });
affiliatePartnerSchema.index({ tier: 1, status: 1 });

export default mongoose.models.AffiliatePartner || mongoose.model('AffiliatePartner', affiliatePartnerSchema);
