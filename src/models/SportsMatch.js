import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({ name: String, displayName: String, logo: String, image: String, flag: String }, { _id: false });

const sportsMatchSchema = new mongoose.Schema({
  sport: { type: String, default: 'football', index: true },
  country: { type: mongoose.Schema.Types.Mixed, default: '' },
  league: { type: mongoose.Schema.Types.Mixed, default: '' },
  tournament: { type: String, default: '' },
  homeTeam: { type: teamSchema, default: {} },
  awayTeam: { type: teamSchema, default: {} },
  score: { type: mongoose.Schema.Types.Mixed, default: { home: 0, away: 0 } },
  status: { type: String, default: 'Live', index: true },
  markets: { type: Array, default: [] },
  odds: { type: Array, default: [] },
  mainOdds: { type: Array, default: [] },
  moreMarkets: { type: Number, default: 0 },
  startTime: { type: String, default: '' },
  dateTime: { type: String, default: '' },
  kickoffTime: { type: String, default: '' },
  matchTime: { type: String, default: '' },
  isMatchOfTheDay: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('SportsMatch', sportsMatchSchema);
