import crypto from 'crypto';
import Razorpay from 'razorpay';
import Transaction from '../models/Transaction.js';
import Agent from '../models/Agent.js';
import AgentPaymentRequest from '../models/AgentPaymentRequest.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { requireNumber, optionalString, requireString } from '../utils/validation.js';
import { creditWallet, debitWallet } from '../utils/wallet.js';
import { env } from '../config/env.js';

function razorpayClient() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
}

export const getMyTransactions = asyncHandler(async (req, res) => {
  const transactions = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(150);
  res.json({ success: true, data: transactions, transactions });
});

export const createWithdrawTransaction = asyncHandler(async (req, res) => {
  const amount = requireNumber(req.body.amount, 'Amount', 1, 1_000_000);
  const type = String(req.body.type || 'WITHDRAW').toUpperCase();
  assertOrThrow(type === 'WITHDRAW', 'Only WITHDRAW transactions can be created here', 400);
  const method = optionalString(req.body.method, 40) || 'upi';

  await debitWallet(req.user._id, amount, 'withdraw-request');

  const transaction = await Transaction.create({
    user: req.user._id,
    type: 'WITHDRAW',
    amount,
    status: 'PENDING',
    method,
    upiId: optionalString(req.body.upiId, 120),
    accountHolderName: optionalString(req.body.accountHolderName, 160),
    accountNumber: optionalString(req.body.accountNumber, 80),
    ifscCode: optionalString(req.body.ifscCode, 40),
  });

  res.status(201).json({ success: true, message: 'Withdrawal request created', transactionId: transaction._id, data: transaction });
});

export const createDepositOrder = asyncHandler(async (req, res) => {
  const amount = requireNumber(req.body.amount, 'Amount', 1, 1_000_000);
  const transaction = await Transaction.create({ user: req.user._id, type: 'DEPOSIT', amount, status: 'PENDING', method: 'razorpay' });

  const client = razorpayClient();
  if (!client) {
    const order = {
      id: `order_dev_${transaction._id}`,
      orderId: `order_dev_${transaction._id}`,
      amount: Math.round(amount * 100),
      currency: 'INR',
      transactionId: transaction._id,
      devMode: true,
    };
    transaction.razorpayOrderId = order.id;
    await transaction.save();
    return res.status(201).json({ success: true, data: order });
  }

  const order = await client.orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: transaction._id.toString(),
    notes: { userId: req.user._id.toString(), transactionId: transaction._id.toString() },
  });
  transaction.razorpayOrderId = order.id;
  transaction.gatewayPayload = order;
  await transaction.save();
  res.status(201).json({ success: true, data: { ...order, orderId: order.id, transactionId: transaction._id } });
});

export const verifyDepositPayment = asyncHandler(async (req, res) => {
  const transactionId = req.body.transactionId;
  const transaction = await Transaction.findOne({ _id: transactionId, user: req.user._id, type: 'DEPOSIT' });
  assertOrThrow(transaction, 'Deposit transaction not found', 404);
  assertOrThrow(transaction.status !== 'SUCCESS', 'Deposit already verified', 409);

  const orderId = req.body.razorpay_order_id || transaction.razorpayOrderId;
  const paymentId = req.body.razorpay_payment_id || '';
  const signature = req.body.razorpay_signature || '';

  if (env.RAZORPAY_KEY_SECRET && !String(orderId).startsWith('order_dev_')) {
    const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    assertOrThrow(expected === signature, 'Invalid payment signature', 400);
  }

  transaction.status = 'SUCCESS';
  transaction.razorpayOrderId = orderId;
  transaction.razorpayPaymentId = paymentId || `pay_dev_${transaction._id}`;
  transaction.gatewayPayload = req.body;
  transaction.processedAt = new Date();
  await transaction.save();
  await creditWallet(req.user._id, transaction.amount, 'deposit-success');

  res.json({ success: true, message: 'Deposit verified', data: transaction });
});


function normalizeAgentPaymentMethods(agent) {
  const defaults = [
    { key: 'bkash', title: 'bKash Agent', number: '', image: '', note: '', isActive: true },
    { key: 'nagad', title: 'Nagad Agent', number: '', image: '', note: '', isActive: true },
    { key: 'rocket', title: 'Rocket Agent', number: '', image: '', note: '', isActive: false },
  ];

  const existing = new Map((agent.paymentMethods || []).map((method) => [method.key, method.toObject ? method.toObject() : method]));
  return defaults.map((method) => ({ ...method, ...(existing.get(method.key) || {}) }));
}

function buildUserDisplay(user) {
  return user?.fullName || user?.name || user?.username || user?.email || user?.userId || 'User';
}

export const getAgentDepositOptions = asyncHandler(async (_req, res) => {
  const agents = await Agent.find({ status: 'active' }).sort({ createdAt: 1 }).limit(100);

  const options = [];

  for (const agent of agents) {
    const methods = normalizeAgentPaymentMethods(agent).filter((method) => method.isActive);
    for (const method of methods) {
      options.push({
        id: `${agent.agentId}:${method.key}`,
        agentId: agent.agentId,
        agentName: agent.name,
        methodKey: method.key,
        methodTitle: method.title,
        number: method.number,
        image: method.image,
        note: method.note,
      });
    }
  }

  res.json({ success: true, data: options, options });
});

