import mongoose from 'mongoose';

const cryptoDepositSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userId: { type: String, default: '', index: true },
  methodKey: { type: String, required: true, uppercase: true, index: true },
  coin: { type: String, required: true, uppercase: true },
  network: { type: String, required: true },
  address: { type: String, required: true, index: true },
  txHash: { type: String, required: true, index: true },
  amountCrypto: { type: Number, default: 0 },
  amountFiat: { type: Number, default: 0 },
  fiatCurrency: { type: String, default: 'BDT' },
  confirmations: { type: Number, default: 0 },
  requiredConfirmations: { type: Number, default: 1 },
  status: {
    type: String,
    enum: ['detected', 'confirming', 'credited', 'ignored', 'failed'],
    default: 'detected',
    index: true,
  },
  creditedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  creditedAt: Date,
}, { timestamps: true });

cryptoDepositSchema.index({ txHash: 1, methodKey: 1 }, { unique: true });

export default mongoose.models.CryptoDeposit || mongoose.model('CryptoDeposit', cryptoDepositSchema);
