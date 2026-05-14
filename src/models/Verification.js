import mongoose from 'mongoose';

const verificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

  // Document verification is no longer required for deposit, bonus, or withdrawal.
  // The model is kept only for backward compatibility and optional profile info.
  fullName: { type: String, default: '', trim: true },
  email: { type: String, default: '', trim: true, lowercase: true },
  phone: { type: String, default: '', trim: true },
  dateOfBirth: { type: Date },
  address: { type: String, default: '', trim: true },
  street: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  postCode: { type: String, default: '', trim: true },
  documentType: { type: String, enum: ['NID', 'Driving', 'Passport', 'DRIVING_LICENSE', 'nid', 'driving', 'passport', 'NONE'], default: 'NONE' },
  documentNumber: { type: String, default: '', trim: true },
  documentFront: { type: String, default: '' },
  documentBack: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'not_required'], default: 'not_required', index: true },
  adminNote: { type: String, default: '' },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.models.Verification || mongoose.model('Verification', verificationSchema);
