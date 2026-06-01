import mongoose from 'mongoose';

const SportsApiSnapshotSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    key: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    builtAt: { type: Date, default: Date.now, index: true },
    // Do not set index: true here. The TTL index below owns this key.
    // Having both a normal index and a TTL index on expiresAt creates MongoDB
    // IndexOptionsConflict when an old non-TTL expiresAt_1 index already exists.
    expiresAt: { type: Date, required: true },
    source: { type: String, default: 'sports-worker' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
    collection: 'sports_api_snapshots',
  }
);

SportsApiSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_1' });

export default mongoose.models.SportsApiSnapshot || mongoose.model('SportsApiSnapshot', SportsApiSnapshotSchema);
