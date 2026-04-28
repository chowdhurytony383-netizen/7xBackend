import mongoose from 'mongoose';

const agentPaymentRequestSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['DEPOSIT', 'WITHDRAW'],
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'],
    default: 'PENDING',
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  userId: {
    type: String,
    default: '',
    index: true,
  },
  userName: {
    type: String,
    default: '',
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent',
    required: true,
    index: true,
  },
  agentId: {
    type: String,
    required: true,
    uppercase: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 1,
  },
  methodKey: {
    type: String,
    default: '',
  },
  methodTitle: {
    type: String,
    default: '',
  },
  methodNumber: {
    type: String,
    default: '',
  },
  userNote: {
    type: String,
    default: '',
  },
  agentNote: {
    type: String,
    default: '',
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
  },
  processedAt: Date,
}, { timestamps: true });

export default mongoose.models.AgentPaymentRequest || mongoose.model('AgentPaymentRequest', agentPaymentRequestSchema);
