import mongoose from 'mongoose';

const agentTransactionSchema = new mongoose.Schema({
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
  type: {
    type: String,
    enum: ['TOP_UP', 'ADJUSTMENT', 'DEPOSIT_CONFIRM', 'WITHDRAW_CONFIRM', 'REQUEST_REJECT'],
    default: 'TOP_UP',
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  balanceBefore: {
    type: Number,
    default: 0,
  },
  balanceAfter: {
    type: Number,
    default: 0,
  },
  note: {
    type: String,
    default: '',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

export default mongoose.models.AgentTransaction || mongoose.model('AgentTransaction', agentTransactionSchema);