export const createAgentDepositRequest = asyncHandler(async (req, res) => {
  const amount = requireNumber(req.body.amount, 'Amount', 1, 1_000_000);
  const agentId = requireString(req.body.agentId, 'Agent ID', 3, 40).toUpperCase();
  const methodKey = requireString(req.body.methodKey, 'Payment method', 2, 30).toLowerCase();
  const userNote = optionalString(req.body.note, 500) || '';

  const agent = await Agent.findOne({ agentId, status: 'active' });
  assertOrThrow(agent, 'Agent not found or inactive', 404);

  const method = normalizeAgentPaymentMethods(agent).find((item) => item.key === methodKey && item.isActive);
  assertOrThrow(method, 'Payment method is not active', 404);

  const transaction = await Transaction.create({
    user: req.user._id,
    type: 'DEPOSIT',
    amount,
    status: 'PENDING',
    method: `agent-${method.key}`,
    agent: agent._id,
    agentId: agent.agentId,
    methodKey: method.key,
    userNote,
    gatewayPayload: {
      paymentMethod: method,
      source: 'agent-panel',
    },
  });

  const request = await AgentPaymentRequest.create({
    type: 'DEPOSIT',
    status: 'PENDING',
    user: req.user._id,
    userId: req.user.userId || req.user.username || req.user._id.toString(),
    userName: buildUserDisplay(req.user),
    agent: agent._id,
    agentId: agent.agentId,
    amount,
    methodKey: method.key,
    methodTitle: method.title,
    methodNumber: method.number,
    userNote,
    transaction: transaction._id,
  });

  transaction.agentPaymentRequest = request._id;
  await transaction.save();

  res.status(201).json({
    success: true,
    message: 'Deposit request sent to agent panel',
    data: { request, transaction },
  });
});

export const createAgentWithdrawRequest = asyncHandler(async (req, res) => {
  const amount = requireNumber(req.body.amount, 'Amount', 1, 1_000_000);
  const agentId = optionalString(req.body.agentId, 40)?.toUpperCase();
  const methodKey = optionalString(req.body.methodKey, 30)?.toLowerCase() || optionalString(req.body.method, 30)?.toLowerCase() || 'manual';
  const userNote = optionalString(req.body.note, 500) || optionalString(req.body.accountNumber, 160) || '';

  assertOrThrow((req.user.wallet || 0) >= amount, 'Insufficient wallet balance', 400);

  let agent;
  if (agentId) {
    agent = await Agent.findOne({ agentId, status: 'active' });
  } else {
    agent = await Agent.findOne({ status: 'active' }).sort({ createdAt: 1 });
  }
  assertOrThrow(agent, 'No active agent available for withdrawal', 404);

  const method = normalizeAgentPaymentMethods(agent).find((item) => item.key === methodKey) || {
    key: methodKey,
    title: methodKey === 'manual' ? 'Manual Withdraw' : methodKey,
    number: '',
  };

  const transaction = await Transaction.create({
    user: req.user._id,
    type: 'WITHDRAW',
    amount,
    status: 'PENDING',
    method: `agent-${method.key}`,
    agent: agent._id,
    agentId: agent.agentId,
    methodKey: method.key,
    userNote,
    accountNumber: optionalString(req.body.accountNumber, 160) || '',
    accountHolderName: optionalString(req.body.accountHolderName, 160) || '',
    upiId: optionalString(req.body.upiId, 120) || '',
    gatewayPayload: {
      source: 'agent-panel',
      paymentMethod: method,
    },
  });

  const request = await AgentPaymentRequest.create({
    type: 'WITHDRAW',
    status: 'PENDING',
    user: req.user._id,
    userId: req.user.userId || req.user.username || req.user._id.toString(),
    userName: buildUserDisplay(req.user),
    agent: agent._id,
    agentId: agent.agentId,
    amount,
    methodKey: method.key,
    methodTitle: method.title,
    methodNumber: method.number || '',
    userNote,
    transaction: transaction._id,
  });

  transaction.agentPaymentRequest = request._id;
  await transaction.save();

  res.status(201).json({
    success: true,
    message: 'Withdrawal request sent to agent panel',
    data: { request, transaction },
  });
});


export const requestRazorpayPayout = asyncHandler(async (req, res) => {
  const transactionId = requireString(req.body.transactionId, 'Transaction ID', 6, 80);
  const transaction = await Transaction.findOne({ _id: transactionId, user: req.user._id, type: 'WITHDRAW' });
  assertOrThrow(transaction, 'Withdrawal transaction not found', 404);
  assertOrThrow(['PENDING', 'PROCESSING'].includes(transaction.status), 'Withdrawal cannot be processed', 409);

  transaction.status = 'PROCESSING';
  transaction.razorpayPayoutId = transaction.razorpayPayoutId || `pout_pending_${transaction._id}`;
  transaction.processedAt = new Date();
  await transaction.save();

  res.json({ success: true, message: 'Withdrawal moved to processing', data: transaction });
});
