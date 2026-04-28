import mongoose from 'mongoose';

const walletSnapshotSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: Date, default: Date.now, index: true },
  walletAmount: { type: Number, default: 0 },
  actualWalletAfterBets: { type: Number, default: 0 },
  netBetResult: { type: Number, default: 0 },
  source: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('WalletSnapshot', walletSnapshotSchema);
