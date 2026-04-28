import mongoose from 'mongoose';

const betSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  game: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', required: true, index: true },
  gameName: { type: String, required: true, trim: true, lowercase: true },
  betAmount: { type: Number, required: true, min: 0 },
  winAmount: { type: Number, default: 0, min: 0 },
  isWin: { type: Boolean, default: false },
  status: { type: String, enum: ['PENDING', 'WIN', 'LOSE', 'CASHED_OUT', 'CANCELLED'], default: 'PENDING', index: true },
  gameData: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

export default mongoose.model('Bet', betSchema);
