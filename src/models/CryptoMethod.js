import mongoose from 'mongoose';

const cryptoMethodSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true, trim: true, uppercase: true },
  coin: { type: String, required: true, trim: true, uppercase: true },
  network: { type: String, required: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  symbol: { type: String, default: '', trim: true, uppercase: true },
  logo: { type: String, default: '' },
  enabled: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 100 },
  minDepositCrypto: { type: Number, default: 0 },
  minDepositFiat: { type: Number, default: 0 },
  confirmations: { type: Number, default: 1, min: 0 },
  xpubEnvKey: { type: String, default: '' },
  addressFamily: { type: String, default: '' },
  tokenContract: { type: String, default: '' },
  warning: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.CryptoMethod || mongoose.model('CryptoMethod', cryptoMethodSchema);
