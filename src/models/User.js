import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
    index: true,
  },

  fullName: { type: String, trim: true, default: '' },
  name: { type: String, trim: true, default: '' },
  username: { type: String, trim: true, unique: true, sparse: true },

  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    index: true,
  },

  phone: { type: String, trim: true, default: '' },
  password: { type: String, select: false },
  picture: { type: String, default: '' },

  provider: {
    type: String,
    enum: ['local', 'one-click', 'google', 'facebook'],
    default: 'local',
  },

  providerId: { type: String, default: '' },

  registrationType: {
    type: String,
    enum: ['email', 'one-click', 'google', 'facebook'],
    default: 'email',
  },

  country: {
    type: String,
    trim: true,
    default: '',
  },

  countryCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: '',
  },

  currency: {
    type: String,
    trim: true,
    uppercase: true,
    default: '',
  },

  referralCode: {
    type: String,
    trim: true,
    default: '',
  },

  referredBy: {
    type: String,
    trim: true,
    default: '',
  },

  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    index: true,
  },

  permissions: {
    type: [String],
    default: [],
  },

  wallet: { type: Number, default: 0, min: 0 },
  isVerified: { type: Boolean, default: false },

  verificationStatus: {
    type: String,
    enum: ['not_submitted', 'pending', 'approved', 'rejected'],
    default: 'not_submitted',
  },

  status: {
    type: String,
    enum: ['active', 'suspended', 'blocked'],
    default: 'active',
  },

  dateOfBirth: Date,
  address: { type: String, default: '' },
  street: { type: String, default: '' },
  city: { type: String, default: '' },
  postCode: { type: String, default: '' },
  adminNote: { type: String, default: '' },
  tokenVersion: { type: Number, default: 0 },
  emailVerificationToken: { type: String, default: '' },
  emailVerificationExpires: Date,
  passwordResetOtpHash: { type: String, default: '' },
  passwordResetExpires: Date,
  passwordResetVerified: { type: Boolean, default: false },
}, { timestamps: true });

userSchema.pre('validate', function setOneClickDefaults(next) {
  if (!this.email && this.userId) {
    this.email = `${this.userId}@oneclick.7xbet.local`;
  }

  if (!this.username && this.userId) {
    this.username = this.userId;
  }

  if (!this.name && this.userId) {
    this.name = `User ${this.userId}`;
  }

  if (!this.fullName && this.name) {
    this.fullName = this.name;
  }

  next();
});

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function comparePassword(password) {
  if (!this.password) return false;
  return bcrypt.compare(password, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  const raw = this.toObject();
  delete raw.password;
  delete raw.passwordResetOtpHash;
  delete raw.passwordResetVerified;
  delete raw.emailVerificationToken;
  delete raw.__v;
  return raw;
};

export default mongoose.model('User', userSchema);
