import mongoose from 'mongoose';

const ProviderWalletTxnSchema = new mongoose.Schema(
  {
    txnId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['debit', 'credit', 'rollback'],
      required: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    sessionId: String,
    amountCents: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'BDT',
    },
    roundId: String,
    betId: String,
    slot: Number,
    multiplier: Number,
    response: Object,
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
    },
  },
  { timestamps: true }
);

export default mongoose.model('ProviderWalletTxn', ProviderWalletTxnSchema);