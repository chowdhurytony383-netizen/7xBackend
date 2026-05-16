import mongoose from 'mongoose';

const fxRateCacheSchema = new mongoose.Schema({
  base: { type: String, trim: true, uppercase: true, default: 'USD', index: true },
  dateKey: { type: String, required: true, index: true },
  rates: { type: mongoose.Schema.Types.Mixed, default: {} },
  source: { type: String, trim: true, default: '' },
  fetchedAt: { type: Date, default: Date.now },
}, { timestamps: true });

fxRateCacheSchema.index({ base: 1, dateKey: 1 }, { unique: true });

export default mongoose.models.FxRateCache || mongoose.model('FxRateCache', fxRateCacheSchema);
