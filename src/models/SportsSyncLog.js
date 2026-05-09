import mongoose from 'mongoose';

const sportsSyncLogSchema = new mongoose.Schema({
  type: { type: String, enum: ['odds', 'scores', 'settlement'], required: true, index: true },
  provider: { type: String, default: 'theoddsapi', index: true },
  status: { type: String, enum: ['success', 'partial', 'failed'], default: 'success', index: true },
  message: { type: String, default: '' },
  stats: { type: mongoose.Schema.Types.Mixed, default: {} },
  startedAt: Date,
  finishedAt: Date,
}, { timestamps: true });

export default mongoose.models.SportsSyncLog || mongoose.model('SportsSyncLog', sportsSyncLogSchema);
