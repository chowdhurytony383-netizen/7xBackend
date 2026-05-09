import mongoose from 'mongoose';

const selectionSchema = new mongoose.Schema({
  selectionId: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  lastPrice: { type: Number, default: 0 },
  point: { type: Number, default: null },
  status: {
    type: String,
    enum: ['OPEN', 'SUSPENDED', 'CLOSED'],
    default: 'OPEN',
  },
}, { _id: false });

const sportsAutoMarketSchema = new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'SportsAutoEvent', required: true, index: true },
  provider: { type: String, default: 'theoddsapi', index: true },
  providerEventId: { type: String, required: true, index: true },
  marketKey: { type: String, default: 'h2h', index: true },
  marketName: { type: String, default: 'Match Winner' },
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

export default mongoose.models.SportsAutoMarket || mongoose.model('SportsAutoMarket', sportsAutoMarketSchema);
