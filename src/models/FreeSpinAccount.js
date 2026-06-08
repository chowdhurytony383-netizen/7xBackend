import mongoose from 'mongoose';

const freeSpinAccountSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  spinsAvailable: { type: Number, default: 0, min: 0 },
  nextFreeSpinAt: { type: Date, default: Date.now, index: true },
  lastSpinAt: Date,
  lastAutoGrantAt: Date,
  totalSpins: { type: Number, default: 0, min: 0 },
  totalCashReward: { type: Number, default: 0, min: 0 },
  totalExtraSpinsWon: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

export default mongoose.models.FreeSpinAccount || mongoose.model('FreeSpinAccount', freeSpinAccountSchema);
