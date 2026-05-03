import crypto from 'crypto';
import Razorpay from 'razorpay';
import Transaction from '../models/Transaction.js';
import Agent from '../models/Agent.js';
import AgentPaymentRequest from '../models/AgentPaymentRequest.js';
import DepositMethod from '../models/DepositMethod.js';
import { ensureDefaultDepositMethods } from './depositMethodController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrThrow } from '../utils/appError.js';
import { requireNumber, optionalString, requireString } from '../utils/validation.js';
import { creditWallet, debitWallet } from '../utils/wallet.js';
import { env } from '../config/env.js';
import { groupDepositMethodsByTitle, pickPrimaryDepositMethod } from '../utils/paymentMethodCanonical.js';

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

  await debitWallet(req.user._id, amount, 'withdraw-request-hold');

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
    gatewayPayload: {
      source: 'legacy-withdraw',
      walletHeld: true,
      walletHeldAt: new Date(),
    },
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

async function getGlobalDepositMethods(activeOnly = true) {
  await ensureDefaultDepositMethods();
  const filter = activeOnly ? { isActive: true } : {};
  return DepositMethod.find(filter).sort({ displayOrder: 1, createdAt: 1 });
}

function normalizeAgentPaymentMethods(agent, globalMethods) {
  const existing = new Map(
    (agent.paymentMethods || []).map((method) => {
      const plain = method.toObject ? method.toObject() : method;
      return [plain.key, plain];
    })
  );

  return globalMethods.map((method) => {
    const plainMethod = method.toObject ? method.toObject() : method;
    const saved = existing.get(plainMethod.key) || {};

    return {
      key: plainMethod.key,
      title: plainMethod.title,
      category: plainMethod.category || 'e-wallets',
      image: plainMethod.image || '',
      number: saved.number || '',
      note: saved.note || '',
      isActive: saved.isActive === undefined ? true : Boolean(saved.isActive),
      minAmount: plainMethod.minAmount || 100,
      maxAmount: plainMethod.maxAmount || 25000,
      displayOrder: plainMethod.displayOrder || 100,
    };
  });
}

function getRawAgent(agent) {
  return agent?.toObject ? agent.toObject() : (agent || {});
}

