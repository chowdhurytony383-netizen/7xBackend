import User from '../models/User.js';
import Verification from '../models/Verification.js';
import Transaction from '../models/Transaction.js';
import Bet from '../models/Bet.js';
import Game from '../models/Game.js';
import Agent from '../models/Agent.js';
import AgentPaymentRequest from '../models/AgentPaymentRequest.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrThrow } from '../utils/appError.js';
import { optionalString, requireNumber } from '../utils/validation.js';
import { creditWallet } from '../utils/wallet.js';
import { sanitizeUser } from '../utils/sanitize.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function queryFilter(req, type) {
  const filter = {};
  if (type) filter.type = type;
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.search) {
    const search = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [
      { razorpayOrderId: search },
      { razorpayPaymentId: search },
      { razorpayPayoutId: search },
      { upiId: search },
      { accountNumber: search },
      { accountHolderName: search },
      { agentId: search },
      { methodKey: search },
    ];
  }
  return filter;
}

export const overview = asyncHandler(async (_req, res) => {
  const [totalUsers, totalAgents, agentBalanceAgg, walletAgg, pendingDeposits, pendingWithdrawals, totalDeposits, totalWithdrawals, pendingAgentDeposits, pendingAgentWithdrawals] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    Agent.countDocuments(),
    Agent.aggregate([{ $group: { _id: null, totalBalance: { $sum: '$balance' } } }]),
    User.aggregate([{ $group: { _id: null, totalWallet: { $sum: '$wallet' } } }]),
    Transaction.countDocuments({ type: 'DEPOSIT', status: 'PENDING' }),
    Transaction.countDocuments({ type: 'WITHDRAW', status: { $in: ['PENDING', 'PROCESSING'] } }),
    Transaction.aggregate([{ $match: { type: 'DEPOSIT', status: 'SUCCESS' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { type: 'WITHDRAW', status: 'SUCCESS' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    AgentPaymentRequest.countDocuments({ type: 'DEPOSIT', status: 'PENDING' }),
    AgentPaymentRequest.countDocuments({ type: 'WITHDRAW', status: 'PENDING' }),
  ]);

  res.json({
    success: true,
    data: {
      stats: {
        totalUsers,
        totalAgents,
        totalAgentBalance: agentBalanceAgg[0]?.totalBalance || 0,
        totalWallet: walletAgg[0]?.totalWallet || 0,
        pendingDeposits,
        pendingWithdrawals,
        pendingAgentDeposits,
        pendingAgentWithdrawals,
        totalDeposits: totalDeposits[0]?.amount || 0,
        totalWithdrawals: totalWithdrawals[0]?.amount || 0,
      },
    },
  });
});

export const users = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.verificationStatus) filter.verificationStatus = req.query.verificationStatus;
  if (req.query.search) {
    const search = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ email: search }, { name: search }, { fullName: search }, { phone: search }];
  }
  const items = await User.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, data: items.map(sanitizeUser), users: items.map(sanitizeUser) });
});

export const userDetails = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  assertOrThrow(user, 'User not found', 404);
  const [verification, bets, transactions] = await Promise.all([
    Verification.findOne({ user: user._id }),
    Bet.find({ user: user._id }).populate('game', 'name displayName image').sort({ createdAt: -1 }).limit(100),
    Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(100),
  ]);
  res.json({ success: true, data: { user: { ...sanitizeUser(user), verification }, verification, bets, transactions } });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  assertOrThrow(user, 'User not found', 404);
  const allowed = ['fullName', 'name', 'phone', 'address', 'street', 'city', 'postCode', 'adminNote'];
  for (const field of allowed) if (req.body[field] !== undefined) user[field] = optionalString(req.body[field], 500) || '';
  if (req.body.wallet !== undefined) user.wallet = requireNumber(req.body.wallet, 'Wallet', 0, 999_999_999);
  await user.save();
  res.json({ success: true, message: 'User updated', data: sanitizeUser(user) });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  const status = optionalString(req.body.status, 40);
  assertOrThrow(['active', 'suspended', 'blocked'].includes(status), 'Invalid status', 400);
  const user = await User.findByIdAndUpdate(req.params.userId, { status, adminNote: optionalString(req.body.note, 500) || '' }, { new: true });
  assertOrThrow(user, 'User not found', 404);
  res.json({ success: true, message: 'User status updated', data: sanitizeUser(user) });
});

