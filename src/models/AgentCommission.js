import mongoose from 'mongoose';

const agentCommissionSchema = new mongoose.Schema({
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent',
    required: true,
    index: true,
  },
  agentId: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true,
  },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'BDT',
    index: true,
  },
  countryCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'BD',
    index: true,
  },
  country: {
    type: String,
    trim: true,
    default: 'Bangladesh',
  },
  type: {
    type: String,
    enum: ['DEPOSIT', 'WITHDRAW'],
    required: true,
    index: true,
  },
  sourceAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  commissionRate: {
    type: Number,
    required: true,
    min: 0,
  },
  commissionAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  paymentRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgentPaymentRequest',
    required: true,
    index: true,
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  userId: {
    type: String,
    default: '',
    index: true,
  },
  status: {
    type: String,
    enum: ['PENDING', 'PAID'],
    default: 'PENDING',
    index: true,
  },
  earnedMonth: {
    type: String,
    default: '',
    index: true,
  },
  payoutMonth: {
    type: String,
    default: '',
    index: true,
  },
  paidAt: Date,
  note: {
    type: String,
    default: '',
  },
}, { timestamps: true });

agentCommissionSchema.index({ paymentRequest: 1, type: 1 }, { unique: true });

export default mongoose.models.AgentCommission || mongoose.model('AgentCommission', agentCommissionSchema);