function normalizeKeyList(keys) {
  if (!Array.isArray(keys)) return [];

  return [...new Set(
    keys
      .map((key) => String(key || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

function getAllowedPaymentMethodKeys(agent, globalMethods) {
  const rawAgent = getRawAgent(agent);
  const globalKeys = globalMethods.map((method) => String(method.key || '').toLowerCase()).filter(Boolean);
  const globalKeySet = new Set(globalKeys);

  // Old agents without this field keep the previous behavior: all methods are allowed.
  if (!Array.isArray(rawAgent.allowedPaymentMethodKeys)) return globalKeys;

  return normalizeKeyList(rawAgent.allowedPaymentMethodKeys).filter((key) => globalKeySet.has(key));
}

function isPaymentMethodAssignedToAgent(agent, methodKey, globalMethods) {
  return getAllowedPaymentMethodKeys(agent, globalMethods).includes(String(methodKey || '').toLowerCase());
}

function buildUserDisplay(user) {
  return user?.fullName || user?.name || user?.username || user?.email || user?.userId || 'User';
}

function pickRandomItem(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[crypto.randomInt(items.length)];
}

export const getAgentDepositOptions = asyncHandler(async (_req, res) => {
  const globalMethods = await getGlobalDepositMethods(true);
  const methodGroups = groupDepositMethodsByTitle(globalMethods);
  const agents = await Agent.find({ status: 'active' }).sort({ createdAt: 1 }).limit(500);

  const options = [];

  for (const group of methodGroups) {
    const primaryMethod = pickPrimaryDepositMethod(group.methods);
    if (!primaryMethod) continue;

    const eligibleOptions = [];

    for (const method of group.methods) {
      for (const agent of agents) {
        if (!isPaymentMethodAssignedToAgent(agent, method.key, globalMethods)) continue;

        const methods = normalizeAgentPaymentMethods(agent, globalMethods);
        const payment = methods.find((item) => item.key === method.key && item.isActive && item.number);

        if (!payment) continue;

        eligibleOptions.push({
          agent,
          payment,
          globalMethod: method,
        });
      }
    }

    const selected = pickRandomItem(eligibleOptions);
    if (!selected) continue;

    const { agent: selectedAgent, payment: selectedPayment, globalMethod: selectedGlobalMethod } = selected;

    options.push({
      id: group.canonicalKey,
      groupKey: group.canonicalKey,
      agentId: selectedAgent.agentId,
      agentName: selectedAgent.name,
      methodKey: selectedPayment.key,
      selectedMethodKey: selectedPayment.key,
      methodTitle: primaryMethod.title || selectedGlobalMethod.title,
      category: primaryMethod.category || selectedGlobalMethod.category || 'e-wallets',
      image: primaryMethod.image || selectedGlobalMethod.image || '',
      number: selectedPayment.number,
      note: selectedPayment.note,
      minAmount: primaryMethod.minAmount || selectedGlobalMethod.minAmount || 100,
      maxAmount: primaryMethod.maxAmount || selectedGlobalMethod.maxAmount || 25000,
      displayOrder: primaryMethod.displayOrder || selectedGlobalMethod.displayOrder || 100,
      availableAgentCount: eligibleOptions.length,
      duplicateMethodCount: group.methods.length,
      duplicateKeys: group.duplicateKeys || [],
      selectionMode: 'random-agent',
    });
  }

  res.json({ success: true, data: options, options });
});


export const getAgentWithdrawOptions = asyncHandler(async (_req, res) => {
  const globalMethods = await getGlobalDepositMethods(true);
  const methodGroups = groupDepositMethodsByTitle(globalMethods);
  const agents = await Agent.find({ status: 'active' }).sort({ createdAt: 1 }).limit(500);

  const options = [];

  for (const group of methodGroups) {
    const primaryMethod = pickPrimaryDepositMethod(group.methods);
    if (!primaryMethod) continue;

    const eligibleOptions = [];

    for (const method of group.methods) {
      for (const agent of agents) {
        if (!isPaymentMethodAssignedToAgent(agent, method.key, globalMethods)) continue;

        const methods = normalizeAgentPaymentMethods(agent, globalMethods);
        const payment = methods.find((item) => item.key === method.key && item.isActive);

        if (!payment) continue;

        eligibleOptions.push({
          agent,
          payment,
          globalMethod: method,
        });
      }
    }

    const selected = pickRandomItem(eligibleOptions);
    if (!selected) continue;

    const { agent: selectedAgent, payment: selectedPayment, globalMethod: selectedGlobalMethod } = selected;

    options.push({
      id: `withdraw-${group.canonicalKey}`,
      groupKey: group.canonicalKey,
      agentId: selectedAgent.agentId,
      agentName: selectedAgent.name,
      methodKey: selectedPayment.key,
      selectedMethodKey: selectedPayment.key,
      methodTitle: primaryMethod.title || selectedGlobalMethod.title,
      category: primaryMethod.category || selectedGlobalMethod.category || 'e-wallets',
      image: primaryMethod.image || selectedGlobalMethod.image || '',
      minAmount: primaryMethod.minAmount || selectedGlobalMethod.minAmount || 100,
      maxAmount: primaryMethod.maxAmount || selectedGlobalMethod.maxAmount || 25000,
      displayOrder: primaryMethod.displayOrder || selectedGlobalMethod.displayOrder || 100,
      availableAgentCount: eligibleOptions.length,
      duplicateMethodCount: group.methods.length,
      duplicateKeys: group.duplicateKeys || [],
      selectionMode: 'random-agent-withdraw',
    });
  }

  res.json({ success: true, data: options, options });
});

export const createAgentDepositRequest = asyncHandler(async (req, res) => {
  const amount = requireNumber(req.body.amount, 'Amount', 1, 1_000_000);
  const agentId = requireString(req.body.agentId, 'Agent ID', 3, 40).toUpperCase();
  const methodKey = requireString(req.body.methodKey, 'Payment method', 2, 50).toLowerCase();
  const payerNumber = optionalString(req.body.payerNumber, 80) || '';
  const transactionRef = optionalString(req.body.transactionRef, 120) || '';
  const extraNote = optionalString(req.body.note, 500) || '';

  const globalMethods = await getGlobalDepositMethods(true);
  const globalMethod = globalMethods.find((item) => item.key === methodKey);
  assertOrThrow(globalMethod, 'Payment method is not active', 404);
  assertOrThrow(amount >= Number(globalMethod.minAmount || 1), `Minimum amount is ${globalMethod.minAmount}`, 400);
  assertOrThrow(amount <= Number(globalMethod.maxAmount || 1_000_000), `Maximum amount is ${globalMethod.maxAmount}`, 400);

  const agent = await Agent.findOne({ agentId, status: 'active' });
  assertOrThrow(agent, 'Agent not found or inactive', 404);
  assertOrThrow(
    isPaymentMethodAssignedToAgent(agent, methodKey, globalMethods),
    'This payment method is not assigned to the selected agent',
    403
  );

  const method = normalizeAgentPaymentMethods(agent, globalMethods).find((item) => item.key === methodKey && item.isActive && item.number);
  assertOrThrow(method, 'Agent payment number is not active', 404);

  const userNoteParts = [];
  if (payerNumber) userNoteParts.push(`Sender wallet number: ${payerNumber}`);
  if (transactionRef) userNoteParts.push(`Transaction ID: ${transactionRef}`);
  if (extraNote) userNoteParts.push(`Note: ${extraNote}`);
  const userNote = userNoteParts.join('\n');

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
      paymentMethod: {
        key: method.key,
        title: globalMethod.title,
        number: method.number,
        note: method.note,
        image: globalMethod.image,
      },
      payerNumber,
      transactionRef,
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
    methodTitle: globalMethod.title,
    methodNumber: method.number,
    userNote,
    payerNumber,
    transactionRef,
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
  const methodKey = optionalString(req.body.methodKey, 50)?.toLowerCase() || optionalString(req.body.method, 50)?.toLowerCase();
  const receiverNumber = optionalString(req.body.receiverNumber, 160) || optionalString(req.body.accountNumber, 160) || optionalString(req.body.upiId, 120) || '';
  const accountHolderName = optionalString(req.body.accountHolderName, 160) || '';
  const extraNote = optionalString(req.body.note, 500) || '';

  assertOrThrow(methodKey, 'Withdrawal method is required', 400);
  assertOrThrow(receiverNumber, 'Receiving number/account is required', 400);
  assertOrThrow((req.user.wallet || 0) >= amount, 'Insufficient wallet balance', 400);

  const globalMethods = await getGlobalDepositMethods(true);
  const globalMethod = globalMethods.find((item) => item.key === methodKey);
  assertOrThrow(globalMethod, 'Withdrawal method is not active', 404);
  assertOrThrow(amount >= Number(globalMethod.minAmount || 1), `Minimum amount is ${globalMethod.minAmount}`, 400);
  assertOrThrow(amount <= Number(globalMethod.maxAmount || 1_000_000), `Maximum amount is ${globalMethod.maxAmount}`, 400);

  let agent;
  if (agentId) {
    agent = await Agent.findOne({ agentId, status: 'active' });
  } else {
    const activeAgents = await Agent.find({ status: 'active' }).sort({ createdAt: 1 }).limit(500);
    const eligibleAgents = activeAgents.filter((item) => isPaymentMethodAssignedToAgent(item, methodKey, globalMethods));
    agent = pickRandomItem(eligibleAgents);
  }
  assertOrThrow(agent, 'No active agent available for withdrawal', 404);
  assertOrThrow(
    isPaymentMethodAssignedToAgent(agent, methodKey, globalMethods),
    'This withdrawal method is not assigned to the selected agent',
    403
  );

  const method = normalizeAgentPaymentMethods(agent, globalMethods).find((item) => item.key === methodKey && item.isActive) || {
    key: methodKey,
    title: globalMethod.title,
    number: '',
  };
  assertOrThrow(method?.isActive !== false, 'Selected withdrawal method is not active for this agent', 404);

  const userNoteParts = [];
  userNoteParts.push(`Receiving account: ${receiverNumber}`);
  if (accountHolderName) userNoteParts.push(`Account holder: ${accountHolderName}`);
  if (extraNote) userNoteParts.push(`Note: ${extraNote}`);
  const userNote = userNoteParts.join('\n');

  let walletDebited = false;

  try {
    await debitWallet(req.user._id, amount, 'agent-withdraw-request-hold');
    walletDebited = true;

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
      accountNumber: receiverNumber,
      accountHolderName,
      upiId: optionalString(req.body.upiId, 120) || receiverNumber,
      gatewayPayload: {
        source: 'agent-panel',
        walletHeld: true,
        walletHeldAt: new Date(),
        paymentMethod: {
          key: method.key,
          title: globalMethod.title || method.title,
          image: globalMethod.image,
        },
        payout: {
          receiverNumber,
          accountHolderName,
          note: extraNote,
        },
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
      methodTitle: globalMethod.title || method.title,
      methodNumber: '',
      userNote,
      receiverNumber,
      accountNumber: receiverNumber,
      accountHolderName,
      transaction: transaction._id,
    });

    transaction.agentPaymentRequest = request._id;
    await transaction.save();

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request sent to agent panel',
      data: { request, transaction },
    });
  } catch (error) {
    if (walletDebited) {
      await creditWallet(req.user._id, amount, 'agent-withdraw-request-rollback').catch(() => null);
    }
    throw error;
  }
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