export const updateUserVerification = asyncHandler(async (req, res) => {
  const status = optionalString(req.body.status, 40);
  assertOrThrow(['pending', 'approved', 'rejected'].includes(status), 'Invalid verification status', 400);
  const user = await User.findById(req.params.userId);
  assertOrThrow(user, 'User not found', 404);
  const verification = await Verification.findOneAndUpdate(
    { user: user._id },
    { status, adminNote: optionalString(req.body.note, 500) || '', reviewedAt: new Date(), reviewedBy: req.user._id },
    { new: true }
  );
  user.verificationStatus = status;
  if (status === 'approved') user.isVerified = true;
  await user.save();
  res.json({ success: true, message: 'Verification status updated', data: { user: sanitizeUser(user), verification } });
});

export const deposits = asyncHandler(async (req, res) => {
  const items = await Transaction.find(queryFilter(req, 'DEPOSIT')).populate('user', 'name fullName email phone wallet verificationStatus').sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, data: items, deposits: items });
});

export const withdrawals = asyncHandler(async (req, res) => {
  const items = await Transaction.find(queryFilter(req, 'WITHDRAW')).populate('user', 'name fullName email phone wallet verificationStatus').sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, data: items, withdrawals: items });
});

export const transactions = asyncHandler(async (req, res) => {
  const items = await Transaction.find(queryFilter(req)).populate('user', 'name fullName email phone wallet verificationStatus').sort({ createdAt: -1 }).limit(250);
  res.json({ success: true, data: items, transactions: items });
});

async function updateTransactionStatus(req, res, expectedType) {
  const status = String(req.body.status || '').toUpperCase();
  assertOrThrow(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REJECTED', 'CANCELLED'].includes(status), 'Invalid transaction status', 400);
  const transaction = await Transaction.findOne({ _id: req.params.transactionId, type: expectedType });
  assertOrThrow(transaction, 'Transaction not found', 404);

  const prevStatus = transaction.status;
  transaction.status = status;
  transaction.adminNote = optionalString(req.body.note, 500) || transaction.adminNote;
  transaction.processedAt = new Date();
  transaction.processedBy = req.user._id;
  await transaction.save();

  if (expectedType === 'DEPOSIT' && status === 'SUCCESS' && prevStatus !== 'SUCCESS') {
    await creditWallet(transaction.user, transaction.amount, 'admin-deposit-approval');
  }

  if (expectedType === 'WITHDRAW' && ['REJECTED', 'FAILED', 'CANCELLED'].includes(status) && !['REJECTED', 'FAILED', 'CANCELLED'].includes(prevStatus)) {
    const gatewayPayload = { ...(transaction.gatewayPayload || {}) };
    if (gatewayPayload.walletHeld === true && gatewayPayload.walletRefunded !== true) {
      await creditWallet(transaction.user, transaction.amount, 'withdraw-refund');
      gatewayPayload.walletRefunded = true;
      gatewayPayload.walletRefundedAt = new Date();
      transaction.gatewayPayload = gatewayPayload;
      await transaction.save();
    }
  }

  res.json({ success: true, message: 'Transaction status updated', data: transaction });
}

export const updateDepositStatus = asyncHandler((req, res) => updateTransactionStatus(req, res, 'DEPOSIT'));
export const updateWithdrawalStatus = asyncHandler((req, res) => updateTransactionStatus(req, res, 'WITHDRAW'));

export const games = asyncHandler(async (_req, res) => {
  const items = await Game.find().sort({ sortOrder: 1, createdAt: 1 });
  res.json({ success: true, data: items, games: items });
});

export const updateGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.gameId);
  assertOrThrow(game, 'Game not found', 404);
  const allowed = ['displayName', 'description', 'image', 'category'];
  for (const field of allowed) if (req.body[field] !== undefined) game[field] = optionalString(req.body[field], 500) || '';
  if (req.body.isActive !== undefined) game.isActive = Boolean(req.body.isActive);
  if (req.body.sortOrder !== undefined) game.sortOrder = Number(req.body.sortOrder) || 0;
  await game.save();
  res.json({ success: true, message: 'Game updated', data: game });
});
