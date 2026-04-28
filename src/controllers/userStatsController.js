import WalletSnapshot from '../models/WalletSnapshot.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getDayWiseWalletStats = asyncHandler(async (req, res) => {
  const items = await WalletSnapshot.find({ user: req.user._id }).sort({ date: 1 }).limit(60);
  if (items.length) return res.json(items);
  res.json([{ date: new Date(), walletAmount: req.user.wallet, actualWalletAfterBets: req.user.wallet, netBetResult: 0 }]);
});
