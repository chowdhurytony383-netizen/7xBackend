import mongoose from 'mongoose';

const userCryptoAddressSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userId: { type: String, default: '', index: true },
  method: { type: mongoose.Schema.Types.ObjectId, ref: 'CryptoMethod' },
  methodKey: { type: String, required: true, trim: true, uppercase: true, index: true },
  coin: { type: String, required: true, trim: true, uppercase: true },
  network: { type: String, required: true, trim: true },
  address: { type: String, default: '', trim: true, index: true },
  addressLower: { type: String, default: '', trim: true, lowercase: true, index: true },
  memo: { type: String, default: '', trim: true },
  provider: { type: String, default: 'tatum' },
  derivationIndex: { type: Number, default: 0, index: true },
  xpubEnvKey: { type: String, default: '' },
  status: {
    type: String,
    enum: ['active', 'pending', 'failed', 'disabled'],
    default: 'pending',
    index: true,
  },
  errorMessage: { type: String, default: '' },
  lastGeneratedAt: Date,

  // Tatum notification/subscription metadata
  subscriptionId: { type: String, default: '', index: true },
  subscriptionProvider: { type: String, default: 'tatum' },
  subscriptionStatus: {
    type: String,
    enum: ['none', 'active', 'failed', 'disabled'],
    default: 'none',
    index: true,
  },
  subscriptionError: { type: String, default: '' },
  subscribedAt: Date,
  lastSubscriptionAttemptAt: Date,
}, { timestamps: true });

userCryptoAddressSchema.pre('save', function setAddressLower(next) {
  this.addressLower = this.address ? String(this.address).toLowerCase() : '';
  next();
});

userCryptoAddressSchema.pre('findOneAndUpdate', function setAddressLowerOnUpdate(next) {
  const update = this.getUpdate() || {};
  const nextAddress = update.$set?.address ?? update.address;
  if (nextAddress !== undefined) {
    update.$set = update.$set || {};
    update.$set.addressLower = nextAddress ? String(nextAddress).toLowerCase() : '';
    this.setUpdate(update);
  }
  next();
});

userCryptoAddressSchema.index({ user: 1, methodKey: 1 }, { unique: true });
userCryptoAddressSchema.index({ methodKey: 1, derivationIndex: 1 }, { unique: true, sparse: true });

export default mongoose.models.UserCryptoAddress || mongoose.model('UserCryptoAddress', userCryptoAddressSchema);
