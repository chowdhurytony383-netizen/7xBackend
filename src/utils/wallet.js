import User from '../models/User.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { AppError } from './appError.js';

export async function debitWallet(userId, amount, source = '') {
  const user = await User.findOneAndUpdate(
    { _id: userId, wallet: { $gte: amount }, status: 'active' },
    { $inc: { wallet: -amount } },
    { new: true }
  );
  if (!user) throw new AppError('Insufficient wallet balance', 400);
  await WalletSnapshot.create({ user: userId, walletAmount: user.wallet, actualWalletAfterBets: user.wallet, netBetResult: -amount, source });
  return user;
}

export async function creditWallet(userId, amount, source = '') {
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { wallet: amount } },
    { new: true }
  );
  if (!user) throw new AppError('User not found', 404);
  await WalletSnapshot.create({ user: userId, walletAmount: user.wallet, actualWalletAfterBets: user.wallet, netBetResult: amount, source });
  return user;
}
