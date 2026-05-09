import mongoose from 'mongoose';

const scoreSideSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  score: { type: Number, default: 0 },
}, { _id: false });

const sportsAutoEventSchema = new mongoose.Schema({
  provider: { type: String, default: 'theoddsapi', index: true },
  providerEventId: { type: String, required: true, index: true },
  sportKey: { type: String, default: 'football', index: true },
  sportTitle: { type: String, default: 'Football' },
  league: { type: String, default: '' },
  homeTeam: { type: String, required: true, trim: true },
  awayTeam: { type: String, required: true, trim: true },
  commenceTime: { type: Date, index: true },
  status: {
    type: String,
    enum: ['UPCOMING', 'LIVE', 'FINISHED', 'CANCELLED', 'UNKNOWN'],
    default: 'UPCOMING',
    index: true,
  },
  scores: { type: [scoreSideSchema], default: [] },
  completed: { type: Boolean, default: false, index: true },
  lastProviderUpdate: Date,
  lastScoreUpdate: Date,
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

sportsAutoEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });

export default mongoose.models.SportsAutoEvent || mongoose.model('SportsAutoEvent', sportsAutoEventSchema);
