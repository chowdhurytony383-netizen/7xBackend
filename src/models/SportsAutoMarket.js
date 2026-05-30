import mongoose from 'mongoose';

const selectionSchema = new mongoose.Schema({
  selectionId: { type: String, required: true },
  providerOddsId: { type: String, default: '' },
  sportsbook: { type: String, default: '' },
  lineId: { type: String, default: '' },
  groupingKey: { type: String, default: '' },
  name: { type: String, required: true },
  displayName: { type: String, default: '' },
  price: { type: Number, required: true },
  lastPrice: { type: Number, default: 0 },
  point: { type: Number, default: null },
  isMain: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ['OPEN', 'SUSPENDED', 'CLOSED'],
    default: 'OPEN',
  },
  lastLockedAt: Date,
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const sportsAutoMarketSchema = new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'SportsAutoEvent', required: true, index: true },
  provider: { type: String, default: 'theoddsapi', index: true },
  providerEventId: { type: String, required: true, index: true },
  marketKey: { type: String, default: 'h2h', index: true },
  marketName: { type: String, default: 'Match Winner' },
  marketDisplayName: { type: String, default: '' },
  bookmaker: { type: String, default: '' },
  selections: { type: [selectionSchema], default: [] },
  status: {
    type: String,
    enum: ['OPEN', 'SUSPENDED', 'CLOSED'],
    default: 'OPEN',
    index: true,
  },
  lastProviderUpdate: Date,
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

sportsAutoMarketSchema.index({ provider: 1, providerEventId: 1, marketKey: 1 }, { unique: true });
sportsAutoMarketSchema.index({ event: 1, status: 1, updatedAt: -1 });
sportsAutoMarketSchema.index({ event: 1, status: 1, marketKey: 1, updatedAt: -1 });
sportsAutoMarketSchema.index({ provider: 1, event: 1, status: 1, updatedAt: -1 });

export default mongoose.models.SportsAutoMarket || mongoose.model('SportsAutoMarket', sportsAutoMarketSchema);
