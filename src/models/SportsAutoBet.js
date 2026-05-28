import mongoose from 'mongoose';

const sportsAutoBetSchema = new mongoose.Schema({
  betId: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'SportsAutoEvent', required: true, index: true },
  provider: { type: String, default: 'theoddsapi' },
  providerEventId: { type: String, required: true, index: true },
  sportKey: { type: String, default: '' },
  sportTitle: { type: String, default: '' },
  league: { type: String, default: '' },
  homeTeam: { type: String, default: '' },
  awayTeam: { type: String, default: '' },
  marketKey: { type: String, default: 'h2h' },
  marketName: { type: String, default: 'Match Winner' },
  marketDisplayName: { type: String, default: '' },
  sportsbook: { type: String, default: '' },
  providerOddsId: { type: String, default: '' },
  groupingKey: { type: String, default: '' },
  selectionId: { type: String, required: true },
  selectionName: { type: String, required: true },
  selectionDisplayName: { type: String, default: '' },
  point: { type: Number, default: null },
  odds: { type: Number, required: true, min: 1 },
  oddsLockedAt: Date,
  providerSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  stake: { type: Number, required: true, min: 0 },
  potentialReturn: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ['OPEN', 'WON', 'LOST', 'VOID', 'REFUNDED', 'REVIEW', 'CANCELLED', 'HALF_WON', 'HALF_LOST'],
    default: 'OPEN',
    index: true,
  },
  walletBefore: { type: Number, default: 0 },
  walletAfter: { type: Number, default: 0 },
  payoutAmount: { type: Number, default: 0 },
  result: { type: mongoose.Schema.Types.Mixed, default: {} },
  settlementReason: { type: String, default: '' },
  settledAt: Date,
  settledBy: { type: String, default: 'auto' },
}, { timestamps: true });

sportsAutoBetSchema.index({ user: 1, createdAt: -1 });
sportsAutoBetSchema.index({ status: 1, createdAt: 1 });

export default mongoose.models.SportsAutoBet || mongoose.model('SportsAutoBet', sportsAutoBetSchema);
