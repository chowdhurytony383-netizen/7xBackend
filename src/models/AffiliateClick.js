import mongoose from 'mongoose';

const affiliateClickSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePartner', index: true },
  affiliateCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  landingPage: { type: String, trim: true, default: '' },
  referrer: { type: String, trim: true, default: '' },
  ipHash: { type: String, trim: true, default: '', index: true },
  userAgentHash: { type: String, trim: true, default: '' },
  country: { type: String, trim: true, default: '' },
  registeredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  convertedAt: Date,
}, { timestamps: true });

affiliateClickSchema.index({ affiliateCode: 1, createdAt: -1 });

export default mongoose.models.AffiliateClick || mongoose.model('AffiliateClick', affiliateClickSchema);
