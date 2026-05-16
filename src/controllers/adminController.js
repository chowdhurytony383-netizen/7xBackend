import User from '../models/User.js';
import Verification from '../models/Verification.js';
import Transaction from '../models/Transaction.js';
import Bet from '../models/Bet.js';
import Game from '../models/Game.js';
import Agent from '../models/Agent.js';
import AgentPaymentRequest from '../models/AgentPaymentRequest.js';
import AgentTransaction from '../models/AgentTransaction.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrThrow } from '../utils/appError.js';
import { optionalString, requireNumber, requireString } from '../utils/validation.js';
import { creditWallet } from '../utils/wallet.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { safelyAwardFirstDepositBonus } from '../services/firstDepositBonusService.js';
import { handleSuccessfulDepositForReferral } from '../services/referralRewardService.js';


function boolFromBody(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'enabled', 'allow'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', 'disabled', 'block'].includes(normalized)) return false;
  return fallback;
}

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


export const updateUserPermissions = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  assertOrThrow(user, 'User not found', 404);

  if (req.body.gameplayEnabled !== undefined) {
    user.gameplayEnabled = boolFromBody(req.body.gameplayEnabled, user.gameplayEnabled !== false);
    user.bettingEnabled = user.gameplayEnabled;
  }
  if (req.body.bettingEnabled !== undefined) {
    user.bettingEnabled = boolFromBody(req.body.bettingEnabled, user.bettingEnabled !== false);
    user.gameplayEnabled = user.bettingEnabled;
  }
  if (req.body.depositEnabled !== undefined) {
    user.depositEnabled = boolFromBody(req.body.depositEnabled, user.depositEnabled !== false);
  }
  if (req.body.withdrawEnabled !== undefined) {
    user.withdrawEnabled = boolFromBody(req.body.withdrawEnabled, user.withdrawEnabled !== false);
  }

  user.permissionNote = optionalString(req.body.note, 500) || user.permissionNote || '';
  user.permissionUpdatedAt = new Date();
  user.permissionUpdatedBy = req.user?._id;

  await user.save();

  res.json({
    success: true,
    message: 'User permissions updated',
    data: sanitizeUser(user),
  });
});

export const transferUserBalanceToAgent = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  assertOrThrow(user, 'User not found', 404);

  const agentId = requireString(req.body.agentId, 'Agent ID', 3, 40).toUpperCase();
  const transferAll = Boolean(req.body.transferAll) || String(req.body.amount || '').toLowerCase() === 'all';
  const currentBalance = Number(user.wallet || 0);
  const amount = transferAll ? currentBalance : requireNumber(req.body.amount, 'Amount', 1, 999_999_999);
  const note = optionalString(req.body.note, 500) || 'Main admin transferred user balance to agent';

  assertOrThrow(amount > 0, 'Transfer amount must be greater than zero', 400);
  assertOrThrow(currentBalance >= amount, 'User has insufficient balance for this transfer', 400);

  const agent = await Agent.findOne({ agentId });
  assertOrThrow(agent, 'Agent not found', 404);
  assertOrThrow(agent.status === 'active', 'Agent is not active', 400);

  const debitedUser = await User.findOneAndUpdate(
    { _id: user._id, wallet: { $gte: amount } },
    {
      $inc: { wallet: -amount },
      $set: {
        permissionNote: note,
        permissionUpdatedAt: new Date(),
        permissionUpdatedBy: req.user?._id,
      },
    },
    { new: true }
  );

  assertOrThrow(debitedUser, 'User has insufficient balance for this transfer', 400);

  const balanceBefore = Number(agent.balance || 0);
  agent.balance = Number((balanceBefore + amount).toFixed(2));
  await agent.save();

  const sourceUserId = debitedUser.userId || debitedUser.username || debitedUser._id.toString();

  const [agentTransaction, userTransaction] = await Promise.all([
    AgentTransaction.create({
      agent: agent._id,
      agentId: agent.agentId,
      type: 'USER_BALANCE_TRANSFER',
      amount,
      balanceBefore,
      balanceAfter: agent.balance,
      note: `${note}\nFrom user: ${sourceUserId}`,
      sourceUser: debitedUser._id,
      sourceUserId,
      createdBy: req.user?._id,
    }),
    Transaction.create({
      user: debitedUser._id,
      type: 'WITHDRAW',
      amount,
      status: 'SUCCESS',
      method: 'admin-transfer-to-agent',
      agent: agent._id,
      agentId: agent.agentId,
      methodKey: 'admin-transfer-to-agent',
      userNote: `Main admin transferred balance to Agent ${agent.agentId}`,
      adminNote: note,
      processedAt: new Date(),
      processedBy: req.user?._id,
      gatewayPayload: {
        source: 'admin-user-balance-transfer-to-agent',
        agentId: agent.agentId,
        balanceBefore: currentBalance,
        balanceAfter: debitedUser.wallet,
      },
    }),
  ]);

  res.json({
    success: true,
    message: 'User balance transferred to agent panel',
    data: {
      user: sanitizeUser(debitedUser),
      agent: typeof agent.toSafeObject === 'function' ? agent.toSafeObject() : agent,
      agentTransaction,
      transaction: userTransaction,
    },
  });
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

  let bonusResult = null;

  if (expectedType === 'DEPOSIT' && status === 'SUCCESS' && prevStatus !== 'SUCCESS') {
    await creditWallet(transaction.user, transaction.amount, 'admin-deposit-approval');
    bonusResult = await safelyAwardFirstDepositBonus(transaction);
    await handleSuccessfulDepositForReferral(transaction).catch((error) => { console.error('Referral reward creation failed:', error.message); });
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

  res.json({ success: true, message: 'Transaction status updated', data: transaction, bonus: bonusResult });
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
