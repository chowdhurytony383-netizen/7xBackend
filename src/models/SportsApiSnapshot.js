import mongoose from 'mongoose';

const SportsApiSnapshotSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    key: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    builtAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true, index: true },
    source: { type: String, default: 'sports-worker' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
    collection: 'sports_api_snapshots',
  }
);

SportsApiSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.SportsApiSnapshot || mongoose.model('SportsApiSnapshot', SportsApiSnapshotSchema);
