import mongoose from 'mongoose';

const cryptoDepositSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userId: { type: String, default: '', index: true },
  methodKey: { type: String, required: true, uppercase: true, index: true },
  coin: { type: String, required: true, uppercase: true },
  network: { type: String, required: true },
  address: { type: String, required: true, index: true },
  addressLower: { type: String, default: '', lowercase: true, index: true },
  txHash: { type: String, required: true, index: true },
  eventIndex: { type: String, default: '', index: true },
  blockNumber: { type: String, default: '' },
  amountCrypto: { type: Number, default: 0 },
  amountFiat: { type: Number, default: 0 },
  fiatCurrency: { type: String, default: 'BDT', uppercase: true },
  priceRate: { type: Number, default: 0 },
  priceSource: { type: String, default: '' },
  priceAt: Date,
  confirmations: { type: Number, default: 0 },
  requiredConfirmations: { type: Number, default: 1 },
  status: {
    type: String,
    enum: ['detected', 'confirming', 'crediting', 'credited', 'ignored', 'failed'],
    default: 'detected',
    index: true,
  },
  ignoredReason: { type: String, default: '' },
  creditError: { type: String, default: '' },
  creditedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  creditedAt: Date,
}, { timestamps: true });

cryptoDepositSchema.pre('save', function setAddressLower(next) {
  this.addressLower = this.address ? String(this.address).toLowerCase() : '';
  next();
});

cryptoDepositSchema.index({ txHash: 1, methodKey: 1, addressLower: 1, eventIndex: 1 }, { unique: true });

export default mongoose.models.CryptoDeposit || mongoose.model('CryptoDeposit', cryptoDepositSchema);
