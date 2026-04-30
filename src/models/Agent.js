import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

function normalizeMethodKeys(keys) {
  if (!Array.isArray(keys)) return keys;

  return [...new Set(
    keys
      .map((key) => String(key || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

const agentSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    trim: true,
    default: '',
  },
  password: {
    type: String,
    required: true,
    select: false,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  status: {
    type: String,
    enum: ['active', 'blocked'],
    default: 'active',
    index: true,
  },
  // Main Admin controls this list.
  // undefined = backward-compatible old agents can use all active methods.
  // [] = this agent has no assigned payment methods.
  allowedPaymentMethodKeys: {
    type: [String],
    default: undefined,
    set: normalizeMethodKeys,
  },
  paymentMethods: {
    type: [
      {
        key: {
          type: String,
          required: true,
          trim: true,
          lowercase: true,
        },
        title: {
          type: String,
          required: true,
        },
        number: {
          type: String,
          default: '',
        },
        image: {
          type: String,
          default: '',
        },
        note: {
          type: String,
          default: '',
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        updatedAt: Date,
      },
    ],
    default: [],
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  lastLoginAt: Date,
  adminNote: {
    type: String,
    default: '',
  },
}, { timestamps: true });

agentSchema.pre('save', async function hashAgentPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

agentSchema.methods.comparePassword = async function comparePassword(password) {
  if (!this.password) return false;
  return bcrypt.compare(password, this.password);
};

agentSchema.methods.toSafeObject = function toSafeObject() {
  const raw = this.toObject();
  delete raw.password;
  delete raw.__v;
  return raw;
};

export default mongoose.models.Agent || mongoose.model('Agent', agentSchema);
