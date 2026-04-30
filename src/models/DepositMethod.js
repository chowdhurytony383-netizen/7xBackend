import mongoose from 'mongoose';

const depositMethodSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    enum: ['recommended', 'e-wallets', 'bank', 'crypto', 'other'],
    default: 'e-wallets',
    index: true,
  },
  image: {
    type: String,
    default: '',
  },
  minAmount: {
    type: Number,
    default: 100,
    min: 1,
  },
  maxAmount: {
    type: Number,
    default: 25000,
    min: 1,
  },
  displayOrder: {
    type: Number,
    default: 100,
    index: true,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
}, { timestamps: true });

export default mongoose.models.DepositMethod || mongoose.model('DepositMethod', depositMethodSchema);
