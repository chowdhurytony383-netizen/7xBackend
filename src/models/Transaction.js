import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['DEPOSIT', 'WITHDRAW', 'BONUS'], required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REJECTED', 'CANCELLED'], default: 'PENDING', index: true },
  method: { type: String, default: '' },
  upiId: { type: String, default: '' },
  accountHolderName: { type: String, default: '' },
  accountNumber: { type: String, default: '' },
  ifscCode: { type: String, default: '' },
  razorpayOrderId: { type: String, default: '' },
  razorpayPaymentId: { type: String, default: '' },
  razorpayPayoutId: { type: String, default: '' },
  gatewayPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  adminNote: { type: String, default: '' },
  processedAt: Date,
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', index: true },
  agentId: { type: String, default: '', index: true },
  agentPaymentRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentPaymentRequest' },
  methodKey: { type: String, default: '' },
  currency: { type: String, trim: true, uppercase: true, default: '' },
  balanceType: { type: String, enum: ['MAIN', 'BONUS'], default: 'MAIN', index: true },
  userNote: { type: String, default: '' },
  transactionRef: { type: String, default: '', trim: true, index: true },
  transactionRefNormalized: { type: String, default: '', trim: true, uppercase: true, index: true },
  agentNote: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
