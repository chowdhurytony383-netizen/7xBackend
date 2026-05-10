import User from '../models/User.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { AppError } from './appError.js';
import { recordTurnoverCredit, recordWagerTurnover } from '../services/withdrawalGuardService.js';

export async function debitWallet(userId, amount, source = '') {
  const user = await User.findOneAndUpdate(
    { _id: userId, wallet: { $gte: amount }, status: 'active' },
    { $inc: { wallet: -amount } },
    { new: true }
  );
  if (!user) throw new AppError('Insufficient wallet balance', 400);
  const snapshot = await WalletSnapshot.create({ user: userId, walletAmount: user.wallet, actualWalletAfterBets: user.wallet, netBetResult: -amount, source });
  await recordWagerTurnover(userId, amount, source).catch((error) => {
    console.error('Turnover wager tracking failed:', error.message);
  });
  return user;
}

export async function creditWallet(userId, amount, source = '') {
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { wallet: amount } },
    { new: true }
  );
  if (!user) throw new AppError('User not found', 404);
  const snapshot = await WalletSnapshot.create({ user: userId, walletAmount: user.wallet, actualWalletAfterBets: user.wallet, netBetResult: amount, source });
  await recordTurnoverCredit({ userId, amount, source, sourceRef: snapshot._id }).catch((error) => {
    console.error('Turnover credit tracking failed:', error.message);
  });
  return user;
}
