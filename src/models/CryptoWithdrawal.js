import mongoose from 'mongoose';

const cryptoWithdrawalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userId: { type: String, default: '', index: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', index: true },
  methodKey: { type: String, required: true, uppercase: true, index: true },
  coin: { type: String, required: true, uppercase: true },
  symbol: { type: String, default: '', uppercase: true },
  network: { type: String, required: true },
  toAddress: { type: String, required: true, trim: true, index: true },
  memo: { type: String, default: '', trim: true },
  amountFiat: { type: Number, required: true, min: 0 },
  fiatCurrency: { type: String, default: 'BDT', uppercase: true },
  amountCrypto: { type: Number, required: true, min: 0 },
  priceRate: { type: Number, default: 0 },
  priceSource: { type: String, default: '' },
  priceAt: Date,
  status: {
    type: String,
    enum: ['pending', 'processing', 'broadcasted', 'success', 'failed', 'rejected', 'cancelled', 'dry_run'],
    default: 'pending',
    index: true,
  },
  txHash: { type: String, default: '', index: true },
  kmsId: { type: String, default: '', index: true },
  provider: { type: String, default: 'tatum' },
  providerRequest: { type: mongoose.Schema.Types.Mixed, default: {} },
  providerResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
  errorMessage: { type: String, default: '' },
  walletDebited: { type: Boolean, default: false },
  walletDebitedAt: Date,
  broadcastRequestedAt: Date,
  completedAt: Date,
}, { timestamps: true });

cryptoWithdrawalSchema.index({ transaction: 1, methodKey: 1 }, { unique: true, sparse: true });

export default mongoose.models.CryptoWithdrawal || mongoose.model('CryptoWithdrawal', cryptoWithdrawalSchema);
