import mongoose from 'mongoose';

const verificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  dateOfBirth: { type: Date, required: true },
  address: { type: String, required: true, trim: true },
  street: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  postCode: { type: String, required: true, trim: true },
  documentType: { type: String, enum: ['NID', 'Driving', 'Passport', 'DRIVING_LICENSE', 'nid', 'driving', 'passport'], required: true },
  documentNumber: { type: String, required: true, trim: true },
  documentFront: { type: String, default: '' },
  documentBack: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  adminNote: { type: String, default: '' },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('Verification', verificationSchema);
