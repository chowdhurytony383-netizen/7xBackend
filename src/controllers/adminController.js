import User from '../models/User.js';
import Verification from '../models/Verification.js';
import Transaction from '../models/Transaction.js';
import Bet from '../models/Bet.js';
import CrashBet from '../models/CrashBet.js';
import SportsAutoBet from '../models/SportsAutoBet.js';
import JiliTransaction from '../models/JiliTransaction.js';
import ProviderWalletTxn from '../models/ProviderWalletTxn.js';
import UserDevice from '../models/UserDevice.js';
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
import { getAdminPresenceSnapshot } from '../services/presenceService.js';
import { handleSuccessfulDepositForReferral } from '../services/referralRewardService.js';
import { createUserNotification } from '../services/notificationService.js';
import { sendDepositSuccessNotificationToUser } from '../services/pushNotificationService.js';


function adminSafeCurrency(transaction = {}) {
  return transaction.currency || transaction.gatewayPayload?.paymentMethod?.currency || transaction.gatewayPayload?.currency || 'BDT';
}

function adminDepositSuccessMessage(transaction = {}) {
  const currency = String(adminSafeCurrency(transaction) || 'BDT').toUpperCase();
  const amount = Number(transaction.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `Your deposit of ${currency} ${amount} has been credited successfully.`;
}

async function notifyDepositSuccess(transaction, source = 'admin-deposit-approval') {
  if (!transaction?.user) return;

  const userId = transaction.user?._id || transaction.user;
  const title = 'Deposit Successful';
  const message = adminDepositSuccessMessage(transaction);
  const actionUrl = '/wallet';

  await createUserNotification({
    user: userId,
    title,
    message,
    type: 'deposit',
    actionUrl,
    metadata: {
      transactionId: String(transaction._id || ''),
      amount: transaction.amount,
      currency: adminSafeCurrency(transaction),
      source,
    },
  }).catch((error) => {
    console.error('Deposit success in-site notification failed:', error.message);
  });

  await sendDepositSuccessNotificationToUser(userId, {
    amount: transaction.amount,
    currency: adminSafeCurrency(transaction),
    transactionId: String(transaction._id || ''),
    url: actionUrl,
  }).catch((error) => {
    console.error('Deposit success push notification failed:', error.message);
  });
}


function asPlain(record) {
  if (!record) return {};
  return typeof record.toObject === 'function' ? record.toObject() : record;
}

function roundMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function pickCurrency(record, user) {
  return String(record?.currency || user?.currency || 'BDT').toUpperCase();
}

function pickGameTitle(record, fallback = 'Game') {
  if (!record) return fallback;
  if (record.game?.displayName) return record.game.displayName;
  if (record.game?.name) return record.game.name;
  if (record.gameName) return record.gameName;
  if (record.sportTitle || record.league) return [record.sportTitle, record.league].filter(Boolean).join(' / ');
  if (record.homeTeam || record.awayTeam) return [record.homeTeam, record.awayTeam].filter(Boolean).join(' vs ');
  if (record.game) return `JILI Game #${record.game}`;
  if (record.slot !== undefined && record.slot !== null) return `Provider slot ${record.slot}`;
  return fallback;
}

function resultFromNet(netAmount, status = '') {
  const normalized = String(status || '').toUpperCase();
  if (['CANCELLED', 'VOID', 'REFUNDED', 'ROLLBACK'].includes(normalized)) return 'VOID';
  if (['ACTIVE', 'OPEN', 'PENDING', 'PROCESSING'].includes(normalized)) return 'PENDING';
  if (roundMoney(netAmount) > 0) return 'WIN';
  if (roundMoney(netAmount) < 0) return 'LOSS';
  if (['WIN', 'WON', 'CASHED_OUT'].includes(normalized)) return 'WIN';
  if (['LOSE', 'LOST'].includes(normalized)) return 'LOSS';
  return 'DRAW';
}

function normalizeClassicBet(record, user) {
  const bet = asPlain(record);
  const betAmount = roundMoney(bet.betAmount);
  const winAmount = roundMoney(bet.winAmount);
  const netAmount = roundMoney(winAmount - betAmount);
  return {
    id: String(bet._id || bet.id || ''),
    source: 'Internal Game',
    gameType: 'Casino/Internal',
    gameTitle: pickGameTitle(bet, 'Internal game'),
    roundId: bet.gameData?.roundId || bet.gameData?.round || '',
    betId: String(bet._id || bet.id || ''),
    betAmount,
    winAmount,
    netAmount,
    result: bet.isWin ? 'WIN' : resultFromNet(netAmount, bet.status),
    status: bet.status || (bet.isWin ? 'WIN' : 'LOSE'),
    currency: pickCurrency(bet, user),
    createdAt: bet.createdAt,
    details: bet.gameData || {},
  };
}

function normalizeCrashBet(record, user) {
  const bet = asPlain(record);
  const betAmount = roundMoney(bet.amount);
  const winAmount = roundMoney(bet.payoutAmount);
  const netAmount = roundMoney(winAmount - betAmount);
  return {
    id: String(bet._id || bet.id || ''),
    source: 'Crash',
    gameType: 'Crash',
    gameTitle: `Crash round ${bet.roundId || ''}`.trim(),
    roundId: bet.roundId || '',
    betId: String(bet._id || bet.id || ''),
    betAmount,
    winAmount,
    netAmount,
    result: resultFromNet(netAmount, bet.status),
    status: bet.status || '—',
    currency: pickCurrency(bet, user),
    multiplier: bet.payoutMultiplier || bet.crashMultiplier || 0,
    createdAt: bet.createdAt,
    details: {
      autoCashout: bet.autoCashout,
      payoutMultiplier: bet.payoutMultiplier,
      crashMultiplier: bet.crashMultiplier,
    },
  };
}

function normalizeSportsBet(record, user) {
  const bet = asPlain(record);
  const betAmount = roundMoney(bet.stake);
  const winAmount = roundMoney(bet.payoutAmount);
  const netAmount = roundMoney(winAmount - betAmount);
  return {
    id: String(bet._id || bet.id || bet.betId || ''),
    source: 'Sports',
    gameType: bet.sportTitle || 'Sports betting',
    gameTitle: [bet.homeTeam, bet.awayTeam].filter(Boolean).join(' vs ') || bet.league || bet.sportTitle || 'Sports bet',
    market: bet.marketName || bet.marketKey || '',
    selection: bet.selectionName || '',
    odds: bet.odds || 0,
    roundId: bet.providerEventId || '',
    betId: bet.betId || String(bet._id || bet.id || ''),
    betAmount,
    winAmount,
    netAmount,
    result: resultFromNet(netAmount, bet.status),
    status: bet.status || 'OPEN',
    currency: pickCurrency(bet, user),
    createdAt: bet.createdAt,
    settledAt: bet.settledAt,
    details: bet.result || {},
  };
}

function normalizeJiliTransaction(record, user) {
  const txn = asPlain(record);
  const betAmount = roundMoney(txn.betAmount || txn.turnoverAmount || 0);
  const winAmount = roundMoney(txn.winloseAmount || 0);
  const netAmount = roundMoney(txn.walletDelta ?? (winAmount - betAmount));
  return {
    id: String(txn._id || txn.id || txn.txId || ''),
    source: 'JILI',
    gameType: txn.action === 'sessionBet' ? 'JILI Session' : 'JILI Game',
    gameTitle: txn.game ? `JILI Game #${txn.game}` : 'JILI game',
    action: txn.action || '',
    roundId: txn.round || txn.originalRound || '',
    sessionId: txn.sessionId || '',
    betId: txn.txId || txn.reqId || '',
    betAmount,
    winAmount,
    netAmount,
    result: resultFromNet(netAmount, txn.status),
    status: txn.status || 'accepted',
    currency: pickCurrency(txn, user),
    createdAt: txn.createdAt,
    details: {
      reqId: txn.reqId,
      action: txn.action,
      turnoverAmount: txn.turnoverAmount,
      walletDelta: txn.walletDelta,
      message: txn.message,
    },
  };
}

function normalizeProviderWalletTxn(record, user) {
  const txn = asPlain(record);
  const amount = roundMoney(Number(txn.amountCents || 0) / 100);
  const isDebit = txn.type === 'debit';
  const isRollback = txn.type === 'rollback';
  const betAmount = isDebit ? amount : 0;
  const winAmount = isDebit ? 0 : amount;
  const netAmount = roundMoney(isDebit ? -amount : amount);
  return {
    id: String(txn._id || txn.id || txn.txnId || ''),
    source: 'Provider Wallet',
    gameType: 'Provider wallet',
    gameTitle: pickGameTitle(txn, 'Provider wallet game'),
    action: txn.type || '',
    roundId: txn.roundId || '',
    sessionId: txn.sessionId || '',
    betId: txn.betId || txn.txnId || '',
    betAmount,
    winAmount,
    netAmount,
    result: isRollback ? 'VOID' : resultFromNet(netAmount, txn.status),
    status: txn.status || txn.type || 'success',
    currency: pickCurrency(txn, user),
    multiplier: txn.multiplier || 0,
    createdAt: txn.createdAt,
    details: txn.response || {},
  };
}

function buildGameplaySummary(records = []) {
  const totals = records.reduce((summary, record) => {
    summary.totalBetAmount = roundMoney(summary.totalBetAmount + Number(record.betAmount || 0));
    summary.totalWinAmount = roundMoney(summary.totalWinAmount + Number(record.winAmount || 0));
    summary.netResult = roundMoney(summary.netResult + Number(record.netAmount || 0));
    if (record.result === 'WIN') summary.totalWins += 1;
    if (record.result === 'LOSS') summary.totalLosses += 1;
    return summary;
  }, {
    totalRecords: records.length,
    totalBetAmount: 0,
    totalWinAmount: 0,
    netResult: 0,
    totalWins: 0,
    totalLosses: 0,
  });

  totals.ggr = roundMoney(totals.totalBetAmount - totals.totalWinAmount);
  totals.winRate = totals.totalRecords ? Math.round((totals.totalWins / totals.totalRecords) * 100) : 0;
  return totals;
}

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

  const providerUserIds = [user._id, user.id, user.userId, user.username]
    .filter(Boolean)
    .map((value) => String(value));

  const jiliIdentifiers = [String(user._id), user.userId, user.username, user.userId || user.username || String(user._id)]
    .filter(Boolean)
    .map((value) => String(value))
    .filter((value, index, list) => value.length >= 4 && list.indexOf(value) === index);
  const jiliUsernamePattern = jiliIdentifiers.length
    ? new RegExp(`(^|_)(${jiliIdentifiers.map(escapeRegex).join('|')})$`, 'i')
    : null;
  const jiliFilter = jiliUsernamePattern
    ? { $or: [{ user: user._id }, { username: jiliUsernamePattern }] }
    : { user: user._id };

  const [verification, bets, crashBets, sportsBets, jiliTransactions, providerWalletTxns, transactions, devices] = await Promise.all([
    Verification.findOne({ user: user._id }),
    Bet.find({ user: user._id }).populate('game', 'name displayName image').sort({ createdAt: -1 }).limit(150),
    CrashBet.find({ user: user._id }).sort({ createdAt: -1 }).limit(150),
    SportsAutoBet.find({ user: user._id }).sort({ createdAt: -1 }).limit(150),
    JiliTransaction.find(jiliFilter).sort({ createdAt: -1 }).limit(200),
    ProviderWalletTxn.find({ userId: { $in: providerUserIds } }).sort({ createdAt: -1 }).limit(200),
    Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(150),
    UserDevice.find({ user: user._id }).sort({ lastSeenAt: -1 }).limit(50).lean(),
  ]);

  const gameplayRecords = [
    ...bets.map((item) => normalizeClassicBet(item, user)),
    ...crashBets.map((item) => normalizeCrashBet(item, user)),
    ...sportsBets.map((item) => normalizeSportsBet(item, user)),
    ...jiliTransactions.map((item) => normalizeJiliTransaction(item, user)),
    ...providerWalletTxns.map((item) => normalizeProviderWalletTxn(item, user)),
  ]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 500);

  const gameplaySummary = buildGameplaySummary(gameplayRecords);

  res.json({
    success: true,
    data: {
      user: { ...sanitizeUser(user), verification },
      verification,
      bets,
      crashBets,
      sportsBets,
      jiliTransactions,
      providerWalletTxns,
      gameplayRecords,
      gameplaySummary,
      gameplay: { summary: gameplaySummary, records: gameplayRecords },
      transactions,
      devices,
      userDevices: devices,
    },
  });
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
    await notifyDepositSuccess(transaction, 'admin-deposit-approval');
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


export const userDevices = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId).select('_id fullName name email userId username');
  assertOrThrow(user, 'User not found', 404);

  const devices = await UserDevice.find({ user: user._id })
    .sort({ lastSeenAt: -1 })
    .limit(100)
    .lean();

  res.json({ success: true, data: devices, devices });
});


export const realtimePresence = asyncHandler(async (_req, res) => {
  const snapshot = await getAdminPresenceSnapshot();
  res.json({ success: true, data: snapshot });
});
